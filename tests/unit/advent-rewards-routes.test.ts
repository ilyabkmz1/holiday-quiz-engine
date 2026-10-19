import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";

import { adventPackFixture } from "../fixtures/advent";
import { at, verifyParticipant } from "../support/advent";
import { smallCampaign } from "../support/small-campaign";

const env = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "https://advent.test",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16"
};

// Состояние живёт между перезагрузками модулей (см. advent-routes.test.ts).
const world = vi.hoisted(() => ({
  role: null as null | "operator" | "cashier",
  now: new Date(),
  build: null as null | ((tenant: unknown) => unknown)
}));

vi.mock("@/server/container", () => ({
  getNow: () => new Date(world.now),
  getServices: () => {
    throw new Error("квиз-сервисы в этом тесте не нужны");
  },
  getAdventServices: (tenant: unknown) => world.build!(tenant)
}));

// Проверку Basic auth (БД, scrypt) заменяет роль из `world`: сами роли проверены в advent-rewards.test.ts и интеграционных тестах.
vi.mock("@/server/admin", () => {
  const challenge = () => new NextResponse("Authentication required", { status: 401, headers: { "www-authenticate": 'Basic realm="t"' } });
  return {
    requireAdmin: async () => (world.role === "operator" ? null : challenge()),
    requireCashier: async () => (world.role ? null : challenge())
  };
});

const HOST = "advent.test";

async function boot() {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("NODE_ENV", "test");
  const { InMemoryAdventRepository } = await import("@/server/repositories/in-memory-advent-repository");
  const { AdventService } = await import("@/server/services/advent-service");
  const { RewardService } = await import("@/server/services/reward-service");
  const { redeemRateLimiter } = await import("@/server/rate-limit");
  redeemRateLimiter.reset();
  const repository = new InMemoryAdventRepository();
  const tenants = await import("@/server/tenants");
  tenants.overrideTenants(
    tenants.loadTenants([{ ...adventPackFixture(), hosts: [HOST] }, packSchema.parse({ tenant: "quiz", hosts: ["quiz.test"], campaign: smallCampaign("quiz-campaign") })])
  );
  let services: unknown;
  world.build = (tenant) => {
    const { advent } = tenant as { advent: import("@/config/advent-schema").AdventConfig };
    const rewardService = new RewardService(repository, advent, { qrSecret: "route-test-reward-qr-secret-0123456789abcdef", baseUrl: "https://advent.test" });
    const adventService = new AdventService(repository, advent, rewardService);
    services ??= { repository, adventService, rewardService, advent, ensureCampaign: async () => undefined };
    return services;
  };
  const ctx = world.build((tenants.getTenants()[0])) as { adventService: import("@/server/services/advent-service").AdventService; rewardService: import("@/server/services/reward-service").RewardService; advent: import("@/config/advent-schema").AdventConfig };
  world.now = at(2, 12);
  return {
    ...ctx,
    repository,
    redeem: (await import("@/app/api/advent/redeem/route")).POST,
    codes: (await import("@/app/api/admin/advent/codes/route")).POST,
    grantsCsv: (await import("@/app/api/admin/advent/grants.csv/route")).GET
  };
}

