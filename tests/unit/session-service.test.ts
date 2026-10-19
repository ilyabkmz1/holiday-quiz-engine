import { beforeEach, describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { InMemorySessionRepository } from "@/server/repositories/in-memory-session-repository";
import { RushService } from "@/server/services/rush-service";
import { SessionService } from "@/server/services/session-service";

import { FakeClock } from "../support/clock";
import { correctPayload, partialPayload, wrongPayload } from "../support/solve";

const START = new Date("2026-12-24T12:00:00Z");

let clock: FakeClock;
let repository: InMemorySessionRepository;
let service: SessionService;
let rush: RushService;
let sessionId: string;

beforeEach(async () => {
  clock = new FakeClock(START);
  repository = new InMemorySessionRepository();
  service = new SessionService(repository, campaign, clock.now);
  // Порядок заявок рывка в тестах — как в конфигурации.
  rush = new RushService(repository, service, campaign, clock.now, () => 0.999999);
  sessionId = (await service.create()).session.id;
});

const room = (id: string) => campaign.rooms.find((candidate) => candidate.id === id)!;

/** Проходит комнату верными ответами: задание запрашивается, на него уходит `secondsPerTask` секунд. */
async function playRoom(roomId: string, secondsPerTask = 10) {
  await service.enterRoom(sessionId, roomId);
  let last;
  for (const task of room(roomId).tasks) {
    await service.roomTask(sessionId, roomId);
    clock.advance(secondsPerTask * 1000);
    last = await service.answerTask(sessionId, task.id, correctPayload(task));
  }
  return last!;
}

async function playAllRooms() {
  for (const item of campaign.rooms) await playRoom(item.id);
}

describe("SessionService: rooms", () => {
  it("starts with nothing entered, no answers and a locked rush", async () => {
    const progress = await service.progress(sessionId);

    expect(progress).toMatchObject({ status: "playing", score: 0, combo: 0, roomsCompleted: 0, rushUnlocked: false, rush: null, answers: [], final: null });
    expect(progress.rooms).toHaveLength(5);
    expect(progress.rooms.every((item) => !item.entered && item.currentTaskId === null)).toBe(true);
  });

  it("records the entry time once and keeps it on re-entry", async () => {
    const first = await service.enterRoom(sessionId, "mail");
    clock.advance(20_000);
    const again = await service.enterRoom(sessionId, "mail");

    expect(first.room.enteredAt).toBe(START.toISOString());
    expect(again.room.enteredAt).toBe(START.toISOString());
    expect(again.room.currentTaskId).toBe("mail-letters");
  });

  it("rejects unknown rooms and unknown sessions", async () => {
    await expect(service.enterRoom(sessionId, "attic")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.enterRoom("5b2d1c10-0000-4000-8000-000000000000", "mail")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.enterRoom("not-a-uuid", "mail")).rejects.toMatchObject({ code: "not_found" });
  });

  it("serves the current task only after entering and without correctness hints", async () => {
    await expect(service.roomTask(sessionId, "mail")).rejects.toMatchObject({ code: "conflict" });
    await service.enterRoom(sessionId, "mail");

    const first = await service.roomTask(sessionId, "mail");
    expect(first.task).toMatchObject({ id: "mail-letters", type: "phish", roomId: "mail" });
    expect(first.taskNumber).toBe(1);
    expect(JSON.stringify(first)).not.toMatch(/fakeLetterId|correct|thanks|oops|explanation|"tip"/);

    clock.advance(1000);
    await service.answerTask(sessionId, "mail-letters", correctPayload(room("mail").tasks[0]));
    expect((await service.roomTask(sessionId, "mail")).task?.id).toBe("mail-invite");
  });

  it("answers rooms in any order, tasks within a room in sequence", async () => {
    await playRoom("files");
    await playRoom("mail");

    const progress = await service.progress(sessionId);
    expect(progress.roomsCompleted).toBe(2);
    expect(progress.rooms.find((item) => item.roomId === "files")?.completed).toBe(true);
    expect(progress.rooms.find((item) => item.roomId === "calendar")?.entered).toBe(false);
  });

  it("refuses answers before entering the room or out of sequence", async () => {
    const [first, second] = room("mail").tasks;
    await expect(service.answerTask(sessionId, first.id, correctPayload(first))).rejects.toMatchObject({ code: "conflict" });

    await service.enterRoom(sessionId, "mail");
    await expect(service.answerTask(sessionId, second.id, correctPayload(second))).rejects.toMatchObject({ code: "conflict" });
    expect((await service.progress(sessionId)).answers).toEqual([]);
  });

  it("returns 404 for an unknown task and 400 for a malformed payload without consuming the task", async () => {
    await service.enterRoom(sessionId, "mail");
    await expect(service.answerTask(sessionId, "ghost", {})).rejects.toMatchObject({ code: "not_found" });
    await expect(service.answerTask(sessionId, "mail-letters", { optionId: "ghost" })).rejects.toMatchObject({ code: "invalid" });
    await expect(service.answerTask(sessionId, "mail-letters", { optionIds: ["m2"] })).rejects.toMatchObject({ code: "invalid" });

    const retry = await service.answerTask(sessionId, "mail-letters", { optionId: "m2" });
    expect(retry.reveal.base).toBe(100);
  });

  it("is idempotent: a repeated answer returns the first result even with a different body", async () => {
    await service.enterRoom(sessionId, "mail");
    const task = room("mail").tasks[0];
    const first = await service.answerTask(sessionId, task.id, correctPayload(task));
    clock.advance(30_000);
    const retry = await service.answerTask(sessionId, task.id, wrongPayload(task));

    expect(retry).toEqual(first);
    expect((await service.progress(sessionId)).answers).toHaveLength(1);
  });

  it("answers concurrent submissions for one task with a single stored result", async () => {
    await service.enterRoom(sessionId, "mail");
    const task = room("mail").tasks[0];
    const results = await Promise.all(
      [correctPayload(task), wrongPayload(task), correctPayload(task)].map((payload) => service.answerTask(sessionId, task.id, payload))
    );

    expect(new Set(results.map((item) => item.reveal.base)).size).toBe(1);
    expect(await repository.listTaskAnswers(sessionId)).toHaveLength(1);
  });
});

describe("SessionService: points", () => {
  it("builds the combo across tasks and gives the room bonuses on the third answer", async () => {
    await service.enterRoom(sessionId, "mail");
    const answers = [];
    for (const task of room("mail").tasks) {
      await service.roomTask(sessionId, "mail");
      clock.advance(10_000);
      answers.push(await service.answerTask(sessionId, task.id, correctPayload(task)));
    }

    expect(answers.map((item) => [item.reveal.base, item.reveal.comboBonus, item.reveal.combo])).toEqual([
      [100, 0, 1],
      [100, 25, 2],
      [100, 50, 3]
    ]);
    expect(answers[0].roomResult).toBeNull();
    // 300 база + 75 комбо + 50 «без сбоев» + (75 − 30) × 2 за скорость.
    expect(answers[2].roomResult).toMatchObject({ base: 300, comboBonus: 75, noFailBonus: 50, speedBonus: 90, elapsedSeconds: 30, total: 515 });
    expect(answers[2].score).toBe(515);
    expect(answers[2].nextTaskId).toBeNull();
  });

  it("carries the combo from one room into the next and caps the bonus at 75", async () => {
    await playRoom("mail");
    await playRoom("calendar");
    const progress = await service.progress(sessionId);

    expect(progress.answers.map((item) => item.comboBonus)).toEqual([0, 25, 50, 75, 75, 75]);
    expect(progress.combo).toBe(6);
  });

  it("breaks the combo on a 50 or a 0, takes a fuse only for the 0, and gives no no-failure bonus", async () => {
    await service.enterRoom(sessionId, "mail");
    const [phish, invite, team] = room("mail").tasks;
    await service.roomTask(sessionId, "mail");
    clock.advance(5_000);
    const miss = await service.answerTask(sessionId, phish.id, wrongPayload(phish));
    await service.roomTask(sessionId, "mail");
    clock.advance(5_000);
    const ok = await service.answerTask(sessionId, invite.id, correctPayload(invite));
    await service.roomTask(sessionId, "mail");
    clock.advance(5_000);
    const partial = await service.answerTask(sessionId, team.id, partialPayload(team)!);

    expect([miss, ok, partial].map((item) => item.reveal.outcome)).toEqual(["miss", "perfect", "partial"]);
    expect([miss, ok, partial].map((item) => item.reveal.combo)).toEqual([0, 1, 0]);
    expect([miss, ok, partial].map((item) => item.reveal.fuses)).toEqual([2, 2, 2]);
    expect(partial.roomResult).toMatchObject({ base: 150, comboBonus: 0, noFailBonus: 0, fuses: 2, elapsedSeconds: 15, speedBonus: 60, total: 210 });
    // Скорость: (75 − 15) × 2 = 120, умноженное на долю базы 150 / 300.
  });

  it("gives no speed bonus past 75 seconds", async () => {
    const last = await playRoom("mail", 30);
    expect(last.roomResult).toMatchObject({ elapsedSeconds: 90, speedBonus: 0 });
  });

  it("starts the task clock at the first issue of the task, not at the room entry", async () => {
    await service.enterRoom(sessionId, "mail");
    clock.advance(40_000);
    let last;
    for (const task of room("mail").tasks) {
      await service.roomTask(sessionId, "mail");
      clock.advance(5_000);
      last = await service.answerTask(sessionId, task.id, correctPayload(task));
    }
    expect(last!.roomResult).toMatchObject({ elapsedSeconds: 15, speedBonus: 120 });
  });

  it("does not count the time spent reading the reveal", async () => {
    await service.enterRoom(sessionId, "mail");
    let last;
    for (const task of room("mail").tasks) {
      await service.roomTask(sessionId, "mail");
      clock.advance(10_000);
      last = await service.answerTask(sessionId, task.id, correctPayload(task));
      clock.advance(300_000); // игрок читает разбор
    }
    expect(last!.roomResult).toMatchObject({ elapsedSeconds: 30, speedBonus: 90 });
  });

  it("keeps the first issue time when the task is requested again", async () => {
    await service.enterRoom(sessionId, "mail");
    const [first] = room("mail").tasks;
    const before = (await service.roomTask(sessionId, "mail")).room.taskShownAt;
    clock.advance(20_000);
    const again = await service.roomTask(sessionId, "mail"); // восстановление / обновление страницы
    expect(again.room.taskShownAt).toBe(before);
    expect(before).toBe(START.toISOString());

    clock.advance(5_000);
    const answered = await service.answerTask(sessionId, first.id, correctPayload(first));
    expect(answered.room.spentMs).toBe(25_000);
  });

  it("ignores a task-shown mark that landed after the answer (request/answer race)", async () => {
    await service.enterRoom(sessionId, "mail");
    const [first] = room("mail").tasks;
    clock.advance(10_000);
    await service.answerTask(sessionId, first.id, correctPayload(first));
    // Запоздавший запрос задания записывает отметку уже после ответа.
    clock.advance(5_000);
    await repository.markTaskShownOnce(sessionId, first.id, clock.now());

    const progress = await service.progress(sessionId);
    // Время ответа считается от входа в комнату (10 с), а не обнуляется.
    expect(progress.rooms.find((item) => item.roomId === "mail")!.spentMs).toBe(10_000);
  });

  it("returns an already answered task for the reveal without writing a shown mark, and refuses the unanswered one", async () => {
    await service.enterRoom(sessionId, "mail");
    const [first, second] = room("mail").tasks;
    await service.roomTask(sessionId, "mail");
    await service.answerTask(sessionId, first.id, correctPayload(first));

    const again = await service.roomTask(sessionId, "mail", first.id);
    expect(again.task?.id).toBe(first.id);
    expect(again.taskNumber).toBe(1);
    expect(again.room.currentTaskId).toBe(second.id);
    expect(again.room.taskShownAt).toBeNull();
    await expect(service.roomTask(sessionId, "mail", second.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.roomTask(sessionId, "mail", "ghost")).rejects.toMatchObject({ code: "not_found" });
  });

  it("pays the speed bonus in proportion to the room base", async () => {
    await service.enterRoom(sessionId, "mail");
    const [phish, invite, team] = room("mail").tasks;
    const plays = [
      [phish, wrongPayload(phish)],
      [invite, wrongPayload(invite)],
      [team, wrongPayload(team)]
    ] as const;
    let last;
    for (const [task, payload] of plays) {
      await service.roomTask(sessionId, "mail");
      clock.advance(1_000);
      last = await service.answerTask(sessionId, task.id, payload);
    }
    // Три нуля за 3 секунды: база 0, значит и скорость 0, хотя время рекордное.
    expect(last!.roomResult).toMatchObject({ base: 0, elapsedSeconds: 3, speedBonus: 0, total: 0 });
  });

  it("falls back to the previous answer or the entry when the task was never requested", async () => {
    await service.enterRoom(sessionId, "mail");
    let last;
    for (const task of room("mail").tasks) {
      clock.advance(10_000);
      last = await service.answerTask(sessionId, task.id, correctPayload(task));
    }
    expect(last!.roomResult?.elapsedSeconds).toBe(30);
  });

  it("restores answers with their reveal only for tasks already answered", async () => {
    await service.enterRoom(sessionId, "mail");
    const [first] = room("mail").tasks;
    await service.answerTask(sessionId, first.id, correctPayload(first));

    const progress = await service.progress(sessionId);
    expect(progress.answers.map((item) => item.taskId)).toEqual(["mail-letters"]);
    expect(progress.answers[0]).toMatchObject({ correctIds: ["m2"], outcome: "perfect" });
    expect(JSON.stringify(progress)).not.toContain(room("mail").tasks[1].explanation);
  });
});

describe("RushService", () => {
  it("opens only after all five rooms and starts idempotently", async () => {
    await expect(rush.start(sessionId)).rejects.toMatchObject({ code: "conflict" });
    for (const item of campaign.rooms.slice(0, 4)) await playRoom(item.id);
    await expect(rush.start(sessionId)).rejects.toMatchObject({ code: "conflict" });

    await playRoom("projects");
    const startedAt = clock.now();
    const started = await rush.start(sessionId);
    clock.advance(5_000);
    const again = await rush.start(sessionId);

    expect(started.rush).toMatchObject({ status: "running", startedAt: startedAt.toISOString(), total: campaign.rush.pool.length, answered: 0 });
    expect(again.rush.startedAt).toBe(started.rush.startedAt);
    expect(again.rush.deadlineAt).toBe(started.rush.deadlineAt);
    expect(new Date(started.rush.deadlineAt).getTime() - new Date(started.rush.startedAt).getTime()).toBe(30_000);
  });

  async function startRush() {
    await playAllRooms();
    return (await rush.start(sessionId)).rush;
  }

  const serviceOf = (itemId: string) => campaign.rush.pool.find((item) => item.id === itemId)!.serviceId;
  const wrongService = (itemId: string) => campaign.rush.services.find((service) => service.id !== serviceOf(itemId))!.id;

  it("gives 20 points for a right answer and moves on to the next request", async () => {
    const state = await startRush();
    const before = (await service.progress(sessionId)).score;
    const itemId = state.current!.itemId;

    const result = await rush.answer(sessionId, itemId, serviceOf(itemId));

    expect(result).toMatchObject({ correct: true, scoreDelta: 20, score: before + 20 });
    expect(result.rush.current?.itemId).not.toBe(itemId);
    expect(result.rush).toMatchObject({ hits: 1, misses: 0, answered: 1 });
  });

  it("takes 2 seconds off the deadline for a mistake and closes that request", async () => {
    const state = await startRush();
    const itemId = state.current!.itemId;

    const result = await rush.answer(sessionId, itemId, wrongService(itemId));

    expect(result).toMatchObject({ correct: false, scoreDelta: 0 });
    expect(new Date(result.rush.deadlineAt).getTime()).toBe(new Date(state.deadlineAt).getTime() - 2_000);
    expect(result.rush).toMatchObject({ hits: 0, misses: 1 });
    expect(result.rush.current?.itemId).not.toBe(itemId);
  });

  it("is idempotent per request: a repeat returns the stored result and changes nothing", async () => {
    const state = await startRush();
    const itemId = state.current!.itemId;
    const first = await rush.answer(sessionId, itemId, wrongService(itemId));
    const retry = await rush.answer(sessionId, itemId, serviceOf(itemId));

    expect(retry.correct).toBe(false);
    expect(retry.rush.deadlineAt).toBe(first.rush.deadlineAt);
    expect(retry.score).toBe(first.score);
  });

  it("answers only the currently issued request", async () => {
    const state = await startRush();
    const other = campaign.rush.pool.find((item) => item.id !== state.current!.itemId)!;
    await expect(rush.answer(sessionId, other.id, other.serviceId)).rejects.toMatchObject({ code: "conflict" });
    await expect(rush.answer(sessionId, "ghost", "mail")).rejects.toMatchObject({ code: "not_found" });
    await expect(rush.answer(sessionId, state.current!.itemId, "ghost")).rejects.toMatchObject({ code: "invalid" });
  });

  it("accepts a late answer within the 2 second allowance and refuses later ones", async () => {
    const state = await startRush();
    const startedAt = new Date(state.startedAt).getTime();
    clock.set(new Date(startedAt + 31_500));
    const itemId = state.current!.itemId;
    await expect(rush.answer(sessionId, itemId, serviceOf(itemId))).resolves.toMatchObject({ correct: true });

    clock.set(new Date(startedAt + 32_001));
    const next = (await service.progress(sessionId)).rush!;
    expect(next.status).toBe("finished");
    await expect(rush.answer(sessionId, "rush-backup", "mail")).rejects.toMatchObject({ code: "expired" });
  });

  it("applies the penalty to the allowance too", async () => {
    const state = await startRush();
    const startedAt = new Date(state.startedAt).getTime();
    const itemId = state.current!.itemId;
    const missed = await rush.answer(sessionId, itemId, wrongService(itemId));

    // Дедлайн теперь +28 с, допуск до +30 с.
    clock.set(new Date(startedAt + 30_100));
    await expect(rush.answer(sessionId, missed.rush.current!.itemId, "mail")).rejects.toMatchObject({ code: "expired" });
  });

  it("refuses answers after an explicit finish and finishes idempotently", async () => {
    const state = await startRush();
    clock.advance(10_000);
    const finishedAtMs = clock.now().getTime();
    const finished = await rush.finish(sessionId);
    clock.advance(5_000);
    const again = await rush.finish(sessionId);

    expect(finished.rush.status).toBe("finished");
    expect(again.rush).toMatchObject({ status: "finished", hits: 0 });
    await expect(rush.answer(sessionId, state.current!.itemId, "mail")).rejects.toMatchObject({ code: "expired" });
    expect((await repository.getRushRun(sessionId))!.finishedAt).toEqual(new Date(finishedAtMs));
  });

  it("refuses to finish a rush that was never started", async () => {
    await expect(rush.finish(sessionId)).rejects.toMatchObject({ code: "conflict" });
    await expect(rush.answer(sessionId, "rush-sender", "mail")).rejects.toMatchObject({ code: "conflict" });
  });

  it("ends when the pool runs out", async () => {
    let state = await startRush();
    while (state.current) {
      const result = await rush.answer(sessionId, state.current.itemId, serviceOf(state.current.itemId));
      state = result.rush;
    }
    expect(state).toMatchObject({ status: "finished", hits: campaign.rush.pool.length });
  });

  it("issues the pool in the order given by the injected randomness", async () => {
    const reversed = new RushService(repository, service, campaign, clock.now, () => 0);
    await playAllRooms();
    const state = (await reversed.start(sessionId)).rush;
    expect(state.current?.itemId).not.toBe(campaign.rush.pool[0].id);
  });
});

describe("SessionService.complete", () => {
  it("refuses to finish before every room and the rush are done", async () => {
    await expect(service.complete(sessionId)).rejects.toMatchObject({ code: "conflict" });
    await playAllRooms();
    await expect(service.complete(sessionId)).rejects.toMatchObject({ code: "conflict" });
    await rush.start(sessionId);
    await expect(service.complete(sessionId)).rejects.toMatchObject({ code: "conflict" });
  });

  it("finishes once, closes an expired rush and keeps the original result on retry", async () => {
    await playAllRooms();
    const state = (await rush.start(sessionId)).rush;
    const itemId = state.current!.itemId;
    await rush.answer(sessionId, itemId, campaign.rush.pool.find((item) => item.id === itemId)!.serviceId);
    clock.advance(40_000);

    const completed = await service.complete(sessionId);
    clock.advance(60_000);
    const retry = await service.complete(sessionId);

    expect(retry).toEqual(completed);
    expect(completed.final).toMatchObject({ rushHits: 1, rushPoints: 20 });
    expect(completed.score).toBe(completed.final.rooms.reduce((sum, item) => sum + item.total, 0) + 20);
    expect((await service.progress(sessionId)).final?.score).toBe(completed.score);
  });

  it("resolves the level from the final score and hands out an ornament per room", async () => {
    await playAllRooms();
    await rush.start(sessionId);
    await rush.finish(sessionId);

    const result = await service.complete(sessionId);

    // 15 × 100 + 975 комбо + 5 × 50 «без сбоев» + 5 × 90 скорость = 3175, рывок без очков.
    expect(result.score).toBe(3175);
    expect(result.rewardTierTitle).toBe("Душа «Северного офиса»");
    expect(result.final.level.minScore).toBe(3000);
    expect(result.final.ornaments.map((item) => item.roomId)).toEqual(["mail", "calendar", "messenger", "files", "projects"]);
  });

  it("stops accepting new answers after completion but replays recorded ones", async () => {
    await playAllRooms();
    await rush.start(sessionId);
    await rush.finish(sessionId);
    await service.complete(sessionId);

    const task = room("mail").tasks[0];
    const replay = await service.answerTask(sessionId, task.id, wrongPayload(task));
    expect(replay.reveal.base).toBe(100);
    await expect(rush.start(sessionId)).resolves.toMatchObject({ rush: { status: "finished" } });
  });
});
