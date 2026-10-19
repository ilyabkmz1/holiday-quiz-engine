import { DomainError } from "@/domain/errors";
import type { TaskPayload } from "@/domain/tasks";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type {
  GameSessionRecord,
  RoomEntryRecord,
  RushAnswerDecision,
  RushAnswerRecord,
  RushRunRecord,
  SessionRepository,
  TaskAnswerDraft,
  TaskAnswerRecord,
  TaskShownRecord
} from "@/server/repositories/session-repository";

type Tx = Prisma.TransactionClient;

function mapSession(session: {
  id: string;
  campaignSlug: string;
  accessKeyHash: string;
  status: "playing" | "completed";
  score: number | null;
  rewardTierTitle: string | null;
  startedAt: Date;
  completedAt: Date | null;
}): GameSessionRecord {
  return session;
}

function mapTaskAnswer(answer: {
  id: string;
  sessionId: string;
  taskId: string;
  seq: number;
  payload: unknown;
  basePoints: number;
  comboBonus: number;
  combo: number;
  answeredAt: Date;
}): TaskAnswerRecord {
  return { ...answer, payload: answer.payload as TaskPayload };
}

function mapRun(run: {
  sessionId: string;
  startedAt: Date;
  deadlineAt: Date;
  poolOrder: unknown;
  finishedAt: Date | null;
}): RushRunRecord {
  return { ...run, poolOrder: run.poolOrder as string[] };
}

/**
 * Сериализует записи одной сессии: ответы зависят друг от друга (комбо, порядок заданий, дедлайн),
 * поэтому параллельные запросы одной сессии ждут друг друга на блокировке строки. Разные сессии не мешают друг другу.
 */
