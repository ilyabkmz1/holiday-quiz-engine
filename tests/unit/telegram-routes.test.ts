import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";
import { signTelegramInitData } from "@/platform/telegram-init-data";

import { adventPackFixture } from "../fixtures/advent";
import { at, playDay } from "../support/advent";
import { smallCampaign } from "../support/small-campaign";

const BOT_TOKEN = "123456789:TEST-bot-token-only-for-route-tests-0000";
const SECRET = "platform-id-secret-for-tests-0123456789abcdef";

const env = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "https://advent.test",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16",
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  PLATFORM_ID_SECRET: SECRET
};

const world = vi.hoisted(() => ({ now: new Date(), build: null as null | ((tenant: unknown) => unknown) }));

vi.mock("@/server/container", () => ({
  getNow: () => new Date(world.now),
  getServices: () => {
    throw new Error("квиз-сервисы в этом тесте не нужны");
  },
  getAdventServices: (tenant: unknown) => world.build!(tenant)
}));

const TG_HOST = "advent.test";
const PLAIN_HOST = "plain.test";

async function boot() {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("NODE_ENV", "test");
  const { InMemoryAdventRepository } = await import("@/server/repositories/in-memory-advent-repository");
  const { AdventService } = await import("@/server/services/advent-service");
  const { IdentityService } = await import("@/server/services/identity-service");
  const { RewardService } = await import("@/server/services/reward-service");
  const { adventParticipantRateLimiter, publicApiRateLimiter } = await import("@/server/rate-limit");
  adventParticipantRateLimiter.reset();
  publicApiRateLimiter.reset();
  const repository = new InMemoryAdventRepository();
  const cache = new Map<string, unknown>();
  world.build = (tenant) => {
    const { advent } = tenant as { advent: import("@/config/advent-schema").AdventConfig };
    if (!cache.has(advent.slug)) {
      const rewardService = new RewardService(repository, advent, { qrSecret: "route-test-reward-qr-secret-0123456789abcdef" });
      const adventService = new AdventService(repository, advent, rewardService);
      cache.set(advent.slug, {
        prisma: { campaign: { upsert: async () => undefined } },
        repository,
        adventService,
        rewardService,
        identityService: new IdentityService({ repository, advent, verifyEndpoint: "https://advent.test/api/advent/identity/verify", sendLoginLink: async () => undefined })
      });
    }
    return cache.get(advent.slug);
  };
  world.now = at(3, 12);

  const base = adventPackFixture();
  const withTelegram = { ...base, hosts: [TG_HOST], platforms: { telegram: { botUsername: "zerno_advent_bot", appShortName: "advent" } } };
  const plain = { ...base, tenant: "plain-advent", hosts: [PLAIN_HOST], advent: { ...base.advent, slug: "plain-advent-campaign" } };
  const quiz = packSchema.parse({ tenant: "quiz", hosts: ["quiz.test"], campaign: smallCampaign("quiz-campaign") });
  const tenants = await import("@/server/tenants");
  tenants.overrideTenants(tenants.loadTenants([withTelegram, plain, quiz]));

  const advent = tenants.getTenants().find((tenant) => tenant.tenant === "zerno-advent") as import("@/server/tenants").AdventTenant;
  return {
    advent: advent.advent,
    repository,
    service: world.build(advent) as { adventService: import("@/server/services/advent-service").AdventService },
    participants: (await import("@/app/api/advent/participants/route")).POST,
    state: (await import("@/app/api/advent/state/route")).GET,
    open: (await import("@/app/api/advent/days/[n]/open/route")).POST,
    block: (await import("@/app/api/advent/days/[n]/blocks/[i]/route")).POST,
    identityRequest: (await import("@/app/api/advent/identity/request/route")).POST,
    visit: (await import("@/app/api/advent/platform/visit/route")).POST,
    ADVENT_COOKIE: (await import("@/server/advent-api")).ADVENT_COOKIE
  };
}

type App = Awaited<ReturnType<typeof boot>>;
type Init = { method?: string; host?: string; cookie?: string | null; body?: unknown; initData?: string | null };

function request(path: string, init: Init = {}): NextRequest {
  const host = init.host ?? TG_HOST;
  const method = init.method ?? "GET";
  const headers = new Headers({ host });
  if (method !== "GET") headers.set("origin", `https://${host}`);
  if (init.cookie) headers.set("cookie", `advent_participant_access=${init.cookie}`);
  if (init.initData !== undefined && init.initData !== null) headers.set("x-telegram-init-data", init.initData);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, `https://${host}`), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

function initDataFor(userId: number, extra: Record<string, string> = {}, token = BOT_TOKEN, authOffset = -60): string {
  return signTelegramInitData(
    { auth_date: String(Math.floor(world.now.getTime() / 1000) + authOffset), user: JSON.stringify({ id: userId, first_name: "Имя", username: "ник" }), ...extra },
    token
  );
}

async function join(app: App, userId: number, extra: Record<string, string> = {}) {
  const initData = initDataFor(userId, extra);
  const response = await app.participants(request("/api/advent/participants", { method: "POST", body: { consent: true }, initData }));
  return { response, initData, body: await json(response) };
}

