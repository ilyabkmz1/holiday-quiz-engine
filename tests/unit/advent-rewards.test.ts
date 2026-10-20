import { describe, expect, it } from "vitest";

import { grantsToCsv } from "@/server/csv";
import { assertRewardSecrets, resolveRewardSecret } from "@/server/launch-checks";
import { DEV_QR_SECRET, RewardService, secretLuckSeed } from "@/server/services/reward-service";
import { luckSeed } from "@/domain/advent/draw";
import { authenticateAdminRole } from "@/server/admin-auth";
import { hashPassword } from "@/server/password";
import { isAdminPagePath, isRedeemPagePath } from "@/server/admin-gate";
import { adventSchema } from "@/config/advent-schema";

import { adventFixture } from "../fixtures/advent";
import { adventConfig, at, newAdventService, playDay, seededRng, verifyParticipant } from "../support/advent";

/* eslint-disable @typescript-eslint/no-explicit-any */
const luckIndex = (advent: ReturnType<typeof adventConfig>, day: number) => advent.days[day - 1].blocks.findIndex((block) => block.type === "luck");
const promoIndex = (advent: ReturnType<typeof adventConfig>, day: number) => advent.days[day - 1].blocks.findIndex((block) => block.type === "promo");

async function startDay4(ctx: ReturnType<typeof newAdventService>, verified = true) {
  const created = await ctx.service.createParticipant(at(4, 9));
  const participant = verified ? await verifyParticipant(ctx, created.participant.id, at(4, 9, 30)) : created.participant;
  await ctx.service.openDay(participant.id, 4, at(4, 10));
  await ctx.service.submitBlock(participant.id, 4, 0, {}, at(4, 10));
  return participant;
}

