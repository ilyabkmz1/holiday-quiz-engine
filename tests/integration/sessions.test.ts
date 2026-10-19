import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { SESSION_COOKIE } from "@/server/api";
import { createId, hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";
import { resetRuntimeEnvCache } from "@/server/env";

import { correctPayload, wrongPayload } from "../support/solve";
import {
  allTasks,
  api,
  clock,
  completedPlayer,
  installFakes,
  json,
  playRoom,
  rooms,
  startSession
} from "./helpers/app";
import { OPEN_NOW, UPCOMING_NOW } from "./helpers/constants";

const FOREIGN_ORIGIN = "https://evil.example";
const CLAIM = { name: "Имя", email: "a@b.co", company: "Компания", consent: true };
const SECRET_FIELDS = /correctOptionId|correctOptionIds|correctEnabledIds|correctOrder|fakeLetterId|"thanks"|"oops"|"explanation"|"tip"/;

const task = (id: string) => allTasks.find((candidate) => candidate.id === id)!;

describe("POST /api/sessions", () => {
  it("creates a session, sets an httpOnly cookie and stores only the key hash", async () => {
    installFakes();
    const response = await api.createSession();
    const body = await json(response);
    const cookie = response.cookies.get(SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie?.value.length).toBeGreaterThanOrEqual(32);
    expect(new Date(cookie!.expires!).toISOString()).toBe(new Date(campaign.verificationEndsAt).toISOString());

    const stored = await getPrisma().gameSession.findUniqueOrThrow({ where: { id: body.sessionId } });
    expect(stored.accessKeyHash).toBe(hashToken(cookie!.value));
    expect(stored.accessKeyHash).not.toBe(cookie!.value);
    expect(stored.status).toBe("playing");
  });

  it("returns the public campaign and an empty progress, without task texts or correctness hints", async () => {
    installFakes();
    const response = await api.createSession();
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.campaign.rooms).toHaveLength(5);
    expect(body.session).toMatchObject({ status: "playing", score: 0, combo: 0, answers: [], rush: null, rushUnlocked: false });
    expect(text).not.toMatch(SECRET_FIELDS);
    // Реплика героя первой заявки комнаты открыта намеренно (облачко над героем в квесте, RoomProgress.next);
    // реплики остальных заявок, как и весь разбор, до выдачи заданий не уходят клиенту.
    const firstOfRoom = new Set(campaign.rooms.map((room) => room.tasks[0].id));
    for (const item of allTasks) {
      expect(text).not.toContain(item.explanation);
      if (!firstOfRoom.has(item.id)) expect(text).not.toContain(item.say);
    }
    for (const room of campaign.rooms) {
      const cue = body.session.rooms.find((candidate: { roomId: string }) => candidate.roomId === room.id).next;
      expect(cue).toEqual({ heroId: room.tasks[0].heroId, say: room.tasks[0].say });
    }
    for (const item of campaign.rush.pool) {
      expect(text).not.toContain(item.prompt);
    }
  });

  it("rejects a foreign or missing Origin with 403 and creates nothing", async () => {
    installFakes();
    const foreign = await api.createSession({ origin: FOREIGN_ORIGIN });
    const missing = await api.createSession({ origin: null });

    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await getPrisma().gameSession.count()).toBe(0);
  });

  it("returns 403 while the campaign is closed", async () => {
    installFakes(UPCOMING_NOW);
    const response = await api.createSession();

    expect(response.status).toBe(403);
    expect((await json(response)).error).toBe("Квиз пока закрыт.");
    expect(await getPrisma().gameSession.count()).toBe(0);
  });

  it("returns 403 after the claim window has ended", async () => {
    installFakes(new Date("2027-01-01T12:00:00Z"));
    expect((await api.createSession()).status).toBe(403);
  });

  it("opens a closed campaign only when QUIZ_FORCE_OPEN is enabled", async () => {
    installFakes(UPCOMING_NOW);
    process.env.QUIZ_FORCE_OPEN = "true";
    resetRuntimeEnvCache();
    try {
      expect((await api.createSession()).status).toBe(200);
    } finally {
      delete process.env.QUIZ_FORCE_OPEN;
      resetRuntimeEnvCache();
    }
  });
});