describe("маршруты адвента с заголовком Telegram", () => {
  const logs: string[] = [];
  beforeEach(() => {
    logs.length = 0;
    for (const method of ["info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("первое открытие без участника — 401 (экран согласия); без согласия участник не создаётся", async () => {
    const app = await boot();
    const initData = initDataFor(1001);
    expect((await app.state(request("/api/advent/state", { initData }))).status).toBe(401);
    const noBody = await app.participants(request("/api/advent/participants", { method: "POST", initData }));
    expect(noBody.status).toBe(409);
    const refused = await app.participants(request("/api/advent/participants", { method: "POST", initData, body: { consent: false } }));
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toMatch(/согласие/i);
    expect((await app.state(request("/api/advent/state", { initData }))).status).toBe(401);
  });

  it("с согласием участник создаётся, согласие записано сервером, cookie не выдаётся; повтор возвращает того же", async () => {
    const app = await boot();
    const first = await join(app, 1001);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("set-cookie")).toBeNull();
    expect(first.body.state.participant).toMatchObject({ consent: true, email: null, canRemind: false });
    const again = await join(app, 1001);
    expect(again.body.participantId).toBe(first.body.participantId);
    const record = await app.repository.getParticipant(first.body.participantId);
    expect(record).toMatchObject({ platform: "telegram", normalizedEmail: null });
    expect(record!.consentAt).toEqual(world.now);
    const state = await app.state(request("/api/advent/state", { initData: first.initData }));
    expect(state.status).toBe(200);
    expect((await json(state)).participant.id).toBe(first.body.participantId);
  });

  it("разные пользователи — разные участники; один пользователь с новым initData — тот же", async () => {
    const app = await boot();
    const a = await join(app, 1);
    const b = await join(app, 2);
    expect(a.body.participantId).not.toBe(b.body.participantId);
    expect((await join(app, 1, { query_id: "второй запуск" })).body.participantId).toBe(a.body.participantId);
  });

  it("два параллельных первых запроса одного пользователя не создают двух участников", async () => {
    const app = await boot();
    const initData = initDataFor(555);
    const send = () => app.participants(request("/api/advent/participants", { method: "POST", body: { consent: true }, initData }));
    const [one, two, three] = await Promise.all([send(), send(), send()]);
    const ids = new Set([(await json(one)).participantId, (await json(two)).participantId, (await json(three)).participantId]);
    expect(ids.size).toBe(1);
  });

  it("невалидный заголовок — 401 без отката на cookie, даже если cookie валидна", async () => {
    const app = await boot();
    const web = await app.participants(request("/api/advent/participants", { method: "POST" }));
    const cookie = web.cookies.get(app.ADVENT_COOKIE)!.value;
    expect((await app.state(request("/api/advent/state", { cookie }))).status).toBe(200);
    for (const initData of ["garbage", initDataFor(1, {}, "999:other-bot-token"), initDataFor(1, {}, BOT_TOKEN, -2 * 24 * 3600), initDataFor(1, {}, BOT_TOKEN, 3600), ""]) {
      const response = await app.state(request("/api/advent/state", { cookie, initData }));
      expect(response.status).toBe(401);
      const body = await json(response);
      expect(JSON.stringify(body)).not.toContain(BOT_TOKEN);
    }
    const created = await app.participants(request("/api/advent/participants", { method: "POST", cookie, initData: "garbage", body: { consent: true } }));
    expect(created.status).toBe(401);
  });

  it("арендатор без Telegram в пакете отвергает заголовок; квиз-арендатор — 404", async () => {
    const app = await boot();
    const initData = initDataFor(1);
    const rejected = await app.participants(request("/api/advent/participants", { method: "POST", host: PLAIN_HOST, initData, body: { consent: true } }));
    expect(rejected.status).toBe(401);
    expect((await app.state(request("/api/advent/state", { host: PLAIN_HOST, initData }))).status).toBe(401);
    // Без заголовка тот же арендатор работает как обычный веб.
    expect((await app.participants(request("/api/advent/participants", { method: "POST", host: PLAIN_HOST }))).status).toBe(200);
    expect((await app.state(request("/api/advent/state", { host: "quiz.test", initData }))).status).toBe(404);
  });

  it("Telegram включён, а токен бота не задан в окружении — заголовок отвергается", async () => {
    const app = await boot();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const response = await app.participants(request("/api/advent/participants", { method: "POST", initData: initDataFor(1), body: { consent: true } }));
    expect(response.status).toBe(401);
  });

  it("токен бота клиента (TELEGRAM_BOT_TOKEN__<БОТ>) важнее общего", async () => {
    const app = await boot();
    const own = "555:own-bot-token-for-the-client-0000000000";
    vi.stubEnv("TELEGRAM_BOT_TOKEN__ZERNO_ADVENT_BOT", own);
    const withOwn = signTelegramInitData({ auth_date: String(Math.floor(world.now.getTime() / 1000)), user: JSON.stringify({ id: 9 }) }, own);
    expect((await app.participants(request("/api/advent/participants", { method: "POST", initData: withOwn, body: { consent: true } }))).status).toBe(200);
    expect((await app.participants(request("/api/advent/participants", { method: "POST", initData: initDataFor(9), body: { consent: true } }))).status).toBe(401);
  });

  it("промокод выдаётся без email: участник Telegram подтверждён, код и QR появляются сразу", async () => {
    const app = await boot();
    const { initData, body } = await join(app, 2024);
    const participantId: string = body.participantId;
    const opened = await app.open(request("/api/advent/days/3/open", { method: "POST", initData }), ctx({ n: "3" }));
    expect(opened.status).toBe(200);
    await playDay(app.service.adventService, app.advent, participantId, 3, world.now);
    const state = await json(await app.state(request("/api/advent/state", { initData })));
    expect(state.participant.email).toBeNull();
    const gift = state.grants.find((grant: { source: string }) => grant.source === "day");
    expect(gift).toBeTruthy();
    expect(gift.needsIdentity).toBe(false);
    expect(gift.code ?? gift.qr).toBeTruthy();
  });

  it("блок подарка через маршрут не отвечает identity_required для участника Telegram", async () => {
    const app = await boot();
    world.now = at(4, 12);
    const { initData, body } = await join(app, 2025);
    await app.open(request("/api/advent/days/4/open", { method: "POST", initData }), ctx({ n: "4" }));
    const day = app.advent.days.find((candidate) => candidate.n === 4)!;
    const index = day.blocks.findIndex((block) => block.type === "luck");
    expect(index).toBeGreaterThan(-1);
    // Предыдущие блоки дня проходим сервисом, награду — маршрутом.
    for (const [i, block] of day.blocks.entries()) {
      if (i >= index) break;
      const { correctPayload } = await import("@/domain/solve");
      if (block.type === "story") await app.service.adventService.submitBlock(body.participantId, 4, i, {}, world.now);
      if (block.type === "task") await app.service.adventService.submitBlock(body.participantId, 4, i, correctPayload(block.task), world.now);
    }
    const response = await app.block(request(`/api/advent/days/4/blocks/${index}`, { method: "POST", initData, body: { payload: { choice: 0 } } }), ctx({ n: "4", i: String(index) }));
    expect(response.status).toBe(200);
    const result = await json(response);
    expect(result.status).toBe("ok");
    expect(result.block.reward.code).toBeTruthy();
  });

  it("вход по email для участника Telegram пока недоступен (409), cookie не выдаётся", async () => {
    const app = await boot();
    const { initData } = await join(app, 77);
    const response = await app.identityRequest(request("/api/advent/identity/request", { method: "POST", initData, body: { email: "a@b.ru", consent: true, marketingConsent: false, reminderOptIn: false } }));
    expect(response.status).toBe(409);
  });

  it("переход с меткой источника считается агрегатом; без метки и с чужой подписью — нет", async () => {
    const app = await boot();
    const ok = await app.visit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(1, { start_param: "d6_s_channel" }), body: {} }));
    expect(ok.status).toBe(200);
    await app.visit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(2, { start_param: "d6_s_channel" }), body: {} }));
    await app.visit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(3, { start_param: "d6" }), body: {} }));
    await app.visit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(3, { start_param: "s_chat" }), body: {} }));
    const bad = await app.visit(request("/api/advent/platform/visit", { method: "POST", initData: initDataFor(3, { start_param: "s_evil" }, "1:other-bot"), body: {} }));
    expect(bad.status).toBe(401);
    expect((await app.visit(request("/api/advent/platform/visit", { method: "POST", body: {} }))).status).toBe(401);
    const rows = await app.repository.listSourceVisits(app.advent.slug);
    expect(rows).toEqual([
      { source: "channel", date: "2026-12-22", opens: 2 },
      { source: "chat", date: "2026-12-22", opens: 1 }
    ]);
  });

  it("в логи не попадают ни токен бота, ни initData, ни числовой id пользователя", async () => {
    const app = await boot();
    const { initData } = await join(app, 31337);
    await app.state(request("/api/advent/state", { initData: "garbage" }));
    await app.state(request("/api/advent/state", { initData }));
    const all = logs.join("\n");
    expect(all).not.toContain(BOT_TOKEN);
    expect(all).not.toContain(initData);
    expect(all).not.toContain("31337");
    expect(all).not.toContain(SECRET);
  });

  it("в БД нет сырого идентификатора, имени и username", async () => {
    const app = await boot();
    const { body } = await join(app, 424242);
    const record = JSON.stringify(await app.repository.getParticipant(body.participantId));
    expect(record).not.toContain("424242");
    expect(record).not.toContain("ник");
    const hash = (await import("@/server/telegram-config")).subjectHash("telegram", app.advent.slug, "424242", SECRET);
    const found = await app.repository.findParticipantByIdentity(app.advent.slug, "telegram", hash);
    expect(found?.id).toBe(body.participantId);
  });
});