describe("удача", () => {
  it("анонимному — identity_required: блок не отмечен, ничего не разыграно и не списано, после входа блок проходится", async () => {
    const ctx = newAdventService();
    const { advent, service, repository } = ctx;
    const idx = luckIndex(advent, 4);
    const anon = await startDay4(ctx, false);
    const response = await service.submitBlock(anon.id, 4, idx, { choice: 1 }, at(4, 11));
    expect(response).toMatchObject({ status: "identity_required", block: { type: "luck", outcome: null, reward: null } });
    expect((await repository.listBlockResults(anon.id)).some((result) => result.blockIndex === idx)).toBe(false);
    expect((await repository.listGrants(anon.id)).some((grant) => grant.source === "luck")).toBe(false);
    expect(await repository.stockLeft(advent.slug)).toEqual({});

    await verifyParticipant(ctx, anon.id, at(4, 12));
    const done = await service.submitBlock(anon.id, 4, idx, { choice: 1 }, at(4, 12, 5));
    expect(done.status).toBe("ok");
    expect(done.block.reward).toMatchObject({ source: "luck", day: 4 });
    expect((await service.state(anon.id, at(4, 13))).doors[3]).toMatchObject({ completed: true });
  });

  it("исход виден только после фиксации; повтор (в том числе с другой коробкой) возвращает тот же приз, остаток списан один раз", async () => {
    const ctx = newAdventService();
    const { advent, service, repository } = ctx;
    const idx = luckIndex(advent, 4);
    const p = await startDay4(ctx);
    const before = await service.state(p.id, at(4, 10, 30));
    expect(before.days[0].blocks[idx]).toMatchObject({ type: "luck", done: false, ready: true, reveal: null });
    expect(JSON.stringify(before)).not.toMatch(/luck-b|weight/);

    const first = await service.submitBlock(p.id, 4, idx, { choice: 0 }, at(4, 11));
    const second = await service.submitBlock(p.id, 4, idx, { choice: 2 }, at(4, 12));
    expect(second.block.reward!.id).toBe(first.block.reward!.id);
    expect(second.block.reward!.rewardId).toBe(first.block.reward!.rewardId);
    expect((await repository.listGrants(p.id)).filter((grant) => grant.source === "luck")).toHaveLength(1);
    const stock = await repository.stockLeft(advent.slug);
    expect(stock["luck-b"]).toBe(first.block.reward!.rewardId === "luck-b" ? 29 : 30);
    expect(first.block.reward!.code).toMatch(/^(LUCK|TOP)/);
  });

  it("детерминирована: тот же участник и день дают тот же приз в независимых сервисах", async () => {
    const a = newAdventService();
    const p = await startDay4(a);
    const idx = luckIndex(a.advent, 4);
    const won = (await a.service.submitBlock(p.id, 4, idx, { choice: 0 }, at(4, 11))).block.reward!.rewardId;
    // Тот же id участника в чистом хранилище: зерно (кампания, участник, день) то же.
    const b = newAdventService();
    await b.repository.createParticipant({ ...(await a.repository.getParticipant(p.id))!, accessKeyHash: "other-hash" });
    await b.service.openDay(p.id, 4, at(4, 10));
    await b.service.submitBlock(p.id, 4, 0, {}, at(4, 10));
    expect((await b.service.submitBlock(p.id, 4, idx, { choice: 1 }, at(4, 11))).block.reward!.rewardId).toBe(won);
  });

  it("остаток не уходит в минус: призы с остатком 2 выпадают не больше двух раз, остальные получают запасной приз", async () => {
    const advent = adventConfig((draft) => {
      draft.rewards.find((reward: any) => reward.id === "luck-b").stock = 2;
      draft.days[3].blocks[1].pool = [{ rewardId: "luck-b", weight: 1000 }, { rewardId: "luck-a", weight: 1 }];
    });
    const ctx = newAdventService(advent);
    const idx = luckIndex(advent, 4);
    const won: string[] = [];
    const people = await Promise.all(Array.from({ length: 8 }, async () => startDay4(ctx)));
    const results = await Promise.all(people.map((p) => ctx.service.submitBlock(p.id, 4, idx, { choice: 0 }, at(4, 11))));
    for (const result of results) won.push(result.block.reward!.rewardId);
    expect(won.filter((id) => id === "luck-b")).toHaveLength(2);
    expect(won.filter((id) => id === "luck-a")).toHaveLength(6);
    expect((await ctx.repository.stockLeft(advent.slug))["luck-b"]).toBe(0);
  });

  it("пустой пул кодов у приза: он исключается и выдаётся запасной приз; события пустого пула нет, остаток не списан", async () => {
    const advent = adventConfig((draft) => {
      const b = draft.rewards.find((reward: any) => reward.id === "luck-b");
      b.codes = { list: "codes/luck-b.csv" };
      draft.days[3].blocks[1].pool = [{ rewardId: "luck-b", weight: 1000 }, { rewardId: "luck-a", weight: 1 }];
    });
    const ctx = newAdventService(advent);
    const idx = luckIndex(advent, 4);
    const [first, second] = [await startDay4(ctx), await startDay4(ctx)];
    await ctx.repository.importCodes(advent.slug, "luck-b", ["TOPONLY1"]);
    const r1 = await ctx.service.submitBlock(first.id, 4, idx, { choice: 0 }, at(4, 11));
    const r2 = await ctx.service.submitBlock(second.id, 4, idx, { choice: 0 }, at(4, 11));
    expect(r1.block.reward).toMatchObject({ rewardId: "luck-b", code: "TOPONLY1" });
    expect(r2.block.reward!.rewardId).toBe("luck-a");
    expect((await ctx.repository.stockLeft(advent.slug))["luck-b"]).toBe(29);
  });

  it("порядок и вход: сначала остальные блоки дня; неверная коробка — invalid", async () => {
    const ctx = newAdventService();
    const idx = luckIndex(ctx.advent, 4);
    const created = await ctx.service.createParticipant(at(4, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(4, 9, 30));
    await ctx.service.openDay(p.id, 4, at(4, 10));
    await expect(ctx.service.submitBlock(p.id, 4, idx, { choice: 0 }, at(4, 10))).rejects.toMatchObject({ code: "conflict" });
    await ctx.service.submitBlock(p.id, 4, 0, {}, at(4, 10));
    for (const choice of [-1, 3, 1.5, "0", undefined]) {
      await expect(ctx.service.submitBlock(p.id, 4, idx, { choice }, at(4, 10))).rejects.toMatchObject({ code: "invalid" });
    }
    expect((await ctx.repository.listGrants(p.id)).some((grant) => grant.source === "luck")).toBe(false);
  });
});

describe("зерно удачи", () => {
  it("секретное: без секрета исход по id участника не посчитать заранее", () => {
    const a = secretLuckSeed("secret-a".repeat(4), "zerno", "p1", 4);
    expect(secretLuckSeed("secret-a".repeat(4), "zerno", "p1", 4)).toBe(a);
    expect(secretLuckSeed("secret-b".repeat(4), "zerno", "p1", 4)).not.toBe(a);
    expect(a).not.toBe(luckSeed("zerno", "p1", 4));
    expect(secretLuckSeed("secret-a".repeat(4), "zerno", "p1", 5)).not.toBe(a);
    // С разными секретами исходы расходятся на заметной доле участников.
    const pool = [{ rewardId: "big", weight: 1 }, { rewardId: "small", weight: 1 }];
    const ids = Array.from({ length: 200 }, (_, index) => `p${index}`);
    const differ = ids.filter((id) => {
      const draw = (secret: string) => (secretLuckSeed(secret, "zerno", id, 4) / 2 ** 32 < 0.5 ? pool[0] : pool[1]).rewardId;
      return draw("secret-a".repeat(4)) !== draw("secret-b".repeat(4));
    });
    expect(differ.length).toBeGreaterThan(50);
  });
});

describe("подарок дня (promo)", () => {
  it("вошедший получает награду дня с кодом, день становится пройденным; награда выдаётся один раз", async () => {
    const ctx = newAdventService();
    const created = await ctx.service.createParticipant(at(1, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(1, 9, 30));
    await ctx.service.openDay(p.id, 1, at(1, 10));
    await playDay(ctx.service, ctx.advent, p.id, 1, at(1, 11));
    await playDay(ctx.service, ctx.advent, p.id, 1, at(1, 12));
    const grants = (await ctx.repository.listGrants(p.id)).filter((grant) => grant.source === "day");
    expect(grants).toHaveLength(1);
    expect(grants[0].code).toMatch(/^ZR[0-9A-Z]{6}$/);
    const state = await ctx.service.state(p.id, at(1, 13));
    expect(state.doors[0]).toMatchObject({ completed: true, blocksDone: 3, blocksTotal: 3 });
    const promo = state.days[0].blocks[promoIndex(ctx.advent, 1)];
    expect(promo).toMatchObject({ type: "promo", done: true, reveal: { code: grants[0].code, redeem: "cashier" } });
  });

  it("день не пройден, пока не выполнены luck и promo", async () => {
    const ctx = newAdventService();
    const created = await ctx.service.createParticipant(at(1, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(1, 9, 30));
    await ctx.service.openDay(p.id, 1, at(1, 10));
    await ctx.service.submitBlock(p.id, 1, 0, {}, at(1, 10));
    expect((await ctx.service.state(p.id, at(1, 11))).doors[0]).toMatchObject({ completed: false, blocksDone: 1 });
  });

  it("награда без кода и остатка анонимному выдаётся без входа", async () => {
    const advent = adventConfig((draft) => {
      draft.rewards.push({ id: "fact", kind: "gift", label: "Факт дня", description: "", redeem: "none" });
      draft.days[0].blocks[2] = { type: "promo", rewardId: "fact" };
      draft.days[0].rewardId = "fact";
    });
    const ctx = newAdventService(advent);
    const { participant } = await ctx.service.createParticipant(at(1, 9));
    await ctx.service.openDay(participant.id, 1, at(1, 10));
    await playDay(ctx.service, advent, participant.id, 1, at(1, 11));
    expect((await ctx.service.state(participant.id, at(1, 12))).doors[0].completed).toBe(true);
  });

  it("догнанный день при rewardOnlyOnDay: блок пройден, награды нет", async () => {
    const ctx = newAdventService();
    const created = await ctx.service.createParticipant(at(1, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(1, 9, 30));
    await ctx.service.openDay(p.id, 5, at(6, 9)); // день 5 догоняется на 6-й
    await playDay(ctx.service, ctx.advent, p.id, 5, at(6, 10));
    expect((await ctx.repository.listGrants(p.id)).filter((grant) => grant.source === "day")).toEqual([]);
    expect((await ctx.service.state(p.id, at(6, 11))).doors[4].completed).toBe(true);
  });
});

describe("коды и выдача после входа", () => {
  it("пустой пул: выдача без кода, событие без персональных данных; после загрузки кодов код приходит сам", async () => {
    const advent = adventConfig((draft) => {
      draft.rewards.find((reward: any) => reward.id === "daily-gift").codes = { list: "codes/daily.csv" };
    });
    const ctx = newAdventService(advent);
    const created = await ctx.service.createParticipant(at(2, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(2, 9, 30));
    await ctx.service.openDay(p.id, 2, at(2, 10));
    await playDay(ctx.service, advent, p.id, 2, at(2, 11));
    const state = await ctx.service.state(p.id, at(2, 12));
    expect(state.grants.find((grant) => grant.source === "day")).toMatchObject({ code: null, codePending: true, qr: null });
    expect(ctx.audit.some((entry) => entry.event === "reward_pool_empty")).toBe(true);
    expect(JSON.stringify(ctx.audit)).not.toContain("example.test");

    const report = await ctx.rewards.importCodes("daily-gift", "code\nabc-123\n");
    expect(report.added).toBe(1);
    const healed = await ctx.service.state(p.id, at(2, 13));
    expect(healed.grants.find((grant) => grant.source === "day")).toMatchObject({ code: "ABC-123", codePending: false });
  });

  it("static: одинаковый код у всех; generated: коды уникальны даже при совпадении генератора", async () => {
    const advent = adventConfig((draft) => {
      draft.rewards.find((reward: any) => reward.id === "daily-gift").codes = { static: "NY2027" };
    });
    const ctx = newAdventService(advent);
    const codes: Array<string | null> = [];
    for (let i = 0; i < 2; i += 1) {
      const created = await ctx.service.createParticipant(at(2, 9));
      const p = await verifyParticipant(ctx, created.participant.id, at(2, 9, 30), `user${i}@example.test`);
      await ctx.service.openDay(p.id, 2, at(2, 10));
      await playDay(ctx.service, advent, p.id, 2, at(2, 11));
      codes.push((await ctx.repository.listGrants(p.id)).find((grant) => grant.source === "day")!.code);
    }
    expect(codes).toEqual(["NY2027", "NY2027"]);

    // Залипший генератор: каждый вызов возвращает один и тот же код, пока тот не занят.
    const stuck = newAdventService(adventConfig(), { rng: () => 0 });
    const a = await stuck.service.createParticipant(at(2, 9));
    const b = await stuck.service.createParticipant(at(2, 9));
    const pa = await verifyParticipant(stuck, a.participant.id, at(2, 9, 30), "a@example.test");
    await expect(verifyParticipant(stuck, b.participant.id, at(2, 9, 30), "b@example.test").then(async (pb) => {
      for (const p of [pa, pb]) {
        await stuck.service.openDay(p.id, 2, at(2, 10));
        await playDay(stuck.service, stuck.advent, p.id, 2, at(2, 11));
      }
    })).rejects.toThrow(/уникальный код/);
  });

  it("ensureCodes идемпотентен: повтор не меняет код", async () => {
    const ctx = newAdventService();
    const created = await ctx.service.createParticipant(at(1, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(1, 9, 30));
    await ctx.service.openDay(p.id, 1, at(1, 10));
    await playDay(ctx.service, ctx.advent, p.id, 1, at(1, 11));
    const before = await ctx.repository.listGrants(p.id);
    await ctx.service.ensureCodes(p.id, at(1, 12));
    await ctx.service.ensureCodes(p.id, at(1, 13));
    expect(await ctx.repository.listGrants(p.id)).toEqual(before);
  });

  it("анонимному цели и подарок за старт записываются без кода и получают код при входе; срок отсчитывается от входа", async () => {
    const advent = adventConfig((draft) => { draft.streak.endowedRewardId = "daily-gift"; });
    const ctx = newAdventService(advent);
    const { participant } = await ctx.service.createParticipant(at(1, 9));
    for (const n of [1, 2, 3]) await ctx.service.openDay(participant.id, n, at(n, 9));
    const anonymous = await ctx.repository.listGrants(participant.id);
    expect(anonymous.length).toBeGreaterThanOrEqual(2);
    expect(anonymous.every((grant) => grant.code === null && grant.expiresAt === null)).toBe(true);
    await verifyParticipant(ctx, participant.id, at(3, 12));
    const after = await ctx.repository.listGrants(participant.id);
    for (const grant of after) {
      const reward = advent.rewards.find((candidate) => candidate.id === grant.rewardId);
      if (reward?.codes) expect(grant.code).not.toBeNull();
      if (reward?.validDays) expect(grant.expiresAt).toEqual(new Date(at(3, 12).getTime() + reward.validDays * 86_400_000));
    }
  });
});

describe("касса", () => {
  async function prepare(patch?: (draft: any) => void) {
    const advent = adventConfig(patch);
    const ctx = newAdventService(advent);
    const created = await ctx.service.createParticipant(at(2, 9));
    const p = await verifyParticipant(ctx, created.participant.id, at(2, 9, 30));
    await ctx.service.openDay(p.id, 2, at(2, 10));
    await playDay(ctx.service, advent, p.id, 2, at(2, 11));
    const state = await ctx.service.state(p.id, at(2, 12));
    const view = state.grants.find((grant) => grant.source === "day")!;
    return { ...ctx, advent, participant: p, view };
  }

  it("QR только владельцу и вошедшему; по QR и по тексту кода награда гасится один раз", async () => {
    const { rewards, view } = await prepare();
    expect(view.qr!.payload).toMatch(/^ADV1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    expect(view.qr!.url).toBe(`https://advent.test/redeem?code=${encodeURIComponent(view.qr!.payload)}`);
    expect(await rewards.inspect(view.qr!.payload, at(2, 13))).toMatchObject({ status: "ready", label: "Напиток или десерт дня" });
    expect(await rewards.inspect(view.qr!.url!, at(2, 13))).toMatchObject({ status: "ready" });
    expect(await rewards.redeem(view.qr!.payload, at(2, 14))).toMatchObject({ status: "redeemed" });
    const again = await rewards.redeem(view.code!.toLowerCase(), at(2, 15));
    expect(again).toMatchObject({ status: "already_redeemed", redeemedAt: at(2, 14) });
  });

  it("погашение по тексту личного кода (generated), просрочка, неизвестный код", async () => {
    const { rewards, view } = await prepare();
    expect(await rewards.redeem(` ${view.code} `, at(2, 13))).toMatchObject({ status: "redeemed" });
    const late = await prepare();
    expect(await late.rewards.redeem(late.view.code!, at(5, 13))).toMatchObject({ status: "expired" });
    expect(await late.rewards.redeem("NOPE-0000", at(2, 13))).toEqual({ status: "not_found" });
    expect(await late.rewards.redeem("   ", at(2, 13))).toEqual({ status: "not_found" });
  });

  it("подделка QR: чужая подпись, изменённый id, обрезанный payload, другой секрет", async () => {
    const { rewards, view, repository, advent } = await prepare();
    const [prefix, id, mac] = view.qr!.payload.split(".");
    const tampered = [`${prefix}.${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`, `${prefix}.${id.replace(/.$/, id.endsWith("0") ? "1" : "0")}.${mac}`, `${prefix}.${id}`, `${prefix}.${id}.`];
    for (const payload of tampered) expect((await rewards.redeem(payload, at(2, 13))).status, payload).toMatch(/invalid|not_found/);
    const otherSecret = new RewardService(repository, advent, { qrSecret: "another-secret-another-secret-another-0000" });
    expect(await otherSecret.redeem(view.qr!.payload, at(2, 13))).toEqual({ status: "invalid" });
    expect((await repository.getGrant(id))!.status).toBe("issued");
  });

  it("чужой арендатор (другая кампания) не гасит награду; награда не для кассы; общий код — только по QR", async () => {
    const { view, repository, advent } = await prepare();
    const foreignAdvent = adventSchema.parse({ ...adventFixture(), slug: "other-advent-2026" });
    const foreign = new RewardService(repository, foreignAdvent, { qrSecret: "another-secret-another-secret-another-0000" });
    expect((await foreign.redeem(view.code!, at(2, 13))).status).toBe("not_found");
    const sameSecret = new RewardService(repository, foreignAdvent, { qrSecret: "test-reward-qr-secret-0123456789abcdef0123456789" });
    expect((await sameSecret.redeem(view.qr!.payload, at(2, 13))).status).toMatch(/invalid|not_found/);

    const online = await prepare((draft) => { draft.rewards.find((reward: any) => reward.id === "daily-gift").redeem = "online"; });
    expect(online.view.qr).toBeNull();
    expect(await online.rewards.redeem(online.view.code!, at(2, 13))).toMatchObject({ status: "not_redeemable" });

    const shared = await prepare((draft) => { draft.rewards.find((reward: any) => reward.id === "daily-gift").codes = { static: "SAME" }; });
    expect(await shared.rewards.redeem("same", at(2, 13))).toMatchObject({ status: "needs_qr" });
    expect(await shared.rewards.redeem(shared.view.qr!.payload, at(2, 13))).toMatchObject({ status: "redeemed" });
    expect(advent.slug).not.toBe(foreignAdvent.slug);
  });

  it("параллельное погашение: ровно одно успешное", async () => {
    const { rewards, view } = await prepare();
    const results = await Promise.all(Array.from({ length: 5 }, () => rewards.redeem(view.qr!.payload, at(2, 14))));
    expect(results.filter((result) => result.status === "redeemed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "already_redeemed")).toHaveLength(4);
  });

  it("секрета нет — QR не выдаётся (production без REWARD_QR_SECRET), а проверка запуска падает", async () => {
    const original = process.env.NODE_ENV;
    const advent = adventConfig();
    const { repository } = newAdventService(advent);
    const service = new RewardService(repository, advent, {});
    expect(service.qr({ id: "7f3b1d3e-1111-4222-8333-444455556666", participantId: "x", day: 1, source: "day", rewardId: "daily-gift", code: "A", expiresAt: null, status: "issued", redeemedAt: null, createdAt: new Date() })).not.toBeNull(); // вне production — запасной ключ разработки
    expect(original).not.toBe("production");
    const production = { APP_URL: "https://quiz.example.com", NODE_ENV: "production" as const, QUIZ_LOCAL_STACK: false };
    expect(() => assertRewardSecrets(production, advent.rewards, "zerno")).toThrow(/REWARD_QR_SECRET/);
    expect(() => assertRewardSecrets({ ...production, REWARD_QR_SECRET: "x".repeat(32) }, advent.rewards)).not.toThrow();
    expect(() => assertRewardSecrets(production, [{ redeem: "online" }, { redeem: "none" }])).not.toThrow();
    expect(() => assertRewardSecrets({ ...production, NODE_ENV: "development" }, advent.rewards)).not.toThrow();
  });

  it("секрет для сервиса: на закрытом стенде и в локальном контуре — ключ разработки, в боевом production — только REWARD_QR_SECRET", () => {
    const production = { APP_URL: "https://quiz.example.com", NODE_ENV: "production" as const, QUIZ_LOCAL_STACK: false };
    expect(resolveRewardSecret(production)).toBeUndefined();
    expect(resolveRewardSecret({ ...production, REWARD_QR_SECRET: "s".repeat(32) })).toBe("s".repeat(32));
    expect(resolveRewardSecret({ ...production, STAGING_USERNAME: "demo", STAGING_PASSWORD: "demo-password" })).toBe(DEV_QR_SECRET);
    expect(resolveRewardSecret({ APP_URL: "http://localhost:3000", NODE_ENV: "production", QUIZ_LOCAL_STACK: true })).toBe(DEV_QR_SECRET);
  });
});

describe("импорт кодов и выгрузка", () => {
  const listAdvent = () => adventConfig((draft) => { draft.rewards.find((reward: any) => reward.id === "daily-gift").codes = { list: "codes/daily.csv" }; });

  it("отчёт: добавлено, дубли в файле, уже в пуле, ошибочные; регистр и кавычки; лишние столбцы", async () => {
    const ctx = newAdventService(listAdvent());
    const csv = '﻿Name;Code\r\n"a";abc-001\r\nb;ABC-001\r\nc;"x y"\r\nd;=cmd|calc\r\ne;xyz-777\r\n';
    const first = await ctx.rewards.importCodes("daily-gift", csv);
    expect(first).toEqual({ rows: 5, added: 2, duplicatesInFile: 1, alreadyInPool: 0, invalid: 2 });
    const second = await ctx.rewards.importCodes("daily-gift", "code\nxyz-777\nnew-1\n");
    expect(second).toMatchObject({ added: 1, alreadyInPool: 1 });
    expect((await ctx.repository.poolOverview(ctx.advent.slug))["daily-gift"]).toEqual({ total: 3, free: 3 });
  });

  it("без заголовка code, чужая и безсписочная награда, слишком большой файл — ошибки", async () => {
    const ctx = newAdventService(listAdvent());
    await expect(ctx.rewards.importCodes("daily-gift", "AAA\nBBB")).rejects.toMatchObject({ code: "invalid" });
    await expect(ctx.rewards.importCodes("ghost", "code\nAAA")).rejects.toMatchObject({ code: "not_found" });
    await expect(ctx.rewards.importCodes("luck-a", "code\nAAA")).rejects.toMatchObject({ code: "invalid" });
    await expect(ctx.rewards.importCodes("daily-gift", `code\n${"A".repeat(2_100_000)}`)).rejects.toMatchObject({ code: "invalid" });
  });

  it("overview: выдано, погашено, остатки и пулы", async () => {
    const ctx = newAdventService(listAdvent());
    await ctx.rewards.importCodes("daily-gift", "code\nOV-1\nOV-2\n");
    const rows = await ctx.rewards.overview();
    expect(rows.find((row) => row.rewardId === "daily-gift")).toMatchObject({ codesTotal: 2, codesFree: 2, issued: 0, stockLeft: null });
    expect(rows.find((row) => row.rewardId === "luck-b")).toMatchObject({ stockLeft: 30, stockTotal: 30, codesTotal: null });
  });

  it("grants.csv: без email и кодов, ячейки в кавычках, формулы нейтрализованы", () => {
    const csv = grantsToCsv([
      { id: "g1", rewardId: "r", rewardLabel: "=HYPERLINK(\"x\")", day: 3, source: "day", status: "issued", createdAt: new Date("2026-12-22T09:00:00Z"), redeemedAt: null, expiresAt: new Date("2026-12-24T09:00:00Z") },
      { id: "g2", rewardId: "r", rewardLabel: "+1 @a", day: 0, source: "endowed", status: "redeemed", createdAt: new Date("2026-12-20T09:00:00Z"), redeemedAt: new Date("2026-12-21T09:00:00Z"), expiresAt: null }
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"'+1 @a\"");
    expect(csv.split("\r\n")[0]).not.toMatch(/email|код/i);
  });
});

describe("схема и роли", () => {
  it("промо-блок и награда дня должны совпадать", () => {
    const draft = adventFixture();
    draft.days[0].rewardId = "goal-gift";
    expect(() => adventSchema.parse(draft)).toThrow(/один подарок/);
  });

  it("роли: кассир входит, но без прав оператора; логины без роли — операторы; процессный админ — оператор", async () => {
    const passwordHash = await hashPassword("cashier-password-for-test-1");
    const deps = (role?: "operator" | "cashier") => ({
      tenantSlug: "alpha",
      env: { ADMIN_USERNAME: "root", ADMIN_PASSWORD: "process-admin-password-16", TENANT: "alpha" },
      findAdmin: async () => ({ passwordHash, disabledAt: null, ...(role ? { role } : {}) })
    });
    const auth = `Basic ${Buffer.from("kassa:cashier-password-for-test-1").toString("base64")}`;
    expect(await authenticateAdminRole(auth, deps("cashier"))).toEqual({ identity: "tenant", role: "cashier" });
    expect(await authenticateAdminRole(auth, deps())).toEqual({ identity: "tenant", role: "operator" });
    const root = `Basic ${Buffer.from("root:process-admin-password-16").toString("base64")}`;
    expect(await authenticateAdminRole(root, deps("cashier"))).toEqual({ identity: "process", role: "operator" });
    expect(isRedeemPagePath("/Redeem")).toBe(true);
    expect(isRedeemPagePath("/redeem/x")).toBe(false);
    expect(isAdminPagePath("/redeem")).toBe(false);
  });

  it("seededRng детерминирован", () => {
    expect(seededRng(3)()).toBe(seededRng(3)());
  });
});