async function allEndpoints(sessionId: string, cookie: string | null, options: { origin?: string } = {}) {
  const [room, mail] = [rooms[0].id, task("mail-letters")];
  return {
    names: ["get", "enter", "roomTask", "answer", "rushStart", "rushAnswer", "rushFinish", "complete", "claim"],
    responses: await Promise.all([
      api.getSession(sessionId, cookie),
      api.enterRoom(sessionId, cookie, room, options),
      api.roomTask(sessionId, cookie, room),
      api.answer(sessionId, cookie, mail.id, correctPayload(mail), options),
      api.rushStart(sessionId, cookie, options),
      api.rushAnswer(sessionId, cookie, "rush-sender", "mail", options),
      api.rushFinish(sessionId, cookie, options),
      api.complete(sessionId, cookie, options),
      api.claim(sessionId, cookie, CLAIM, options)
    ])
  };
}

async function rowCounts() {
  const prisma = getPrisma();
  return [
    await prisma.roomEntry.count(),
    await prisma.taskAnswer.count(),
    await prisma.rushRun.count(),
    await prisma.rushAnswer.count()
  ];
}

describe("session access control", () => {
  it("denies every session endpoint without a cookie and writes nothing", async () => {
    installFakes();
    const player = await startSession();

    const { responses } = await allEndpoints(player.sessionId, null);

    expect(responses.map((response) => response.status)).toEqual(Array(9).fill(401));
    expect(await rowCounts()).toEqual([0, 0, 0, 0]);
  });

  it("denies another player's cookie on every session endpoint", async () => {
    installFakes();
    const owner = await startSession();
    const stranger = await startSession();

    const { responses } = await allEndpoints(owner.sessionId, stranger.accessKey);

    expect(responses.map((response) => response.status)).toEqual(Array(9).fill(401));
    expect((await json(responses[0])).error).toBe("Сессия недоступна.");
    expect(await rowCounts()).toEqual([0, 0, 0, 0]);
    expect((await getPrisma().gameSession.findUniqueOrThrow({ where: { id: owner.sessionId } })).status).toBe("playing");
  });

  it("answers 404 for an unknown session id", async () => {
    installFakes();
    const player = await startSession();
    const { responses } = await allEndpoints("00000000-0000-4000-8000-000000000000", player.accessKey);

    expect(responses.map((response) => response.status)).toEqual(Array(9).fill(404));
  });

  it("answers 404 when a stored answer refers to a task removed from the config", async () => {
    // Клиент забывает сессию только на 401/404 (shouldForgetSession); 500 оставил бы игрока с ошибкой.
    installFakes();
    const player = await startSession();
    await getPrisma().taskAnswer.create({
      data: {
        id: createId(),
        sessionId: player.sessionId,
        taskId: "removed-task",
        seq: 1,
        payload: { optionId: "x" },
        basePoints: 0,
        comboBonus: 0,
        combo: 0,
        answeredAt: OPEN_NOW
      }
    });

    const response = await api.getSession(player.sessionId, player.accessKey);

    expect(response.status).toBe(404);
    expect((await json(response)).error).toBe("Сессия не найдена.");
  });

  it("answers 404 (not 500) for a malformed session id", async () => {
    installFakes();
    const player = await startSession();

    for (const id of ["not-a-uuid", "1", "%27%20OR%201=1"]) {
      const { responses } = await allEndpoints(id, player.accessKey);
      expect(responses.map((response) => response.status)).toEqual(Array(9).fill(404));
    }
  });

  it("rejects a foreign Origin on every mutating endpoint", async () => {
    installFakes();
    const player = await startSession();

    const { names, responses } = await allEndpoints(player.sessionId, player.accessKey, { origin: FOREIGN_ORIGIN });

    // GET-маршруты Origin не проверяют.
    expect(responses.map((response, index) => [names[index], response.status])).toEqual([
      ["get", 200],
      ["enter", 403],
      ["roomTask", 409],
      ["answer", 403],
      ["rushStart", 403],
      ["rushAnswer", 403],
      ["rushFinish", 403],
      ["complete", 403],
      ["claim", 403]
    ]);
    expect(await rowCounts()).toEqual([0, 0, 0, 0]);
  });
});

