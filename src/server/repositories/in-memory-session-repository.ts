import { DomainError } from "@/domain/errors";
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

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, GameSessionRecord>();
  private readonly taskAnswers = new Map<string, TaskAnswerRecord>();
  private readonly entries = new Map<string, RoomEntryRecord>();
  private readonly shown = new Map<string, TaskShownRecord>();
  private readonly rushRuns = new Map<string, RushRunRecord>();
  private readonly rushAnswers = new Map<string, RushAnswerRecord>();

  async createSession(session: GameSessionRecord): Promise<GameSessionRecord> {
    this.sessions.set(session.id, structuredClone(session));
    return structuredClone(session);
  }

  async getSession(sessionId: string): Promise<GameSessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : null;
  }

  async completeOnce(
    sessionId: string,
    result: { score: number; rewardTierTitle: string; completedAt: Date }
  ): Promise<GameSessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DomainError("not_found", "Сессия не найдена.");
    }
    if (session.status === "completed") {
      return structuredClone(session);
    }
    const completed: GameSessionRecord = {
      ...session,
      status: "completed",
      score: result.score,
      rewardTierTitle: result.rewardTierTitle,
      completedAt: result.completedAt
    };
    this.sessions.set(sessionId, completed);
    return structuredClone(completed);
  }

  async enterRoomOnce(sessionId: string, roomId: string, enteredAt: Date): Promise<RoomEntryRecord> {
    const key = `${sessionId}:${roomId}`;
    const existing = this.entries.get(key);
    if (existing) {
      return structuredClone(existing);
    }
    const entry = { sessionId, roomId, enteredAt };
    this.entries.set(key, structuredClone(entry));
    return structuredClone(entry);
  }

  async listRoomEntries(sessionId: string): Promise<RoomEntryRecord[]> {
    return this.entriesOf(sessionId);
  }

  async markTaskShownOnce(sessionId: string, taskId: string, shownAt: Date): Promise<TaskShownRecord> {
    const key = `${sessionId}:${taskId}`;
    const existing = this.shown.get(key);
    if (existing) {
      return structuredClone(existing);
    }
    const record = { sessionId, taskId, shownAt };
    this.shown.set(key, structuredClone(record));
    return structuredClone(record);
  }

  async listTaskShown(sessionId: string): Promise<TaskShownRecord[]> {
    return [...this.shown.values()]
      .filter((record) => record.sessionId === sessionId)
      .map((record) => structuredClone(record));
  }

  private entriesOf(sessionId: string): RoomEntryRecord[] {
    return [...this.entries.values()]
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => structuredClone(entry));
  }

  async recordTaskAnswerOnce(
    sessionId: string,
    taskId: string,
    decide: (context: { answers: TaskAnswerRecord[]; entries: RoomEntryRecord[] }) => TaskAnswerDraft
  ): Promise<{ answer: TaskAnswerRecord; created: boolean }> {
    const existing = this.taskAnswers.get(`${sessionId}:${taskId}`);
    if (existing) {
      return { answer: structuredClone(existing), created: false };
    }
    // Между проверкой и записью нет await, поэтому конкурентные вызовы в процессе не перемежаются.
    const answers = this.taskAnswersOf(sessionId);
    const entries = this.entriesOf(sessionId);
    const draft = decide({ answers, entries });
    const answer: TaskAnswerRecord = {
      ...structuredClone(draft),
      taskId,
      sessionId,
      seq: answers.length + 1
    };
    this.taskAnswers.set(`${sessionId}:${taskId}`, structuredClone(answer));
    return { answer, created: true };
  }

  async listTaskAnswers(sessionId: string): Promise<TaskAnswerRecord[]> {
    return this.taskAnswersOf(sessionId);
  }

  private taskAnswersOf(sessionId: string): TaskAnswerRecord[] {
    return [...this.taskAnswers.values()]
      .filter((answer) => answer.sessionId === sessionId)
      .sort((left, right) => left.seq - right.seq)
      .map((answer) => structuredClone(answer));
  }

  async startRushOnce(run: RushRunRecord): Promise<RushRunRecord> {
    const existing = this.rushRuns.get(run.sessionId);
    if (existing) {
      return structuredClone(existing);
    }
    this.rushRuns.set(run.sessionId, structuredClone(run));
    return structuredClone(run);
  }

  async getRushRun(sessionId: string): Promise<RushRunRecord | null> {
    const run = this.rushRuns.get(sessionId);
    return run ? structuredClone(run) : null;
  }

  async listRushAnswers(sessionId: string): Promise<RushAnswerRecord[]> {
    return this.rushAnswersOf(sessionId);
  }

  private rushAnswersOf(sessionId: string): RushAnswerRecord[] {
    return [...this.rushAnswers.values()]
      .filter((answer) => answer.sessionId === sessionId)
      .sort((left, right) => left.answeredAt.getTime() - right.answeredAt.getTime())
      .map((answer) => structuredClone(answer));
  }

  async recordRushAnswerOnce(
    sessionId: string,
    itemId: string,
    decide: (context: { run: RushRunRecord; answers: RushAnswerRecord[] }) => RushAnswerDecision
  ): Promise<{ answer: RushAnswerRecord; run: RushRunRecord; created: boolean }> {
    const run = this.rushRuns.get(sessionId);
    if (!run) {
      throw new DomainError("conflict", "Рывок ещё не начат.");
    }
    const existing = this.rushAnswers.get(`${sessionId}:${itemId}`);
    if (existing) {
      return { answer: structuredClone(existing), run: structuredClone(run), created: false };
    }
    const decision = decide({ run: structuredClone(run), answers: this.rushAnswersOf(sessionId) });
    const answer: RushAnswerRecord = { ...structuredClone(decision.answer), sessionId, itemId };
    const updated: RushRunRecord = { ...run, deadlineAt: new Date(decision.deadlineAt) };
    this.rushAnswers.set(`${sessionId}:${itemId}`, structuredClone(answer));
    this.rushRuns.set(sessionId, updated);
    return { answer, run: structuredClone(updated), created: true };
  }

  async finishRushOnce(sessionId: string, finishedAt: Date): Promise<RushRunRecord> {
    const run = this.rushRuns.get(sessionId);
    if (!run) {
      throw new DomainError("conflict", "Рывок ещё не начат.");
    }
    if (run.finishedAt) {
      return structuredClone(run);
    }
    const finished = { ...run, finishedAt: new Date(finishedAt) };
    this.rushRuns.set(sessionId, finished);
    return structuredClone(finished);
  }
}
