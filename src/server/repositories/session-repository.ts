import type { TaskPayload } from "@/domain/tasks";

export type SessionStatus = "playing" | "completed";

export type GameSessionRecord = {
  id: string;
  campaignSlug: string;
  accessKeyHash: string;
  status: SessionStatus;
  score: number | null;
  rewardTierTitle: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type TaskAnswerRecord = {
  id: string;
  sessionId: string;
  taskId: string;
  /** Порядковый номер ответа в сессии, с 1; задаёт порядок для комбо. */
  seq: number;
  payload: TaskPayload;
  basePoints: number;
  comboBonus: number;
  /** Длина серии заданий на 100 после этого ответа. */
  combo: number;
  answeredAt: Date;
};

export type TaskAnswerDraft = Omit<TaskAnswerRecord, "sessionId" | "taskId" | "seq">;

export type RoomEntryRecord = {
  sessionId: string;
  roomId: string;
  enteredAt: Date;
};

/** Первая выдача задания игроку: от неё считается время задания для бонуса скорости. */
export type TaskShownRecord = {
  sessionId: string;
  taskId: string;
  shownAt: Date;
};

export type RushRunRecord = {
  sessionId: string;
  startedAt: Date;
  /** Дедлайн с учётом штрафов за ошибки. */
  deadlineAt: Date;
  /** Порядок выдачи заявок пула; клиенту не отдаётся целиком. */
  poolOrder: string[];
  finishedAt: Date | null;
};

export type RushAnswerRecord = {
  sessionId: string;
  itemId: string;
  serviceId: string;
  correct: boolean;
  answeredAt: Date;
};

export type RushAnswerDecision = {
  answer: Omit<RushAnswerRecord, "sessionId" | "itemId">;
  /** Новый дедлайн прогона (сдвинутый, если ответ неверный). */
  deadlineAt: Date;
};

export interface SessionRepository {
  createSession(session: GameSessionRecord): Promise<GameSessionRecord>;
  getSession(sessionId: string): Promise<GameSessionRecord | null>;
  completeOnce(
    sessionId: string,
    result: { score: number; rewardTierTitle: string; completedAt: Date }
  ): Promise<GameSessionRecord>;

  /** Идемпотентно: при повторном входе остаётся первая отметка времени. */
  enterRoomOnce(sessionId: string, roomId: string, enteredAt: Date): Promise<RoomEntryRecord>;
  listRoomEntries(sessionId: string): Promise<RoomEntryRecord[]>;

  /** Идемпотентно: повторная выдача задания не сбрасывает отметку, остаётся первая. */
  markTaskShownOnce(sessionId: string, taskId: string, shownAt: Date): Promise<TaskShownRecord>;
  listTaskShown(sessionId: string): Promise<TaskShownRecord[]>;

  /**
   * Атомарно (внутри сессии) записывает ответ на задание один раз. Если ответ уже есть, он возвращается
   * без вызова `decide`. Иначе `decide` получает уже сохранённые ответы по порядку и входы в комнаты;
   * исключение из `decide` отменяет запись.
   */
  recordTaskAnswerOnce(
    sessionId: string,
    taskId: string,
    decide: (context: { answers: TaskAnswerRecord[]; entries: RoomEntryRecord[] }) => TaskAnswerDraft
  ): Promise<{ answer: TaskAnswerRecord; created: boolean }>;
  listTaskAnswers(sessionId: string): Promise<TaskAnswerRecord[]>;

  /** Идемпотентно: второй старт возвращает уже созданный прогон. */
  startRushOnce(run: RushRunRecord): Promise<RushRunRecord>;
  getRushRun(sessionId: string): Promise<RushRunRecord | null>;
  listRushAnswers(sessionId: string): Promise<RushAnswerRecord[]>;
  /**
   * Атомарно записывает ответ на элемент рывка один раз и сдвигает дедлайн, если `decide` так решил.
   * Повторный ответ на тот же элемент возвращает сохранённый без вызова `decide`.
   */
  recordRushAnswerOnce(
    sessionId: string,
    itemId: string,
    decide: (context: { run: RushRunRecord; answers: RushAnswerRecord[] }) => RushAnswerDecision
  ): Promise<{ answer: RushAnswerRecord; run: RushRunRecord; created: boolean }>;
  /** Идемпотентно: первая отметка завершения сохраняется. */
  finishRushOnce(sessionId: string, finishedAt: Date): Promise<RushRunRecord>;
}