describe("rooms", () => {
  it("fixes the entry time on the first visit and keeps it on repeated and concurrent entries", async () => {
    installFakes();
    const player = await startSession();

    const first = await json(await api.enterRoom(player.sessionId, player.accessKey, "mail"));
    clock.advance(45_000);
    const again = await json(await api.enterRoom(player.sessionId, player.accessKey, "mail"));
    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => api.enterRoom(player.sessionId, player.accessKey, "files"))
    );

    expect(first.room).toMatchObject({ entered: true, enteredAt: OPEN_NOW.toISOString(), currentTaskId: "mail-letters", answered: 0 });
    expect(again.room.enteredAt).toBe(OPEN_NOW.toISOString());
    expect(parallel.map((response) => response.status)).toEqual(Array(5).fill(200));
    expect(new Set((await Promise.all(parallel.map(json))).map((body) => body.room.enteredAt)).size).toBe(1);
    expect(await getPrisma().roomEntry.count({ where: { sessionId: player.sessionId } })).toBe(2);
  });

  it("fixes the show time of a task on its first issue and keeps it on repeated and concurrent requests", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    clock.advance(30_000); // игрок мнётся в комнате: время задания ещё не идёт

    const first = await json(await api.roomTask(player.sessionId, player.accessKey, "mail"));
    clock.advance(10_000);
    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => api.roomTask(player.sessionId, player.accessKey, "mail"))
    );
    const bodies = await Promise.all(parallel.map(json));

    const shownAt = new Date(OPEN_NOW.getTime() + 30_000).toISOString();
    expect(first.room.taskShownAt).toBe(shownAt);
    expect(new Set(bodies.map((body) => body.room.taskShownAt))).toEqual(new Set([shownAt]));
    expect(await getPrisma().taskShown.count({ where: { sessionId: player.sessionId } })).toBe(1);
    // Порядок вариантов при повторных запросах тот же.
    expect(new Set(bodies.map((body) => JSON.stringify(body.task.letters.map((letter: { id: string }) => letter.id)))).size).toBe(1);
  });

  it("ignores a shown mark written after the answer (late GET racing with POST)", async () => {
    installFakes();
    const player = await startSession();
    const room = rooms[0];
    const [first] = room.tasks;
    await api.enterRoom(player.sessionId, player.accessKey, room.id);
    clock.advance(12_000);
    expect((await api.answer(player.sessionId, player.accessKey, first.id, correctPayload(first))).status).toBe(200);
    // Запоздавший запрос задания: отметка выдачи оказывается позже ответа.
    clock.advance(1_000);
    await getPrisma().taskShown.create({ data: { sessionId: player.sessionId, taskId: first.id, shownAt: new Date(clock.value) } });

    const state = await json(await api.getSession(player.sessionId, player.accessKey));
    const progress = state.session.rooms.find((item: { roomId: string }) => item.roomId === room.id);
    expect(progress.spentMs).toBe(12_000);
  });

  it("serves an answered task for the reveal on ?taskId=, writes no shown mark and refuses an unanswered one", async () => {
    installFakes();
    const player = await startSession();
    const room = rooms[0];
    const [first, second] = room.tasks;
    await api.enterRoom(player.sessionId, player.accessKey, room.id);
    await api.roomTask(player.sessionId, player.accessKey, room.id);
    expect((await api.answer(player.sessionId, player.accessKey, first.id, correctPayload(first))).status).toBe(200);

    const again = await api.roomTask(player.sessionId, player.accessKey, room.id, first.id);
    const text = await again.text();
    const body = JSON.parse(text);
    expect(again.status).toBe(200);
    expect(body.task.id).toBe(first.id);
    expect(body.taskNumber).toBe(1);
    expect(text).not.toMatch(SECRET_FIELDS);
    expect(await getPrisma().taskShown.count({ where: { sessionId: player.sessionId, taskId: second.id } })).toBe(0);

    expect((await api.roomTask(player.sessionId, player.accessKey, room.id, second.id)).status).toBe(409);
    expect((await api.roomTask(player.sessionId, player.accessKey, room.id, "ghost")).status).toBe(404);
  });

  it("measures the room by the time of its tasks and ignores the time spent reading reveals", async () => {
    installFakes();
    const player = await startSession();
    const room = rooms[0];
    await api.enterRoom(player.sessionId, player.accessKey, room.id);
    let last: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const item of room.tasks) {
      await api.roomTask(player.sessionId, player.accessKey, room.id);
      clock.advance(10_000);
      last = await json(await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item)));
      clock.advance(200_000); // чтение разбора
    }

    expect(last.roomResult).toMatchObject({ elapsedSeconds: 30, speedBonus: 90 });
  });

  it("answers 404 for an unknown room", async () => {
    installFakes();
    const player = await startSession();

    expect((await api.enterRoom(player.sessionId, player.accessKey, "attic")).status).toBe(404);
    expect((await api.roomTask(player.sessionId, player.accessKey, "attic")).status).toBe(404);
  });

  it("serves the current task only after entering, without any correctness hint", async () => {
    installFakes();
    const player = await startSession();

    const early = await api.roomTask(player.sessionId, player.accessKey, "mail");
    expect(early.status).toBe(409);

    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    const response = await api.roomTask(player.sessionId, player.accessKey, "mail");
    const text = await response.text();
    const body = JSON.parse(text);

    expect(body.task).toMatchObject({ id: "mail-letters", type: "phish", heroId: "timur" });
    expect(body.taskNumber).toBe(1);
    expect(body.task.letters).toHaveLength(5);
    expect(text).not.toMatch(SECRET_FIELDS);
  });

  it("never leaks the correct answer of any of the 15 tasks before it is answered", async () => {
    installFakes();
    const player = await startSession();
    let answered = 0;

    for (const room of rooms) {
      await api.enterRoom(player.sessionId, player.accessKey, room.id);
      for (const item of room.tasks) {
        const text = await (await api.roomTask(player.sessionId, player.accessKey, room.id)).text();
        const progress = await (await api.getSession(player.sessionId, player.accessKey)).text();

        for (const secret of [item.thanks, item.oops, item.tip, item.explanation]) {
          expect(text).not.toContain(secret);
          expect(progress).not.toContain(secret);
        }
        expect(text).not.toMatch(SECRET_FIELDS);
        // Разбор есть ровно у уже отвеченных заданий.
        expect(progress.match(/correctIds/g) ?? []).toHaveLength(answered);
        await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item));
        answered += 1;
      }
      const done = await json(await api.roomTask(player.sessionId, player.accessKey, room.id));
      expect(done.task).toBeNull();
      expect(done.room.completed).toBe(true);
    }
  });

  it("lets the player visit the five rooms in any order", async () => {
    installFakes();
    const player = await startSession();

    for (const roomId of ["projects", "mail", "files", "messenger", "calendar"]) {
      await playRoom(player, roomId);
    }

    const progress = (await json(await api.getSession(player.sessionId, player.accessKey))).session;
    expect(progress.roomsCompleted).toBe(5);
    expect(progress.rushUnlocked).toBe(true);
    expect(progress.answers.map((answer: { roomId: string }) => answer.roomId)).toEqual(
      ["projects", "projects", "projects", "mail", "mail", "mail", "files", "files", "files", "messenger", "messenger", "messenger", "calendar", "calendar", "calendar"]
    );
  });
});

