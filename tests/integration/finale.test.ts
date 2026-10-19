import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { RUSH } from "@/domain/rush";
import { getPrisma } from "@/server/db";

import { correctPayload, wrongPayload } from "../support/solve";
import {
  PERFECT_FIXED_CLOCK_SCORE,
  api,
  claimInput,
  clock,
  completedPlayer,
  installFakes,
  json,
  playAllRooms,
  playRoom,
  serviceFor,
  startRush,
  startSession,
  wrongServiceFor,
  type Player
} from "./helpers/app";

const POOL = campaign.rush.pool;

async function playerReadyForRush(): Promise<Player> {
  const player = await startSession();
  await playAllRooms(player);
  return player;
}

describe("rush start", () => {
  it("opens only after all five rooms", async () => {
    installFakes();
    const player = await startSession();
    for (const room of campaign.rooms.slice(0, 4)) await playRoom(player, room.id);

    const early = await api.rushStart(player.sessionId, player.accessKey);
    expect(early.status).toBe(409);
    expect(await getPrisma().rushRun.count()).toBe(0);

    await playRoom(player, "projects");
    expect((await api.rushStart(player.sessionId, player.accessKey)).status).toBe(200);
  });

  it("is idempotent and concurrent starts create one run with one pool order", async () => {
    installFakes();
    const player = await playerReadyForRush();

    const responses = await Promise.all(Array.from({ length: 5 }, () => api.rushStart(player.sessionId, player.accessKey)));
    clock.advance(10_000);
    const again = await json(await api.rushStart(player.sessionId, player.accessKey));
    const bodies = await Promise.all(responses.map(json));

    expect(responses.map((response) => response.status)).toEqual(Array(5).fill(200));
    expect(new Set(bodies.map((body) => body.rush.current.itemId)).size).toBe(1);
    expect(again.rush.startedAt).toBe(bodies[0].rush.startedAt);
    expect(again.rush.deadlineAt).toBe(bodies[0].rush.deadlineAt);
    expect(await getPrisma().rushRun.count()).toBe(1);
  });

  it("shuffles the whole pool server-side and exposes only the current request", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const response = await api.rushStart(player.sessionId, player.accessKey);
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.rush).toMatchObject({ status: "running", total: POOL.length, answered: 0, hits: 0, secondsLeft: 30 });
    expect(new Date(body.rush.deadlineAt).getTime() - new Date(body.rush.startedAt).getTime()).toBe(30_000);
    expect(text).not.toMatch(/serviceId|poolOrder/);
    for (const item of POOL.filter((candidate) => candidate.id !== body.rush.current.itemId)) {
      expect(text).not.toContain(item.prompt);
    }

    const run = await getPrisma().rushRun.findUniqueOrThrow({ where: { sessionId: player.sessionId } });
    expect([...(run.poolOrder as string[])].sort()).toEqual(POOL.map((item) => item.id).sort());
    expect((run.poolOrder as string[])[0]).toBe(body.rush.current.itemId);
  });

  it("issues the pool in the order of the injected randomness", async () => {
    installFakes(undefined, () => 0.999999);
    const player = await playerReadyForRush();
    const body = await json(await api.rushStart(player.sessionId, player.accessKey));

    expect(body.rush.current.itemId).toBe(POOL[0].id);
  });
});

