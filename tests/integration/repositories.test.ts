import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { DomainError } from "@/domain/errors";
import { createId, createOpaqueToken, hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";
import type {
  ClaimRepository,
  PrizeClaimRecord,
  VerificationRecord
} from "@/server/repositories/claim-repository";
import { InMemoryClaimRepository } from "@/server/repositories/in-memory-claim-repository";
import { InMemorySessionRepository } from "@/server/repositories/in-memory-session-repository";
import { PrismaClaimRepository } from "@/server/repositories/prisma-claim-repository";
import { PrismaSessionRepository } from "@/server/repositories/prisma-session-repository";
import type {
  GameSessionRecord,
  RushRunRecord,
  SessionRepository,
  TaskAnswerDraft
} from "@/server/repositories/session-repository";

import { databaseSchema, quoteIdentifier } from "./helpers/database";

type Backend = {
  name: string;
  create: () => Promise<{ sessions: SessionRepository; claims: ClaimRepository }>;
};

const backends: Backend[] = [
  {
    name: "in-memory",
    create: async () => {
      const sessions = new InMemorySessionRepository();
      return { sessions, claims: new InMemoryClaimRepository() };
    }
  },
  {
    name: "prisma/postgres",
    create: async () => {
      const prisma = getPrisma();
      await prisma.campaign.upsert({
        where: { slug: campaign.slug },
        update: {},
        create: { slug: campaign.slug, title: campaign.title }
      });
      return { sessions: new PrismaSessionRepository(prisma), claims: new PrismaClaimRepository(prisma) };
    }
  }
];

/** Ждёт, пока другое соединение встанет в очередь на блокировку строки. */
async function waitForLockWaiter(client: pg.Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query<{ waiting: number }>(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
    );
    if (rows[0].waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Конкурирующая транзакция так и не встала на блокировку");
}

function sessionRecord(overrides: Partial<GameSessionRecord> = {}): GameSessionRecord {
  return {
    id: createId(),
    campaignSlug: campaign.slug,
    accessKeyHash: hashToken(createOpaqueToken()),
    status: "playing",
    score: null,
    rewardTierTitle: null,
    startedAt: new Date("2026-12-24T10:00:00Z"),
    completedAt: null,
    ...overrides
  };
}

function taskDraft(overrides: Partial<TaskAnswerDraft> = {}): TaskAnswerDraft {
  return {
    id: createId(),
    payload: { optionId: "bcc" },
    basePoints: 100,
    comboBonus: 0,
    combo: 1,
    answeredAt: new Date("2026-12-24T10:01:00Z"),
    ...overrides
  };
}

function rushRun(sessionId: string, overrides: Partial<RushRunRecord> = {}): RushRunRecord {
  return {
    sessionId,
    startedAt: new Date("2026-12-24T10:10:00Z"),
    deadlineAt: new Date("2026-12-24T10:10:30Z"),
    poolOrder: ["rush-a", "rush-b", "rush-c"],
    finishedAt: null,
    ...overrides
  };
}

function claimFixture(sessionId: string, email: string) {
  const claimId = createId();
  const token = createOpaqueToken();
  const claim: PrizeClaimRecord = {
    id: claimId,
    campaignSlug: campaign.slug,
    sessionId,
    normalizedEmail: email,
    name: "Тест",
    company: "Компания",
    consentAt: new Date("2026-12-24T10:00:00Z"),
    status: "claim_pending",
    createdAt: new Date("2026-12-24T10:00:00Z"),
    verifiedAt: null
  };
  const verification: VerificationRecord = {
    claimId,
    tokenHash: hashToken(token),
    expiresAt: new Date("2026-12-25T10:00:00Z"),
    usedAt: null
  };
  return { claim, verification, token };
}

describe.each(backends)("SessionRepository contract: $name", (backend) => {
  let sessions: SessionRepository;

  beforeEach(async () => {
    ({ sessions } = await backend.create());
  });

  it("stores and returns a session; unknown id gives null", async () => {
    const record = sessionRecord();
    const created = await sessions.createSession(record);

    expect(created).toEqual(record);
    expect(await sessions.getSession(record.id)).toEqual(record);
    expect(await sessions.getSession(createId())).toBeNull();
  });

  it("keeps the first room entry time and does not mix sessions", async () => {
    const one = await sessions.createSession(sessionRecord());
    const two = await sessions.createSession(sessionRecord());
    const first = await sessions.enterRoomOnce(one.id, "mail", new Date("2026-12-24T10:00:00Z"));
    const again = await sessions.enterRoomOnce(one.id, "mail", new Date("2026-12-24T10:05:00Z"));
    await sessions.enterRoomOnce(one.id, "files", new Date("2026-12-24T10:06:00Z"));
    await sessions.enterRoomOnce(two.id, "mail", new Date("2026-12-24T10:07:00Z"));

    expect(again).toEqual(first);
    expect(first.enteredAt).toEqual(new Date("2026-12-24T10:00:00Z"));
    expect((await sessions.listRoomEntries(one.id)).map((entry) => entry.roomId).sort()).toEqual(["files", "mail"]);
    expect(await sessions.listRoomEntries(two.id)).toHaveLength(1);
  });

  it("keeps a single entry when a room is entered concurrently", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          sessions.enterRoomOnce(session.id, "mail", new Date(2026, 11, 24, 10, 0, index))
        )
      );

      expect(new Set(results.map((entry) => entry.enteredAt.getTime())).size).toBe(1);
      expect(await sessions.listRoomEntries(session.id)).toHaveLength(1);
    }
  });

  it("keeps the first time a task was shown and does not mix sessions", async () => {
    const one = await sessions.createSession(sessionRecord());
    const two = await sessions.createSession(sessionRecord());
    const first = await sessions.markTaskShownOnce(one.id, "mail-letters", new Date("2026-12-24T10:00:00Z"));
    const again = await sessions.markTaskShownOnce(one.id, "mail-letters", new Date("2026-12-24T10:05:00Z"));
    await sessions.markTaskShownOnce(one.id, "mail-invite", new Date("2026-12-24T10:06:00Z"));
    await sessions.markTaskShownOnce(two.id, "mail-letters", new Date("2026-12-24T10:07:00Z"));

    expect(again).toEqual(first);
    expect(first.shownAt).toEqual(new Date("2026-12-24T10:00:00Z"));
    expect((await sessions.listTaskShown(one.id)).map((record) => record.taskId).sort()).toEqual(["mail-invite", "mail-letters"]);
    expect(await sessions.listTaskShown(two.id)).toHaveLength(1);
  });

  it("keeps a single shown mark when a task is requested concurrently", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          sessions.markTaskShownOnce(session.id, "mail-letters", new Date(2026, 11, 24, 10, 0, index))
        )
      );

      expect(new Set(results.map((record) => record.shownAt.getTime())).size).toBe(1);
      expect(await sessions.listTaskShown(session.id)).toHaveLength(1);
    }
  });

  it("records one answer per task: a retry returns the stored answer and does not call decide", async () => {
    const session = await sessions.createSession(sessionRecord());
    const first = await sessions.recordTaskAnswerOnce(session.id, "mail-invite", () => taskDraft());
    let called = false;
    const retry = await sessions.recordTaskAnswerOnce(session.id, "mail-invite", () => {
      called = true;
      return taskDraft({ payload: { optionId: "copyall" }, basePoints: 0, combo: 0 });
    });

    expect(first).toMatchObject({ created: true, answer: { seq: 1, taskId: "mail-invite", payload: { optionId: "bcc" } } });
    expect(retry).toEqual({ answer: first.answer, created: false });
    expect(called).toBe(false);
    expect(await sessions.listTaskAnswers(session.id)).toHaveLength(1);
  });

  it("numbers answers in order and hands decide the answers and entries recorded so far", async () => {
    const session = await sessions.createSession(sessionRecord());
    await sessions.enterRoomOnce(session.id, "mail", new Date("2026-12-24T10:00:00Z"));
    const seen: number[] = [];
    for (const taskId of ["mail-letters", "mail-invite", "mail-answer"]) {
      await sessions.recordTaskAnswerOnce(session.id, taskId, ({ answers, entries }) => {
        seen.push(answers.length * 10 + entries.length);
        return taskDraft({ combo: answers.length + 1 });
      });
    }

    expect(seen).toEqual([1, 11, 21]);
    const stored = await sessions.listTaskAnswers(session.id);
    expect(stored.map((answer) => [answer.seq, answer.taskId, answer.combo])).toEqual([
      [1, "mail-letters", 1],
      [2, "mail-invite", 2],
      [3, "mail-answer", 3]
    ]);
  });

  it("stores the answer payload and timestamps exactly", async () => {
    const session = await sessions.createSession(sessionRecord());
    const at = new Date("2026-12-24T10:01:02.345Z");
    await sessions.recordTaskAnswerOnce(session.id, "mail-answer", () =>
      taskDraft({ payload: { optionIds: ["apology", "resend", "contact"] }, basePoints: 50, comboBonus: 25, combo: 2, answeredAt: at })
    );

    expect(await sessions.listTaskAnswers(session.id)).toMatchObject([
      { payload: { optionIds: ["apology", "resend", "contact"] }, basePoints: 50, comboBonus: 25, combo: 2, answeredAt: at }
    ]);
  });

  it("records nothing when decide throws", async () => {
    const session = await sessions.createSession(sessionRecord());
    await expect(
      sessions.recordTaskAnswerOnce(session.id, "mail-letters", () => {
        throw new DomainError("conflict", "Нельзя.");
      })
    ).rejects.toMatchObject({ code: "conflict" });

    expect(await sessions.listTaskAnswers(session.id)).toEqual([]);
    const retry = await sessions.recordTaskAnswerOnce(session.id, "mail-letters", () => taskDraft());
    expect(retry.answer.seq).toBe(1);
  });

  it("keeps a single answer when the same task is answered concurrently", async () => {
    // Окно гонки узкое: один раунд почти всегда проходит, поэтому раундов много.
    for (let round = 0; round < 30; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          sessions.recordTaskAnswerOnce(session.id, "mail-letters", () =>
            taskDraft({ basePoints: index === 0 ? 100 : 0, payload: { optionId: `opt-${index}` } })
          )
        )
      );

      expect(new Set(results.map((result) => result.answer.id)).size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(await sessions.listTaskAnswers(session.id)).toHaveLength(1);
    }
  });

  it("serializes concurrent answers of different tasks: no duplicate seq, combo built on the previous answer", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      const taskIds = ["t1", "t2", "t3", "t4", "t5", "t6"];
      await Promise.all(
        taskIds.map((taskId) =>
          sessions.recordTaskAnswerOnce(session.id, taskId, ({ answers }) =>
            taskDraft({ combo: (answers.at(-1)?.combo ?? 0) + 1 })
          )
        )
      );

      const stored = await sessions.listTaskAnswers(session.id);
      expect(stored.map((answer) => answer.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(stored.map((answer) => answer.combo)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(stored.map((answer) => answer.taskId)).size).toBe(6);
    }
  });

  it("lists answers of a session by seq and never mixes sessions", async () => {
    const one = await sessions.createSession(sessionRecord());
    const two = await sessions.createSession(sessionRecord());
    await sessions.recordTaskAnswerOnce(one.id, "mail-invite", () => taskDraft());
    await sessions.recordTaskAnswerOnce(one.id, "mail-letters", () => taskDraft());
    await sessions.recordTaskAnswerOnce(two.id, "mail-letters", () => taskDraft());

    expect((await sessions.listTaskAnswers(one.id)).map((answer) => answer.taskId)).toEqual(["mail-invite", "mail-letters"]);
    expect(await sessions.listTaskAnswers(two.id)).toHaveLength(1);
  });

  it("starts the rush once and keeps the first run", async () => {
    const session = await sessions.createSession(sessionRecord());
    expect(await sessions.getRushRun(session.id)).toBeNull();

    const first = await sessions.startRushOnce(rushRun(session.id));
    const again = await sessions.startRushOnce(rushRun(session.id, { poolOrder: ["rush-c", "rush-b", "rush-a"] }));

    expect(first).toEqual(rushRun(session.id));
    expect(again).toEqual(first);
    expect(await sessions.getRushRun(session.id)).toEqual(first);
  });

  it("starts a single rush under concurrent starts", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      const runs = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          sessions.startRushOnce(rushRun(session.id, { poolOrder: [`rush-${index}`] }))
        )
      );
      expect(new Set(runs.map((run) => run.poolOrder[0])).size).toBe(1);
    }
  });

  it("refuses a rush answer or finish without a run", async () => {
    const session = await sessions.createSession(sessionRecord());
    await expect(
      sessions.recordRushAnswerOnce(session.id, "rush-a", () => ({
        answer: { serviceId: "mail", correct: true, answeredAt: new Date() },
        deadlineAt: new Date()
      }))
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(sessions.finishRushOnce(session.id, new Date())).rejects.toMatchObject({ code: "conflict" });
  });

  it("records a rush answer once, moves the deadline and returns the stored answer on retry", async () => {
    const session = await sessions.createSession(sessionRecord());
    await sessions.startRushOnce(rushRun(session.id));
    const answeredAt = new Date("2026-12-24T10:10:05Z");

    const first = await sessions.recordRushAnswerOnce(session.id, "rush-a", ({ run }) => ({
      answer: { serviceId: "files", correct: false, answeredAt },
      deadlineAt: new Date(run.deadlineAt.getTime() - 2_000)
    }));
    let called = false;
    const retry = await sessions.recordRushAnswerOnce(session.id, "rush-a", () => {
      called = true;
      return { answer: { serviceId: "mail", correct: true, answeredAt }, deadlineAt: new Date(0) };
    });

    expect(first).toMatchObject({ created: true, answer: { itemId: "rush-a", serviceId: "files", correct: false } });
    expect(first.run.deadlineAt).toEqual(new Date("2026-12-24T10:10:28Z"));
    expect(retry).toMatchObject({ created: false, answer: { serviceId: "files", correct: false } });
    expect(retry.run.deadlineAt).toEqual(new Date("2026-12-24T10:10:28Z"));
    expect(called).toBe(false);
    expect(await sessions.listRushAnswers(session.id)).toHaveLength(1);
  });

  it("leaves the run untouched when the rush decide throws", async () => {
    const session = await sessions.createSession(sessionRecord());
    await sessions.startRushOnce(rushRun(session.id));
    await expect(
      sessions.recordRushAnswerOnce(session.id, "rush-a", () => {
        throw new DomainError("expired", "Время вышло.");
      })
    ).rejects.toMatchObject({ code: "expired" });

    expect(await sessions.listRushAnswers(session.id)).toEqual([]);
    expect((await sessions.getRushRun(session.id))!.deadlineAt).toEqual(new Date("2026-12-24T10:10:30Z"));
  });

  it("does not lose deadline shifts when mistakes are submitted concurrently", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      await sessions.startRushOnce(rushRun(session.id, { poolOrder: ["a", "b", "c", "d", "e", "f"] }));
      await Promise.all(
        ["a", "b", "c", "d", "e", "f"].map((itemId) =>
          sessions.recordRushAnswerOnce(session.id, itemId, ({ run }) => ({
            answer: { serviceId: "mail", correct: false, answeredAt: new Date("2026-12-24T10:10:05Z") },
            deadlineAt: new Date(run.deadlineAt.getTime() - 2_000)
          }))
        )
      );

      expect((await sessions.getRushRun(session.id))!.deadlineAt).toEqual(new Date("2026-12-24T10:10:18Z"));
      expect(await sessions.listRushAnswers(session.id)).toHaveLength(6);
    }
  });

  it("keeps a single answer when the same rush item is answered concurrently", async () => {
    for (let round = 0; round < 15; round += 1) {
      const session = await sessions.createSession(sessionRecord());
      await sessions.startRushOnce(rushRun(session.id));
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          sessions.recordRushAnswerOnce(session.id, "rush-a", ({ run }) => ({
            answer: { serviceId: `s${index}`, correct: false, answeredAt: new Date("2026-12-24T10:10:05Z") },
            deadlineAt: new Date(run.deadlineAt.getTime() - 2_000)
          }))
        )
      );

      expect(new Set(results.map((result) => result.answer.serviceId)).size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect((await sessions.getRushRun(session.id))!.deadlineAt).toEqual(new Date("2026-12-24T10:10:28Z"));
    }
  });

  it("finishes the rush once and keeps the first finish time", async () => {
    const session = await sessions.createSession(sessionRecord());
    await sessions.startRushOnce(rushRun(session.id));
    const first = await sessions.finishRushOnce(session.id, new Date("2026-12-24T10:10:20Z"));
    const second = await sessions.finishRushOnce(session.id, new Date("2026-12-24T10:10:25Z"));

    expect(first.finishedAt).toEqual(new Date("2026-12-24T10:10:20Z"));
    expect(second).toEqual(first);
  });

  it("is idempotent on repeated finalization and keeps the first result", async () => {
    const session = await sessions.createSession(sessionRecord());
    const firstAt = new Date("2026-12-24T11:00:00Z");
    const first = await sessions.completeOnce(session.id, { score: 800, rewardTierTitle: "Первый", completedAt: firstAt });
    const second = await sessions.completeOnce(session.id, {
      score: 100,
      rewardTierTitle: "Второй",
      completedAt: new Date("2026-12-24T12:00:00Z")
    });

    expect(first).toMatchObject({ status: "completed", score: 800, rewardTierTitle: "Первый", completedAt: firstAt });
    expect(second).toEqual(first);
  });

  it("keeps the first result under concurrent finalization", async () => {
    const session = await sessions.createSession(sessionRecord());
    const results = await Promise.all(
      [100, 200, 300, 400].map((score) =>
        sessions.completeOnce(session.id, {
          score,
          rewardTierTitle: `Уровень ${score}`,
          completedAt: new Date(2026, 11, 24, 11, 0, score / 100)
        })
      )
    );
    const stored = await sessions.getSession(session.id);

    expect(stored?.status).toBe("completed");
    for (const result of results) expect(result.score).toBe(stored?.score);
  });

  it("rejects finalization of an unknown session", async () => {
    await expect(
      sessions.completeOnce(createId(), { score: 0, rewardTierTitle: "x", completedAt: new Date() })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe.each(backends)("ClaimRepository contract: $name", (backend) => {
  let sessions: SessionRepository;
  let claims: ClaimRepository;

  beforeEach(async () => {
    ({ sessions, claims } = await backend.create());
  });

  async function newSessionId(): Promise<string> {
    return (await sessions.createSession(sessionRecord())).id;
  }

  it("creates a pending claim together with its verification", async () => {
    const fixture = claimFixture(await newSessionId(), "ivan@example.com");
    const result = await claims.prepareClaim(fixture.claim, fixture.verification);

    expect(result).toMatchObject({ created: true, verificationPrepared: true });
    expect(result.claim).toMatchObject({ id: fixture.claim.id, status: "claim_pending", verifiedAt: null });
  });

  it("verifies a token, marks the claim and treats a repeated token as already used without changing state", async () => {
    const fixture = claimFixture(await newSessionId(), "ivan@example.com");
    await claims.prepareClaim(fixture.claim, fixture.verification);
    const firstAt = new Date("2026-12-24T11:00:00Z");

    const verified = await claims.verifyByTokenHash(fixture.verification.tokenHash, firstAt);
    const again = await claims.verifyByTokenHash(fixture.verification.tokenHash, new Date("2026-12-24T12:00:00Z"));

    expect(verified).toMatchObject({ status: "email_verified", verifiedAt: firstAt });
    expect(again).toEqual(verified);
  });

  it("rejects an unknown token", async () => {
    await expect(claims.verifyByTokenHash(hashToken("nope"), new Date())).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects a token of another campaign without marking the claim, accepts it for its own campaign", async () => {
    const fixture = claimFixture(await newSessionId(), "ivan@example.com");
    await claims.prepareClaim(fixture.claim, fixture.verification);
    const at = new Date("2026-12-24T11:00:00Z");

    await expect(claims.verifyByTokenHash(fixture.verification.tokenHash, at, "other-campaign")).rejects.toMatchObject({ code: "invalid" });
    const verified = await claims.verifyByTokenHash(fixture.verification.tokenHash, at, campaign.slug);
    expect(verified).toMatchObject({ status: "email_verified", verifiedAt: at });
  });

  it("rejects an expired token, accepts it exactly at expiry and leaves the claim pending after rejection", async () => {
    const fixture = claimFixture(await newSessionId(), "ivan@example.com");
    await claims.prepareClaim(fixture.claim, fixture.verification);

    await expect(
      claims.verifyByTokenHash(fixture.verification.tokenHash, new Date(fixture.verification.expiresAt.getTime() + 1))
    ).rejects.toMatchObject({ code: "expired" });

    const atExpiry = await claims.verifyByTokenHash(fixture.verification.tokenHash, fixture.verification.expiresAt);
    expect(atExpiry.status).toBe("email_verified");
  });

  it("replaces the token when the same session retries a pending claim", async () => {
    const sessionId = await newSessionId();
    const first = claimFixture(sessionId, "ivan@example.com");
    await claims.prepareClaim(first.claim, first.verification);
    const second = claimFixture(sessionId, "ivan@example.com");

    const retry = await claims.prepareClaim(second.claim, second.verification);

    expect(retry).toMatchObject({ created: false, verificationPrepared: true });
    expect(retry.claim.id).toBe(first.claim.id);
    await expect(claims.verifyByTokenHash(first.verification.tokenHash, new Date("2026-12-24T11:00:00Z")))
      .rejects.toMatchObject({ code: "invalid" });
    const verified = await claims.verifyByTokenHash(second.verification.tokenHash, new Date("2026-12-24T11:00:00Z"));
    expect(verified.id).toBe(first.claim.id);
  });

  it("does not issue a token to another session using an already claimed email", async () => {
    const original = claimFixture(await newSessionId(), "ivan@example.com");
    await claims.prepareClaim(original.claim, original.verification);
    const intruder = claimFixture(await newSessionId(), "ivan@example.com");

    const result = await claims.prepareClaim(intruder.claim, intruder.verification);

    expect(result).toMatchObject({ created: false, verificationPrepared: false });
    expect(result.claim.id).toBe(original.claim.id);
    await expect(claims.verifyByTokenHash(intruder.verification.tokenHash, new Date("2026-12-24T11:00:00Z")))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("allows exactly one of two concurrent claims for the same email from different sessions", async () => {
    const a = claimFixture(await newSessionId(), "race@example.com");
    const b = claimFixture(await newSessionId(), "race@example.com");

    const results = await Promise.all([
      claims.prepareClaim(a.claim, a.verification),
      claims.prepareClaim(b.claim, b.verification)
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => result.verificationPrepared)).toHaveLength(1);
    expect(new Set(results.map((result) => result.claim.id)).size).toBe(1);
  });

  // Двух валидных токенов на один email не бывает: unique(campaignSlug, normalizedEmail) не даёт
  // создать вторую заявку, поэтому «гонка подтверждений» разных сессий недостижима. Тест проверяет то,
  // что её исключает: токен получает только одна сессия, ссылка второй недействительна.
  it("issues a token to only one of two sessions racing for the same email, so only one link can confirm", async () => {
    const a = claimFixture(await newSessionId(), "race@example.com");
    const b = claimFixture(await newSessionId(), "race@example.com");
    const prepared = await Promise.all([
      claims.prepareClaim(a.claim, a.verification),
      claims.prepareClaim(b.claim, b.verification)
    ]);
    expect(prepared.map((result) => result.verificationPrepared).sort()).toEqual([false, true]);
    const [winner, loser] = prepared[0].verificationPrepared ? [a, b] : [b, a];

    const now = new Date("2026-12-24T11:00:00Z");
    const outcomes = await Promise.allSettled([
      claims.verifyByTokenHash(winner.verification.tokenHash, now),
      claims.verifyByTokenHash(loser.verification.tokenHash, now)
    ]);

    expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: { id: winner.claim.id, status: "email_verified" } });
    expect(outcomes[1]).toMatchObject({ status: "rejected", reason: { code: "invalid" } });
  });

  it("verifying the same token concurrently succeeds for both callers and verifies once", async () => {
    for (let round = 0; round < 10; round += 1) {
      const fixture = claimFixture(await newSessionId(), `ivan${round}@example.com`);
      await claims.prepareClaim(fixture.claim, fixture.verification);

      const results = await Promise.all([
        claims.verifyByTokenHash(fixture.verification.tokenHash, new Date("2026-12-24T11:00:00Z")),
        claims.verifyByTokenHash(fixture.verification.tokenHash, new Date("2026-12-24T11:00:01Z"))
      ]);

      for (const result of results) expect(result.status).toBe("email_verified");
      expect(results[0].id).toBe(results[1].id);
      // Подтверждение происходит один раз: проигравший гонку не перезаписывает verifiedAt победителя.
      expect(results[1].verifiedAt).toEqual(results[0].verifiedAt);
      const again = await claims.verifyByTokenHash(fixture.verification.tokenHash, new Date("2026-12-24T12:00:00Z"));
      expect(again.verifiedAt).toEqual(results[0].verifiedAt);
    }
  });
});

describe("PostgreSQL-specific guarantees", () => {
  it("enforces unique (campaign, normalized email) and one claim per session at the database level", async () => {
    const prisma = getPrisma();
    const { sessions } = await backends[1].create();
    const s1 = await sessions.createSession(sessionRecord());
    const s2 = await sessions.createSession(sessionRecord());
    const base = claimFixture(s1.id, "unique@example.com").claim;
    await prisma.prizeClaim.create({ data: base });

    await expect(
      prisma.prizeClaim.create({ data: { ...claimFixture(s2.id, "unique@example.com").claim } })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.prizeClaim.create({ data: { ...claimFixture(s1.id, "other@example.com").claim } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("a verification that lost the race keeps the winner's result and does not reset exported", async () => {
    const { sessions, claims } = await backends[1].create();
    const prisma = getPrisma();
    const fixture = claimFixture((await sessions.createSession(sessionRecord())).id, "late@example.com");
    await claims.prepareClaim(fixture.claim, fixture.verification);
    const winnerAt = new Date("2026-12-24T11:00:00Z");

    // Другое соединение держит строку подтверждения, как транзакция победителя гонки.
    const databaseUrl = process.env.TEST_DATABASE_URL!;
    const winner = new pg.Client({ connectionString: databaseUrl });
    await winner.connect();
    // pg не понимает параметр schema из URL — направляем сырые запросы туда же, куда ходит Prisma.
    await winner.query(`SET search_path TO ${quoteIdentifier(databaseSchema(databaseUrl))}`);
    try {
      await winner.query("BEGIN");
      await winner.query('SELECT 1 FROM "EmailVerification" WHERE "claimId" = $1 FOR UPDATE', [fixture.claim.id]);

      // Проигравший уже прочитал usedAt = null и ждёт блокировку.
      const late = claims.verifyByTokenHash(fixture.verification.tokenHash, new Date("2026-12-24T11:05:00Z"));
      await waitForLockWaiter(winner);

      // Победитель подтверждает, и до коммита проигравшего оператор уже выгрузил заявку.
      await winner.query('UPDATE "EmailVerification" SET "usedAt" = $1::timestamp WHERE "claimId" = $2', [
        "2026-12-24 11:00:00",
        fixture.claim.id
      ]);
      await winner.query(
        `UPDATE "PrizeClaim" SET "status" = 'exported', "verifiedAt" = $1::timestamp WHERE "id" = $2`,
        ["2026-12-24 11:00:00", fixture.claim.id]
      );
      await winner.query("COMMIT");

      const result = await late;

      expect(result).toMatchObject({ status: "exported", verifiedAt: winnerAt });
      expect(await prisma.prizeClaim.findUniqueOrThrow({ where: { id: fixture.claim.id } }))
        .toMatchObject({ status: "exported", verifiedAt: winnerAt });
      expect((await prisma.emailVerification.findUniqueOrThrow({ where: { claimId: fixture.claim.id } })).usedAt)
        .toEqual(winnerAt);
    } finally {
      await winner.query("ROLLBACK").catch(() => undefined);
      await winner.end();
    }
  });

  it("rolls back the claim when its verification cannot be stored", async () => {
    const { sessions, claims } = await backends[1].create();
    const prisma = getPrisma();
    const s1 = await sessions.createSession(sessionRecord());
    const s2 = await sessions.createSession(sessionRecord());
    const first = claimFixture(s1.id, "one@example.com");
    await claims.prepareClaim(first.claim, first.verification);
    // Тот же tokenHash у другой заявки нарушает unique(tokenHash) на втором шаге транзакции.
    const second = claimFixture(s2.id, "two@example.com");
    second.verification.tokenHash = first.verification.tokenHash;

    await expect(claims.prepareClaim(second.claim, second.verification)).rejects.toThrow();

    expect(await prisma.prizeClaim.count()).toBe(1);
    expect(await prisma.emailVerification.count()).toBe(1);
  });
});