async function lockSession(tx: Tx, sessionId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "GameSession" WHERE "id" = ${sessionId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    throw new DomainError("not_found", "Сессия не найдена.");
  }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(session: GameSessionRecord): Promise<GameSessionRecord> {
    const created = await this.prisma.gameSession.create({ data: session });
    return mapSession(created);
  }

  async getSession(sessionId: string): Promise<GameSessionRecord | null> {
    const session = await this.prisma.gameSession.findUnique({ where: { id: sessionId } });
    return session ? mapSession(session) : null;
  }

  async completeOnce(
    sessionId: string,
    result: { score: number; rewardTierTitle: string; completedAt: Date }
  ): Promise<GameSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.gameSession.updateMany({
        where: { id: sessionId, status: "playing" },
        data: { status: "completed", ...result }
      });
      const session = await tx.gameSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw new DomainError("not_found", "Сессия не найдена.");
      }
      return mapSession(session);
    });
  }

  async enterRoomOnce(sessionId: string, roomId: string, enteredAt: Date): Promise<RoomEntryRecord> {
    // INSERT ... ON CONFLICT DO NOTHING атомарен: сохраняется первая отметка, остальные её читают.
    await this.prisma.roomEntry.createMany({ data: [{ sessionId, roomId, enteredAt }], skipDuplicates: true });
    return this.prisma.roomEntry.findUniqueOrThrow({
      where: { sessionId_roomId: { sessionId, roomId } }
    });
  }

  async listRoomEntries(sessionId: string): Promise<RoomEntryRecord[]> {
    return this.prisma.roomEntry.findMany({ where: { sessionId } });
  }

  async markTaskShownOnce(sessionId: string, taskId: string, shownAt: Date): Promise<TaskShownRecord> {
    // Как и вход в комнату: INSERT ... ON CONFLICT DO NOTHING сохраняет первую отметку.
    await this.prisma.taskShown.createMany({ data: [{ sessionId, taskId, shownAt }], skipDuplicates: true });
    return this.prisma.taskShown.findUniqueOrThrow({ where: { sessionId_taskId: { sessionId, taskId } } });
  }

  async listTaskShown(sessionId: string): Promise<TaskShownRecord[]> {
    return this.prisma.taskShown.findMany({ where: { sessionId } });
  }

  async recordTaskAnswerOnce(
    sessionId: string,
    taskId: string,
    decide: (context: { answers: TaskAnswerRecord[]; entries: RoomEntryRecord[] }) => TaskAnswerDraft
  ): Promise<{ answer: TaskAnswerRecord; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const existing = await tx.taskAnswer.findUnique({
        where: { sessionId_taskId: { sessionId, taskId } }
      });
      if (existing) {
        return { answer: mapTaskAnswer(existing), created: false };
      }
      const answers = (
        await tx.taskAnswer.findMany({ where: { sessionId }, orderBy: { seq: "asc" } })
      ).map(mapTaskAnswer);
      const entries = await tx.roomEntry.findMany({ where: { sessionId } });
      const draft = decide({ answers, entries });
      const saved = await tx.taskAnswer.create({
        data: {
          id: draft.id,
          sessionId,
          taskId,
          seq: answers.length + 1,
          payload: draft.payload,
          basePoints: draft.basePoints,
          comboBonus: draft.comboBonus,
          combo: draft.combo,
          answeredAt: draft.answeredAt
        }
      });
      return { answer: mapTaskAnswer(saved), created: true };
    });
  }

  async listTaskAnswers(sessionId: string): Promise<TaskAnswerRecord[]> {
    const answers = await this.prisma.taskAnswer.findMany({ where: { sessionId }, orderBy: { seq: "asc" } });
    return answers.map(mapTaskAnswer);
  }

  async startRushOnce(run: RushRunRecord): Promise<RushRunRecord> {
    await this.prisma.rushRun.createMany({ data: [run], skipDuplicates: true });
    const saved = await this.prisma.rushRun.findUniqueOrThrow({ where: { sessionId: run.sessionId } });
    return mapRun(saved);
  }

  async getRushRun(sessionId: string): Promise<RushRunRecord | null> {
    const run = await this.prisma.rushRun.findUnique({ where: { sessionId } });
    return run ? mapRun(run) : null;
  }

  async listRushAnswers(sessionId: string): Promise<RushAnswerRecord[]> {
    return this.prisma.rushAnswer.findMany({ where: { sessionId }, orderBy: { answeredAt: "asc" } });
  }

  async recordRushAnswerOnce(
    sessionId: string,
    itemId: string,
    decide: (context: { run: RushRunRecord; answers: RushAnswerRecord[] }) => RushAnswerDecision
  ): Promise<{ answer: RushAnswerRecord; run: RushRunRecord; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const runRow = await tx.rushRun.findUnique({ where: { sessionId } });
      if (!runRow) {
        throw new DomainError("conflict", "Рывок ещё не начат.");
      }
      const run = mapRun(runRow);
      const existing = await tx.rushAnswer.findUnique({
        where: { sessionId_itemId: { sessionId, itemId } }
      });
      if (existing) {
        return { answer: existing, run, created: false };
      }
      const answers = await tx.rushAnswer.findMany({ where: { sessionId }, orderBy: { answeredAt: "asc" } });
      const decision = decide({ run, answers });
      const answer = await tx.rushAnswer.create({
        data: { sessionId, itemId, ...decision.answer }
      });
      const updated = await tx.rushRun.update({
        where: { sessionId },
        data: { deadlineAt: decision.deadlineAt }
      });
      return { answer, run: mapRun(updated), created: true };
    });
  }

  async finishRushOnce(sessionId: string, finishedAt: Date): Promise<RushRunRecord> {
    return this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      await tx.rushRun.updateMany({ where: { sessionId, finishedAt: null }, data: { finishedAt } });
      const run = await tx.rushRun.findUnique({ where: { sessionId } });
      if (!run) {
        throw new DomainError("conflict", "Рывок ещё не начат.");
      }
      return mapRun(run);
    });
  }
}