describe("rush answers", () => {
  it("gives 20 points for a right answer and serves the next request", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const before = (await json(await api.getSession(player.sessionId, player.accessKey))).session.score;

    const response = await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, serviceFor(rush.current.itemId));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ correct: true, scoreDelta: 20, score: before + 20 });
    expect(body.rush).toMatchObject({ hits: 1, answered: 1, points: 20 });
    expect(body.rush.current.itemId).not.toBe(rush.current.itemId);
  });

  it("takes 2 seconds off the server deadline for a mistake and records it once", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const itemId = rush.current.itemId;

    const miss = await json(await api.rushAnswer(player.sessionId, player.accessKey, itemId, wrongServiceFor(itemId)));
    const retry = await json(await api.rushAnswer(player.sessionId, player.accessKey, itemId, serviceFor(itemId)));

    expect(miss).toMatchObject({ correct: false, scoreDelta: 0 });
    expect(new Date(miss.rush.deadlineAt).getTime()).toBe(new Date(rush.deadlineAt).getTime() - RUSH.penaltyMs);
    expect(miss.rush.secondsLeft).toBe(28);
    expect(retry.correct).toBe(false);
    expect(retry.rush.deadlineAt).toBe(miss.rush.deadlineAt);
    expect(await getPrisma().rushAnswer.count({ where: { sessionId: player.sessionId } })).toBe(1);
  });

  it("loses no penalty and no point when answers arrive concurrently", async () => {
    installFakes();
    for (let round = 0; round < 5; round += 1) {
      const player = await playerReadyForRush();
      const rush = await startRush(player);
      const run = await getPrisma().rushRun.findUniqueOrThrow({ where: { sessionId: player.sessionId } });
      const order = run.poolOrder as string[];

      // Первые шесть заявок шлём одновременно: ответы идут в очередь, лишние получают 409 «не выдана».
      const responses = await Promise.all(
        order.slice(0, 6).map((itemId) => api.rushAnswer(player.sessionId, player.accessKey, itemId, wrongServiceFor(itemId)))
      );
      const accepted = responses.filter((response) => response.status === 200).length;
      const stored = await getPrisma().rushRun.findUniqueOrThrow({ where: { sessionId: player.sessionId } });

      expect(accepted).toBeGreaterThanOrEqual(1);
      expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
      expect(await getPrisma().rushAnswer.count({ where: { sessionId: player.sessionId } })).toBe(accepted);
      expect(stored.deadlineAt.getTime()).toBe(new Date(rush.deadlineAt).getTime() - accepted * RUSH.penaltyMs);
    }
  });

  it("answers only the currently issued request and validates ids", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const other = POOL.find((item) => item.id !== rush.current.itemId)!;

    expect((await api.rushAnswer(player.sessionId, player.accessKey, other.id, other.serviceId)).status).toBe(409);
    expect((await api.rushAnswer(player.sessionId, player.accessKey, "ghost", "mail")).status).toBe(404);
    expect((await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, "ghost")).status).toBe(400);
    expect((await api.rushAnswer(player.sessionId, player.accessKey, "", "")).status).toBe(400);
    expect(await getPrisma().rushAnswer.count()).toBe(0);
  });

  it("refuses answers without a started rush", async () => {
    installFakes();
    const player = await playerReadyForRush();

    expect((await api.rushAnswer(player.sessionId, player.accessKey, POOL[0].id, "mail")).status).toBe(409);
    expect((await api.rushFinish(player.sessionId, player.accessKey)).status).toBe(409);
  });

  it("accepts an answer within 2 seconds after the deadline and rejects later ones", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const startedAt = new Date(rush.startedAt).getTime();

    clock.set(new Date(startedAt + RUSH.durationMs + RUSH.graceMs));
    const late = await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, serviceFor(rush.current.itemId));
    const lateBody = await json(late);
    expect(late.status).toBe(200);
    expect(lateBody.correct).toBe(true);

    clock.set(new Date(startedAt + RUSH.durationMs + RUSH.graceMs + 1));
    const tooLate = await api.rushAnswer(player.sessionId, player.accessKey, lateBody.rush.current?.itemId ?? POOL[0].id, "mail");
    expect(tooLate.status).toBe(400);
    expect((await json(tooLate)).error).toBe("Время рывка вышло.");
    expect(await getPrisma().rushAnswer.count()).toBe(1);
  });

  it("shortens the allowance by the penalties: a late answer after mistakes is rejected", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const startedAt = new Date(rush.startedAt).getTime();
    const miss = await json(await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, wrongServiceFor(rush.current.itemId)));

    // Дедлайн теперь +28 с; допуск заканчивается на +30 с.
    clock.set(new Date(startedAt + 30_001));
    const response = await api.rushAnswer(player.sessionId, player.accessKey, miss.rush.current.itemId, "mail");

    expect(response.status).toBe(400);
  });

  it("refuses answers after the rush is finished and finishes idempotently", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    clock.advance(12_000);

    const first = await json(await api.rushFinish(player.sessionId, player.accessKey));
    clock.advance(3_000);
    const second = await json(await api.rushFinish(player.sessionId, player.accessKey));
    const late = await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, serviceFor(rush.current.itemId));

    expect(first.rush.status).toBe("finished");
    expect(second.rush).toMatchObject({ status: "finished", hits: 0 });
    expect(late.status).toBe(400);
    const run = await getPrisma().rushRun.findUniqueOrThrow({ where: { sessionId: player.sessionId } });
    expect(run.finishedAt?.getTime()).toBe(new Date(rush.startedAt).getTime() + 12_000);
  });

  it("restores a running rush from the session read", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    await api.rushAnswer(player.sessionId, player.accessKey, rush.current.itemId, serviceFor(rush.current.itemId));
    clock.advance(4_000);

    const { session } = await json(await api.getSession(player.sessionId, player.accessKey));

    expect(session.rush).toMatchObject({ status: "running", hits: 1, answered: 1, secondsLeft: 26 });
    expect(session.rush.current.index).toBe(1);
  });
});

