import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adventSchema } from "@/config/advent-schema";
import { ADVENT_COOKIE } from "@/server/advent-api";
import { overrideServices } from "@/server/container";
import { getPrisma } from "@/server/db";
import { PrismaAdventRepository } from "@/server/repositories/prisma-advent-repository";
import { AdventService } from "@/server/services/advent-service";
import { RewardService } from "@/server/services/reward-service";
import { saveTenantAdmin } from "@/server/tenant-admins";
import { loadTenants, overrideTenants } from "@/server/tenants";

import { POST as createParticipant } from "@/app/api/advent/participants/route";
import { GET as getState } from "@/app/api/advent/state/route";
import { POST as postOpen } from "@/app/api/advent/days/[n]/open/route";
import { POST as postBlock } from "@/app/api/advent/days/[n]/blocks/[i]/route";
import { POST as postIdentityRequest } from "@/app/api/advent/identity/request/route";
import { POST as postIdentityVerify } from "@/app/api/advent/identity/verify/route";
import { POST as postRedeem } from "@/app/api/advent/redeem/route";
import { POST as postCodes } from "@/app/api/admin/advent/codes/route";
import { GET as getGrantsCsv } from "@/app/api/admin/advent/grants.csv/route";

import { adventFixture, adventPackFixture } from "../fixtures/advent";
import { at, playDay, seededRng } from "../support/advent";
import { sensitiveValues } from "./helpers/leak-guard";

const HOST = "advent.test";
const SLUG = "zerno-advent";

const clock = { value: at(4, 12) };
const sent: Array<{ email: string; token: string }> = [];
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