describe("answers", () => {
  it("reveals the correct answer only after the answer is recorded", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    const [first, second] = rooms[0].tasks;

    const before = await json(await api.getSession(player.sessionId, player.accessKey));
    expect(before.session.answers).toEqual([]);

    const response = await api.answer(player.sessionId, player.accessKey, first.id, wrongPayload(first));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.reveal).toMatchObject({
      taskId: "mail-letters",
      outcome: "miss",
      base: 0,
      correctIds: ["m2"],
      explanation: first.explanation,
      tip: first.tip,
      line: first.oops,
      mood: "sad",
      fuses: 2
    });
    expect(body.nextTaskId).toBe(second.id);

    const after = await json(await api.getSession(player.sessionId, player.accessKey));
    expect(after.session.answers).toHaveLength(1);
    expect(after.session.answers[0].correctIds).toEqual(["m2"]);
    expect(JSON.stringify(after)).not.toContain(second.explanation);
    expect(JSON.stringify(after)).not.toContain(second.tip);
  });

  it("stores the base, combo bonus and server timestamp of every answer", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    for (const item of rooms[0].tasks) {
      clock.advance(1000);
      await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item));
    }

    const rows = await getPrisma().taskAnswer.findMany({ where: { sessionId: player.sessionId }, orderBy: { seq: "asc" } });

    expect(rows.map((row) => [row.seq, row.taskId, row.basePoints, row.comboBonus, row.combo])).toEqual([
      [1, "mail-letters", 100, 0, 1],
      [2, "mail-invite", 100, 25, 2],
      [3, "mail-answer", 100, 50, 3]
    ]);
    expect(rows.map((row) => row.answeredAt.getTime())).toEqual([1000, 2000, 3000].map((offset) => OPEN_NOW.getTime() + offset));
    expect(rows[0].payload).toEqual({ optionId: "m2" });
  });

  it("is idempotent: a repeated answer keeps the first result and score, whatever the body", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    const item = rooms[0].tasks[0];

    const first = await json(await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item)));
    clock.advance(20_000);
    const retry = await json(await api.answer(player.sessionId, player.accessKey, item.id, wrongPayload(item)));
    const malformed = await api.answer(player.sessionId, player.accessKey, item.id, { nonsense: true });

    expect(retry).toEqual(first);
    expect(malformed.status).toBe(200);
    expect(first.reveal.base).toBe(100);
    expect(first.score).toBe(100);
    expect(await getPrisma().taskAnswer.count()).toBe(1);
  });

  it("stays at one record under concurrent answers to one task, even with different bodies", async () => {
    installFakes();
    const item = rooms[0].tasks[0];

    for (let round = 0; round < 10; round += 1) {
      const player = await startSession();
      await api.enterRoom(player.sessionId, player.accessKey, "mail");
      const payloads = [correctPayload(item), wrongPayload(item), correctPayload(item), wrongPayload(item), correctPayload(item), wrongPayload(item)];
      const responses = await Promise.all(payloads.map((payload) => api.answer(player.sessionId, player.accessKey, item.id, payload)));
      const bodies = await Promise.all(responses.map(json));

      expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));
      expect(new Set(bodies.map((body) => body.reveal.base)).size).toBe(1);
      expect(new Set(bodies.map((body) => body.score)).size).toBe(1);
      expect(await getPrisma().taskAnswer.count({ where: { sessionId: player.sessionId } })).toBe(1);
      const stored = await getPrisma().taskAnswer.findFirstOrThrow({ where: { sessionId: player.sessionId } });
      expect(stored.basePoints).toBe(bodies[0].reveal.base);
    }
  });

  it("keeps the combo and sequence consistent when a room's tasks arrive in parallel", async () => {
    installFakes();
    const room = rooms[0];

    for (let round = 0; round < 8; round += 1) {
      const player = await startSession();
      await api.enterRoom(player.sessionId, player.accessKey, room.id);
      const responses = await Promise.all(
        room.tasks.map((item) => api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item)))
      );

      expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
      const rows = await getPrisma().taskAnswer.findMany({ where: { sessionId: player.sessionId }, orderBy: { seq: "asc" } });
      // Записанные ответы — всегда начало комнаты по порядку, без пропусков и повторов.
      expect(rows.map((row) => row.seq)).toEqual(rows.map((_, index) => index + 1));
      expect(rows.map((row) => row.taskId)).toEqual(room.tasks.slice(0, rows.length).map((item) => item.id));
      expect(rows.map((row) => row.combo)).toEqual(rows.map((_, index) => index + 1));
    }
  });

  it("builds the combo on the order of answers when two rooms are played alternately", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    await api.enterRoom(player.sessionId, player.accessKey, "files");

    const sequence = [rooms[0].tasks[0], rooms[3].tasks[0], rooms[0].tasks[1], rooms[3].tasks[1]];
    const results = [];
    for (const item of sequence) {
      results.push(await json(await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item))));
    }

    expect(results.map((body) => body.reveal.combo)).toEqual([1, 2, 3, 4]);
    expect(results.map((body) => body.reveal.comboBonus)).toEqual([0, 25, 50, 75]);
  });

  it("refuses an answer before entering the room and out of sequence, recording nothing", async () => {
    installFakes();
    const player = await startSession();
    const [first, second] = rooms[0].tasks;

    const notEntered = await api.answer(player.sessionId, player.accessKey, first.id, correctPayload(first));
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    const outOfOrder = await api.answer(player.sessionId, player.accessKey, second.id, correctPayload(second));

    expect(notEntered.status).toBe(409);
    expect(outOfOrder.status).toBe(409);
    expect(await getPrisma().taskAnswer.count()).toBe(0);
  });

  it("validates input: unknown task 404, wrong payload 400, bad body 400 and none of it consumes the task", async () => {
    installFakes();
    const player = await startSession();
    await api.enterRoom(player.sessionId, player.accessKey, "mail");
    const item = rooms[0].tasks[0];

    const unknownTask = await api.answer(player.sessionId, player.accessKey, "nope-1", { optionId: "m2" });
    const unknownOption = await api.answer(player.sessionId, player.accessKey, item.id, { optionId: "missing" });
    const wrongShape = await api.answer(player.sessionId, player.accessKey, item.id, { optionIds: ["m2"] });
    const noPayload = await api.answer(player.sessionId, player.accessKey, item.id, undefined as unknown as object);
    const badBody = await api.answer(player.sessionId, player.accessKey, "", {});

    expect(unknownTask.status).toBe(404);
    expect([unknownOption, wrongShape, noPayload, badBody].map((response) => response.status)).toEqual([400, 400, 400, 400]);
    for (const response of [unknownTask, unknownOption, wrongShape]) {
      expect((await json(response)).error).toMatch(/[А-Яа-я]/);
    }
    expect(await getPrisma().taskAnswer.count()).toBe(0);

    const ok = await api.answer(player.sessionId, player.accessKey, item.id, correctPayload(item));
    expect(ok.status).toBe(200);
  });

  it("checks the payload of each task type: build slots, access switches and order", async () => {
    installFakes();
    const player = await startSession();
    await playRoom(player, "mail", { payloadFor: (item, index) => (index === 2 ? wrongPayload(item) : correctPayload(item)) });
    const rows = await getPrisma().taskAnswer.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((row) => row.basePoints)).toEqual([100, 100, 0]);

    await api.enterRoom(player.sessionId, player.accessKey, "files");
    const access = task("files-backup");
    const tooMany = await api.answer(player.sessionId, player.accessKey, access.id, { enabledIds: ["daily", "daily"] });
    expect(tooMany.status).toBe(400);
  });

  it("does not accept new answers after completion but still replays recorded ones", async () => {
    installFakes();
    const player = await completedPlayer();
    const item = rooms[0].tasks[0];

    const replay = await api.answer(player.sessionId, player.accessKey, item.id, wrongPayload(item));

    expect(replay.status).toBe(200);
    expect((await json(replay)).reveal.base).toBe(100);
  });
});