type Init = { method?: string; host?: string; origin?: string | null; body?: unknown; contentType?: string; raw?: string; headers?: Record<string, string> };
function request(path: string, init: Init = {}): NextRequest {
  const host = init.host ?? HOST;
  const method = init.method ?? "POST";
  const headers = new Headers({ host, ...init.headers });
  const origin = init.origin === undefined ? (method === "GET" ? null : `https://${host}`) : init.origin;
  if (origin) headers.set("origin", origin);
  let body: string | undefined;
  if (init.raw !== undefined) {
    body = init.raw;
    headers.set("content-type", init.contentType ?? "text/csv");
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(new URL(path, `https://${host}`), { method, headers, body });
}
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function issuedGift(app: Awaited<ReturnType<typeof boot>>) {
  const { participant: created } = await app.adventService.createParticipant(at(2, 9));
  const p = await verifyParticipant({ repository: app.repository, advent: app.advent, service: app.adventService }, created.id, at(2, 9, 30));
  await app.adventService.openDay(p.id, 2, at(2, 10));
  const { playDay } = await import("../support/advent");
  await playDay(app.adventService, app.advent, p.id, 2, at(2, 11));
  const state = await app.adventService.state(p.id, at(2, 12));
  return { participant: p, grant: state.grants.find((grant) => grant.source === "day")! };
}

describe("маршруты наград адвента", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    world.role = "cashier";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("POST /api/advent/redeem", () => {
    it("без входа — 401 с вызовом Basic; без Origin — 403; квиз-арендатор — 404; битое тело — 400", async () => {
      const app = await boot();
      world.role = null;
      const denied = await app.redeem(request("/api/advent/redeem", { body: { code: "X" } }));
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toMatch(/^Basic /);
      world.role = "cashier";
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: "X" }, origin: null }))).status).toBe(403);
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: "X" }, origin: "https://evil.test" }))).status).toBe(403);
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: "X" }, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
      expect((await app.redeem(request("/api/advent/redeem", { host: "quiz.test", body: { code: "X" } }))).status).toBe(404);
      expect((await app.redeem(request("/api/advent/redeem", { body: {} }))).status).toBe(400);
      expect((await app.redeem(request("/api/advent/redeem", { raw: "{не json", contentType: "application/json" }))).status).toBe(400);
    });

    it("кассир: проверка не меняет, погашение — 200, повтор — 409 «уже погашен», неизвестный — 404, подделка QR — 400", async () => {
      const app = await boot();
      const { grant } = await issuedGift(app);
      const check = await app.redeem(request("/api/advent/redeem", { body: { code: grant.qr!.payload, action: "check" } }));
      expect(check.status).toBe(200);
      expect(await json(check)).toMatchObject({ status: "ready", label: "Напиток или десерт дня", expiresAt: grant.expiresAt });
      expect((await app.repository.getGrant(grant.id))!.status).toBe("issued");

      const ok = await app.redeem(request("/api/advent/redeem", { body: { code: grant.qr!.payload } }));
      expect(ok.status).toBe(200);
      expect(await json(ok)).toMatchObject({ status: "redeemed", redeemedAt: at(2, 12).toISOString() });
      expect(JSON.stringify(await json(await app.redeem(request("/api/advent/redeem", { body: { code: grant.code } }))))).toContain("already_redeemed");
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: grant.code } }))).status).toBe(409);
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: "NOPE-1" } }))).status).toBe(404);
      const [prefix, id] = grant.qr!.payload.split(".");
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: `${prefix}.${id}.AAAAAAAAAAAAAAAAAAAAAA` } }))).status).toBe(400);
      // Код награды в журнал не попадает.
      expect(JSON.stringify([...(console.info as any).mock.calls, ...(console.error as any).mock.calls])).not.toContain(grant.code!); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it("просроченная награда — 409 expired; лимит запросов — 429", async () => {
      const app = await boot();
      const { grant } = await issuedGift(app);
      world.now = at(6, 12);
      const expired = await app.redeem(request("/api/advent/redeem", { body: { code: grant.code } }));
      expect(expired.status).toBe(409);
      expect(await json(expired)).toMatchObject({ status: "expired" });
      const { redeemRateLimiter } = await import("@/server/rate-limit");
      redeemRateLimiter.setLimit(2);
      redeemRateLimiter.reset();
      await app.redeem(request("/api/advent/redeem", { body: { code: "A" } }));
      await app.redeem(request("/api/advent/redeem", { body: { code: "A" } }));
      expect((await app.redeem(request("/api/advent/redeem", { body: { code: "A" } }))).status).toBe(429);
      redeemRateLimiter.setLimit(120);
    });
  });

  describe("админка наград", () => {
    const listAdvent = (app: Awaited<ReturnType<typeof boot>>) => app.advent.rewards.find((reward) => reward.id === "daily-gift")!;

    it("импорт кодов: кассиру 401, оператору — отчёт; CSV или JSON; чужой Origin — 403; награда без списка — 400", async () => {
      const app = await boot();
      // В фикстуре у награды нет списка: подменяем конфигурацию награды в готовом сервисе.
      (listAdvent(app) as { codes: unknown }).codes = { list: "codes/daily.csv" };
      const url = "/api/admin/advent/codes?rewardId=daily-gift";
      world.role = "cashier";
      expect((await app.codes(request(url, { raw: "code\nAAA111\n" }))).status).toBe(401);
      world.role = "operator";
      expect((await app.codes(request(url, { raw: "code\nAAA111\n", origin: "https://evil.test" }))).status).toBe(403);
      const report = await app.codes(request(url, { raw: "code\nAAA111\nAAA111\nbbb222\n" }));
      expect(report.status).toBe(200);
      expect(await json(report)).toEqual({ rows: 3, added: 2, duplicatesInFile: 1, alreadyInPool: 0, invalid: 0 });
      const viaJson = await app.codes(request("/api/admin/advent/codes", { body: { rewardId: "daily-gift", csv: "code\nBBB222\nCCC333" } }));
      expect(await json(viaJson)).toMatchObject({ added: 1, alreadyInPool: 1 });
      expect((await app.codes(request("/api/admin/advent/codes", { raw: "code\nAAA", contentType: "text/csv" }))).status).toBe(400);
      expect((await app.codes(request("/api/admin/advent/codes?rewardId=luck-a", { raw: "code\nAAA111" }))).status).toBe(400);
      expect((await app.codes(request(url, { host: "quiz.test", raw: "code\nAAA111" }))).status).toBe(404);
    });

    it("grants.csv: только оператор; без email и кодов; название файла по арендатору", async () => {
      const app = await boot();
      await issuedGift(app);
      world.role = "cashier";
      expect((await app.grantsCsv(request("/api/admin/advent/grants.csv", { method: "GET" }))).status).toBe(401);
      world.role = "operator";
      const response = await app.grantsCsv(request("/api/admin/advent/grants.csv", { method: "GET" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain("zerno-advent-advent-grants.csv");
      expect(response.headers.get("content-type")).toContain("text/csv");
      const text = await response.text();
      expect(text).toContain("daily-gift");
      expect(text).not.toMatch(/example\.test|@/);
      expect(text).not.toMatch(/ZR[0-9A-Z]{6}/);
    });
  });
});