describe("complete", () => {
  it("refuses before all rooms are done, before the rush starts, and while it is running", async () => {
    installFakes();
    const player = await startSession();
    await playRoom(player, "mail");
    expect((await api.complete(player.sessionId, player.accessKey)).status).toBe(409);

    await playAllRooms(player);
    const noRush = await api.complete(player.sessionId, player.accessKey);
    expect(noRush.status).toBe(409);

    await startRush(player);
    clock.advance(10_000);
    const running = await api.complete(player.sessionId, player.accessKey);
    expect(running.status).toBe(409);
    expect((await getPrisma().gameSession.findUniqueOrThrow({ where: { id: player.sessionId } })).status).toBe("playing");
  });

  it("completes with a server-side score, the level and an ornament per room, and is idempotent", async () => {
    installFakes();
    const player = await playerReadyForRush();
    await startRush(player);
    await api.rushFinish(player.sessionId, player.accessKey);

    const first = await json(await api.complete(player.sessionId, player.accessKey));
    clock.advance(60_000);
    const second = await json(await api.complete(player.sessionId, player.accessKey));

    expect(first.score).toBe(PERFECT_FIXED_CLOCK_SCORE);
    expect(first.rewardTierTitle).toBe("Душа «Северного офиса»");
    expect(second).toEqual(first);
    expect(first.final.ornaments.map((item: { roomId: string }) => item.roomId)).toEqual(campaign.rooms.map((room) => room.id));
    expect(first.final.rooms).toHaveLength(5);
    const stored = await getPrisma().gameSession.findUniqueOrThrow({ where: { id: player.sessionId } });
    expect(stored).toMatchObject({ status: "completed", score: PERFECT_FIXED_CLOCK_SCORE, rewardTierTitle: "Душа «Северного офиса»" });
  });

  it("closes an expired rush itself and counts the hits made before the deadline", async () => {
    installFakes();
    const player = await playerReadyForRush();
    const rush = await startRush(player);
    const itemId = rush.current.itemId;
    await api.rushAnswer(player.sessionId, player.accessKey, itemId, serviceFor(itemId));
    clock.advance(RUSH.durationMs + RUSH.graceMs + 5_000);

    const result = await json(await api.complete(player.sessionId, player.accessKey));

    expect(result.final).toMatchObject({ rushHits: 1, rushPoints: 20 });
    expect(result.score).toBe(PERFECT_FIXED_CLOCK_SCORE + 20);
    const run = await getPrisma().rushRun.findUniqueOrThrow({ where: { sessionId: player.sessionId } });
    expect(run.finishedAt?.getTime()).toBe(run.deadlineAt.getTime());
  });

  it("finalizes once under concurrent completion", async () => {
    installFakes();
    const player = await playerReadyForRush();
    await startRush(player);
    await api.rushFinish(player.sessionId, player.accessKey);

    const responses = await Promise.all(Array.from({ length: 5 }, () => api.complete(player.sessionId, player.accessKey)));
    const bodies = await Promise.all(responses.map(json));

    expect(responses.map((response) => response.status)).toEqual(Array(5).fill(200));
    expect(new Set(bodies.map((body) => body.score))).toEqual(new Set([PERFECT_FIXED_CLOCK_SCORE]));
  });

  it("scores wrong answers as zero and puts a slow, failing player at the lowest level", async () => {
    installFakes();
    const player = await startSession();
    await playAllRooms(player, { payloadFor: (item) => wrongPayload(item), secondsPerTask: 100 });
    await startRush(player);
    await api.rushFinish(player.sessionId, player.accessKey);

    const result = await json(await api.complete(player.sessionId, player.accessKey));

    expect(result.score).toBe(0);
    expect(result.rewardTierTitle).toBe("Гость ярмарки");
    expect(result.final.rooms.every((room: { fuses: number }) => room.fuses === 0)).toBe(true);
  });

  it("reaches the middle levels by points: a slow flawless run reaches the third level, a slow run with misses is lower", async () => {
    installFakes();
    const flawless = await startSession();
    await playAllRooms(flawless, { secondsPerTask: 40 });
    await startRush(flawless);
    await api.rushFinish(flawless.sessionId, flawless.accessKey);
    const perfect = await json(await api.complete(flawless.sessionId, flawless.accessKey));

    const sloppy = await startSession();
    await playAllRooms(sloppy, { payloadFor: (item, index) => (index === 1 ? wrongPayload(item) : correctPayload(item)), secondsPerTask: 40 });
    await startRush(sloppy);
    await api.rushFinish(sloppy.sessionId, sloppy.accessKey);
    const lower = await json(await api.complete(sloppy.sessionId, sloppy.accessKey));

    // 1500 + 975 + 250, скорость за 120 с на комнату нулевая.
    expect(perfect.score).toBe(2725);
    // 2725 лежит между порогами 2400 и 3000: Мастером медленно не стать.
    expect(perfect.rewardTierTitle).toBe("Хранитель порядка");
    expect(lower.score).toBeLessThan(perfect.score);
    expect(["Гость ярмарки", "Помощник координатора"]).toContain(lower.rewardTierTitle);
  });
});

describe("prize claim after the final", () => {
  it("refuses a claim until the session is completed and accepts it afterwards", async () => {
    const mailer = installFakes();
    const player = await playerReadyForRush();
    await startRush(player);
    await api.rushFinish(player.sessionId, player.accessKey);

    const before = await api.claim(player.sessionId, player.accessKey, claimInput());
    expect(before.status).toBe(409);

    await api.complete(player.sessionId, player.accessKey);
    const after = await api.claim(player.sessionId, player.accessKey, claimInput());

    expect(after.status).toBe(200);
    expect(await json(after)).toMatchObject({ status: "claim_pending", created: true });
    expect(mailer.sent).toHaveLength(1);
  });

  it("works for a player who completed the whole game through the API", async () => {
    const mailer = installFakes();
    const player = await completedPlayer();

    const response = await api.claim(player.sessionId, player.accessKey, claimInput());

    expect(response.status).toBe(200);
    expect((await api.verify(mailer.sent[0].token)).status).toBe(307);
    expect((await getPrisma().prizeClaim.findFirstOrThrow()).status).toBe("email_verified");
  });
});