describe("progress for session recovery", () => {
  it("restores rooms, current task, score, combo and fuses mid-room", async () => {
    installFakes();
    const player = await startSession();
    await playRoom(player, "mail");
    await api.enterRoom(player.sessionId, player.accessKey, "calendar");
    const [first, second] = rooms[1].tasks;
    clock.advance(5_000);
    await api.answer(player.sessionId, player.accessKey, first.id, wrongPayload(first));
    await api.answer(player.sessionId, player.accessKey, second.id, correctPayload(second));

    const { session } = await json(await api.getSession(player.sessionId, player.accessKey));
    const calendar = session.rooms.find((room: { roomId: string }) => room.roomId === "calendar");

    expect(session.rooms.map((room: { roomId: string; completed: boolean }) => [room.roomId, room.completed])).toEqual([
      ["mail", true],
      ["calendar", false],
      ["messenger", false],
      ["files", false],
      ["projects", false]
    ]);
    expect(calendar).toMatchObject({ entered: true, answered: 2, currentTaskId: "calendar-focus", fuses: 2, summary: null });
    expect(session.combo).toBe(1);
    expect(session.roomsCompleted).toBe(1);
    expect(session.answers).toHaveLength(5);
    // Комната почты завершена: 300 + 75 + 50 + 150; календарь пока даёт только базу: 0 + 100.
    expect(session.score).toBe(300 + 75 + 50 + 150 + 100);
    expect(session.rush).toBeNull();
    expect(session.final).toBeNull();
  });
});