function request(path: string, init: { method?: string; cookie?: string | null; auth?: string; body?: unknown; raw?: string } = {}): NextRequest {
  const method = init.method ?? "GET";
  const headers = new Headers({ host: HOST });
  if (method !== "GET") headers.set("origin", `http://${HOST}`);
  if (init.cookie) headers.set("cookie", `${ADVENT_COOKIE}=${init.cookie}`);
  if (init.auth) headers.set("authorization", init.auth);
  let body: string | undefined;
  if (init.raw !== undefined) {
    body = init.raw;
    headers.set("content-type", "text/csv");
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(new URL(path, `http://${HOST}`), { method, headers, body });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const json = (response: Response) => response.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Участник с подтверждённым email через маршруты; возвращает cookie после входа. */
async function signedUp(email: string): Promise<{ cookie: string; participantId: string }> {
  const created = await createParticipant(request("/api/advent/participants", { method: "POST" }));
  const cookie = created.cookies.get(ADVENT_COOKIE)!.value;
  const participantId = (await json(created)).participantId as string;
  await postIdentityRequest(request("/api/advent/identity/request", { method: "POST", cookie, body: { email, consent: true } }));
  const token = sent.at(-1)!.token;
  const verified = await postIdentityVerify(request("/api/advent/identity/verify", { method: "POST", cookie, body: { token } }));
  const fresh = verified.cookies.get(ADVENT_COOKIE)!.value;
  sensitiveValues.add(fresh);
  return { cookie: fresh, participantId };
}

const open = (cookie: string, n: number) => postOpen(request(`/api/advent/days/${n}/open`, { method: "POST", cookie }), ctx({ n: String(n) }));
const block = (cookie: string, n: number, i: number, payload?: unknown) =>
  postBlock(request(`/api/advent/days/${n}/blocks/${i}`, { method: "POST", cookie, body: payload === undefined ? undefined : { payload } }), ctx({ n: String(n), i: String(i) }));

describe("награды адвента на PostgreSQL", () => {
  beforeEach(() => {
    clock.value = at(4, 12);
    sent.length = 0;
    vi.stubEnv("REWARD_QR_SECRET", "integration-reward-qr-secret-0123456789abcdef");
    vi.stubEnv("SUPERADMIN", "");
    overrideServices({
      now: () => new Date(clock.value),
      rewards: { rng: seededRng(11) },
      sendLogin: async (email, link) => {
        const token = new URL(link).searchParams.get("token")!;
        sensitiveValues.add(token);
        sensitiveValues.add(email);
        sent.push({ email, token });
      }
    });
    const pack = adventPackFixture();
    // Награда из списка и ограниченный остаток: проверяем атомарность на настоящей БД.
    pack.advent.rewards.find((reward: any) => reward.id === "luck-b").stock = 3; // eslint-disable-line @typescript-eslint/no-explicit-any
    pack.advent.rewards.find((reward: any) => reward.id === "daily-gift").codes = { list: "codes/daily.csv" }; // eslint-disable-line @typescript-eslint/no-explicit-any
    overrideTenants(loadTenants([{ ...pack, hosts: [HOST] }]));
  });
  afterEach(() => {
    overrideTenants(null);
    vi.unstubAllEnvs();
  });

  async function credentials() {
    const prisma = getPrisma();
    const operator = await saveTenantAdmin(prisma, { tenantSlug: SLUG, username: "ops" });
    const cashier = await saveTenantAdmin(prisma, { tenantSlug: SLUG, username: "kassa", role: "cashier" });
    sensitiveValues.add(operator.password);
    sensitiveValues.add(cashier.password);
    return { operator: basic("ops", operator.password), cashier: basic("kassa", cashier.password) };
  }

  it("роли на настоящей БД: кассир гасит, но не импортирует коды и не выгружает; оператор может всё; роль не сбрасывается сменой пароля", async () => {
    const { operator, cashier } = await credentials();
    expect((await postRedeem(request("/api/advent/redeem", { method: "POST", auth: cashier, body: { code: "NOPE-1" } }))).status).toBe(404);
    expect((await postRedeem(request("/api/advent/redeem", { method: "POST", auth: operator, body: { code: "NOPE-1" } }))).status).toBe(404);
    expect((await postRedeem(request("/api/advent/redeem", { method: "POST", body: { code: "X" } }))).status).toBe(401);
    expect((await postRedeem(request("/api/advent/redeem", { method: "POST", auth: basic("kassa", "wrong-password-0123456789"), body: { code: "X" } }))).status).toBe(401);

    const url = "/api/admin/advent/codes?rewardId=daily-gift";
    expect((await postCodes(request(url, { method: "POST", auth: cashier, raw: "code\nQQ-001\n" }))).status).toBe(401);
    expect((await getGrantsCsv(request("/api/admin/advent/grants.csv", { auth: cashier }))).status).toBe(401);
    expect(await json(await postCodes(request(url, { method: "POST", auth: operator, raw: "code\nQQ-001\nQQ-002\n" })))).toMatchObject({ added: 2 });
    expect((await getGrantsCsv(request("/api/admin/advent/grants.csv", { auth: operator }))).status).toBe(200);

    await saveTenantAdmin(getPrisma(), { tenantSlug: SLUG, username: "kassa", password: "brand-new-cashier-password-1" });
    const row = await getPrisma().tenantAdmin.findUniqueOrThrow({ where: { tenantSlug_username: { tenantSlug: SLUG, username: "kassa" } } });
    expect(row.role).toBe("cashier");
  });

  it("весь путь: вход, подарок дня из пула, удача, личный QR, погашение кассиром один раз; выгрузка без email и кодов", async () => {
    const { operator, cashier } = await credentials();
    await postCodes(request("/api/admin/advent/codes?rewardId=daily-gift", { method: "POST", auth: operator, raw: "code\nGIFT-AAA\nGIFT-BBB\n" }));
    clock.value = at(1, 12);
    const user = await signedUp("guest@example.test");
    sensitiveValues.add("GIFT-AAA");
    sensitiveValues.add("GIFT-BBB");
    await open(user.cookie, 1);
    const advent = adventSchema.parse(adventFixture());
    for (const [index, item] of advent.days[0].blocks.entries()) {
      const response = await block(user.cookie, 1, index, item.type === "task" ? (await import("@/domain/solve")).correctPayload(item.task) : {});
      expect(response.status).toBe(200);
    }
    const state = await json(await getState(request("/api/advent/state", { cookie: user.cookie })));
    const gift = state.grants.find((grant: any) => grant.source === "day"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(gift.code).toMatch(/^GIFT-(AAA|BBB)$/);
    expect(gift.qr.payload).toMatch(/^ADV1\./);
    expect(state.doors[0].completed).toBe(true);

    const ok = await postRedeem(request("/api/advent/redeem", { method: "POST", auth: cashier, body: { code: gift.qr.payload } }));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "redeemed" });
    const again = await postRedeem(request("/api/advent/redeem", { method: "POST", auth: cashier, body: { code: gift.code } }));
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ status: "already_redeemed" });
    expect((await getPrisma().rewardGrant.findUniqueOrThrow({ where: { id: gift.id } })).status).toBe("redeemed");

    const csv = await (await getGrantsCsv(request("/api/admin/advent/grants.csv", { auth: operator }))).text();
    expect(csv).toContain(gift.id);
    expect(csv).not.toMatch(/guest@example\.test|GIFT-/);
  });

  it("остаток удачи не уходит в минус при параллельных розыгрышах; анонимный получает identity_required без списания", async () => {
    const prisma = getPrisma();
    const pack = adventPackFixture();
    const advent = adventSchema.parse({ ...pack.advent });
    await prisma.campaign.upsert({ where: { slug: advent.slug }, update: {}, create: { slug: advent.slug, title: advent.title } });
    // Расширяем пакет: приз с остатком 3 весит почти всё, запасной — без остатка.
    const patched = adventSchema.parse({
      ...pack.advent,
      rewards: pack.advent.rewards.map((reward: any) => (reward.id === "luck-b" ? { ...reward, stock: 3, codes: { generated: { prefix: "TOP", length: 5 } } } : reward)), // eslint-disable-line @typescript-eslint/no-explicit-any
      days: pack.advent.days.map((day: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
        day.n === 4 ? { ...day, blocks: day.blocks.map((item: any) => (item.type === "luck" ? { ...item, pool: [{ rewardId: "luck-b", weight: 1000 }, { rewardId: "luck-a", weight: 1 }] } : item)) } : day) // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    const repository = new PrismaAdventRepository(prisma);
    const rewards = new RewardService(repository, patched, { qrSecret: "integration-reward-qr-secret-0123456789abcdef", rng: seededRng(5) });
    const service = new AdventService(repository, patched, rewards);
    const luckIndex = patched.days[3].blocks.findIndex((item) => item.type === "luck");

    const anonymous = await service.createParticipant(at(4, 9));
    await service.openDay(anonymous.participant.id, 4, at(4, 10));
    await service.submitBlock(anonymous.participant.id, 4, 0, {}, at(4, 10));
    expect((await service.submitBlock(anonymous.participant.id, 4, luckIndex, { choice: 0 }, at(4, 11))).status).toBe("identity_required");
    expect(await prisma.rewardStock.count()).toBe(0);

    const people = [];
    for (let index = 0; index < 14; index += 1) {
      const { participant } = await service.createParticipant(at(4, 9));
      await prisma.participant.update({ where: { id: participant.id }, data: { normalizedEmail: `p${index}@example.test`, consentAt: at(4, 9) } });
      await service.openDay(participant.id, 4, at(4, 10));
      await service.submitBlock(participant.id, 4, 0, {}, at(4, 10));
      people.push(participant.id);
    }
    const results = await Promise.all(people.map((id) => service.submitBlock(id, 4, luckIndex, { choice: 1 }, at(4, 11))));
    const won = results.map((result) => (result.status === "ok" ? result.block.reward!.rewardId : "identity_required"));
    expect(won.filter((id) => id === "luck-b")).toHaveLength(3);
    expect(won.filter((id) => id === "luck-a")).toHaveLength(11);
    expect((await prisma.rewardStock.findUniqueOrThrow({ where: { campaignSlug_rewardId: { campaignSlug: advent.slug, rewardId: "luck-b" } } })).left).toBe(0);
    // Повторные запросы возвращают те же исходы и не списывают остаток.
    const repeat = await Promise.all(people.map((id) => service.submitBlock(id, 4, luckIndex, { choice: 0 }, at(4, 12))));
    expect(repeat.map((result) => (result.status === "ok" ? result.block.reward!.id : ""))).toEqual(results.map((result) => (result.status === "ok" ? result.block.reward!.id : "")));
    const codes = (await prisma.rewardGrant.findMany({ where: { source: "luck" } })).map((grant) => grant.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code !== null)).toBe(true);
    await playDay(service, patched, people[0], 4, at(4, 13));
  });
});
