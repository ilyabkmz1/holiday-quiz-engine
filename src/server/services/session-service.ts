import type { CampaignConfig, Room } from "@/config/schema";
import { DomainError } from "@/domain/errors";
import { RUSH } from "@/domain/rush";
import { comboBonus, resolveReward } from "@/domain/scoring";
import { scoreTask } from "@/domain/tasks";
import { createId, createOpaqueToken, hashToken } from "@/server/crypto";
import {
  allRoomsCompleted,
  comboFor,
  currentCombo,
  currentScore,
  finalResult,
  revealOf,
  roomOfTask,
  roomProgress,
  rushState,
  type RawState
} from "@/server/game-state";
import { publicTask } from "@/server/presentation";
import type { GameSessionRecord, SessionRepository } from "@/server/repositories/session-repository";
import type {
  AnswerResponse,
  CompleteResponse,
  EnterRoomResponse,
  RoomTaskResponse,
  SessionProgress
} from "@/types/api";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertSessionId(sessionId: string): void {
  // Колонка id имеет тип uuid: произвольная строка роняет запрос в БД, а не даёт «не найдено».
  if (!UUID_PATTERN.test(sessionId)) {
    throw new DomainError("not_found", "Сессия не найдена.");
  }
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly campaign: CampaignConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(): Promise<{ session: GameSessionRecord; accessKey: string }> {
    const accessKey = createOpaqueToken();
    const session = await this.repository.createSession({
      id: createId(),
      campaignSlug: this.campaign.slug,
      accessKeyHash: hashToken(accessKey),
      status: "playing",
      score: null,
      rewardTierTitle: null,
      startedAt: this.now(),
      completedAt: null
    });
    return { session, accessKey };
  }

  async get(sessionId: string): Promise<GameSessionRecord> {
    assertSessionId(sessionId);
    const session = await this.repository.getSession(sessionId);
    // Сессия чужого арендатора для этого сервиса не существует: у каждого пакета своя кампания.
    if (!session || session.campaignSlug !== this.campaign.slug) {
      throw new DomainError("not_found", "Сессия не найдена.");
    }
    return session;
  }

  /** Снимок записанного хода игры. */
  async loadState(sessionId: string): Promise<RawState> {
    const [answers, entries, shown, run, rushAnswers] = await Promise.all([
      this.repository.listTaskAnswers(sessionId),
      this.repository.listRoomEntries(sessionId),
      this.repository.listTaskShown(sessionId),
      this.repository.getRushRun(sessionId),
      this.repository.listRushAnswers(sessionId)
    ]);
    return { answers, entries, shown, run, rushAnswers };
  }

  /** Прогресс для восстановления игры; правильные ответы неотвеченных заданий в него не попадают. */
  async progress(sessionId: string): Promise<SessionProgress> {
    const session = await this.get(sessionId);
    const state = await this.loadState(sessionId);
    return this.presentProgress(session, state);
  }

  presentProgress(session: GameSessionRecord, state: RawState): SessionProgress {
    const rooms = this.campaign.rooms.map((room) => roomProgress(this.campaign, state, room));
    const completedRooms = rooms.filter((room) => room.completed).length;
    const level = session.score === null ? null : resolveReward(session.score, this.campaign.rewardTiers);
    return {
      id: session.id,
      status: session.status,
      score: session.score ?? currentScore(this.campaign, state),
      combo: currentCombo(state),
      rooms,
      roomsCompleted: completedRooms,
      rushUnlocked: completedRooms === this.campaign.rooms.length,
      rush: state.run ? rushState(this.campaign, state.run, state.rushAnswers, this.now()) : null,
      answers: state.answers.map((answer) => {
        const reveal = revealOf(this.campaign, state, answer);
        if (!reveal) {
          // Задание убрали из конфигурации: прогресс не восстановить, клиент на 404 забывает сессию.
          throw new DomainError("not_found", "Сессия не найдена.");
        }
        return reveal;
      }),
      completedAt: session.completedAt?.toISOString() ?? null,
      final: level ? finalResult(this.campaign, state, level) : null
    };
  }

  private requireRoom(roomId: string): Room {
    const room = this.campaign.rooms.find((candidate) => candidate.id === roomId);
    if (!room) {
      throw new DomainError("not_found", "Комната не найдена.");
    }
    return room;
  }

  /** Вход в комнату. Идемпотентен: время входа фиксируется при первом входе. */
  async enterRoom(sessionId: string, roomId: string): Promise<EnterRoomResponse> {
    const room = this.requireRoom(roomId);
    await this.get(sessionId);
    await this.repository.enterRoomOnce(sessionId, room.id, this.now());
    const state = await this.loadState(sessionId);
    return { room: roomProgress(this.campaign, state, room) };
  }

  /**
   * Текущее задание комнаты в публичном виде. С `answeredTaskId` возвращает уже отвеченное задание
   * (чтобы после перезагрузки показать его разбор): отметку выдачи это не пишет, а для неотвеченного
   * задания даёт конфликт, чтобы запрос не раскрывал будущие задания.
   */
  async roomTask(sessionId: string, roomId: string, answeredTaskId?: string): Promise<RoomTaskResponse> {
    const room = this.requireRoom(roomId);
    await this.get(sessionId);
    let state = await this.loadState(sessionId);
    let progress = roomProgress(this.campaign, state, room);
    if (!progress.entered) {
      throw new DomainError("conflict", "Сначала войдите в комнату.");
    }
    if (answeredTaskId !== undefined) {
      const index = room.tasks.findIndex((candidate) => candidate.id === answeredTaskId);
      if (index < 0) {
        throw new DomainError("not_found", "Задание не найдено.");
      }
      if (!state.answers.some((answer) => answer.taskId === answeredTaskId)) {
        throw new DomainError("conflict", "На это задание ещё не отвечено.");
      }
      return { room: progress, task: publicTask(room.id, room.tasks[index], sessionId), taskNumber: index + 1 };
    }
    const task = room.tasks.find((candidate) => candidate.id === progress.currentTaskId);
    if (task) {
      // Первая выдача задания запускает отсчёт его времени; повторные запросы отметку не сдвигают.
      // Если ответ успел появиться между чтением состояния и записью, отметка не нужна (и игнорируется при расчёте).
      await this.repository.markTaskShownOnce(sessionId, task.id, this.now());
      state = await this.loadState(sessionId);
      progress = roomProgress(this.campaign, state, room);
    }
    return {
      room: progress,
      task: task ? publicTask(room.id, task, sessionId) : null,
      taskNumber: Math.min(progress.answered + 1, room.tasks.length)
    };
  }

  /**
   * Ответ на задание. Принимается один раз: повторная отправка (в том числе с другим телом) возвращает
   * сохранённый разбор. Задания комнаты отвечаются по порядку, комната должна быть открыта входом.
   */
  async answerTask(sessionId: string, taskId: string, payload: unknown): Promise<AnswerResponse> {
    const room = roomOfTask(this.campaign, taskId);
    const task = room?.tasks.find((candidate) => candidate.id === taskId);
    if (!room || !task) {
      throw new DomainError("not_found", "Задание не найдено.");
    }
    const session = await this.get(sessionId);

    const { answer } = await this.repository.recordTaskAnswerOnce(sessionId, taskId, (context) => {
      if (session.status !== "playing") {
        throw new DomainError("conflict", "Игра уже завершена.");
      }
      if (!context.entries.some((entry) => entry.roomId === room.id)) {
        throw new DomainError("conflict", "Сначала войдите в комнату.");
      }
      const answeredInRoom = context.answers.filter((candidate) =>
        room.tasks.some((roomTask) => roomTask.id === candidate.taskId)
      ).length;
      if (room.tasks[answeredInRoom]?.id !== taskId) {
        throw new DomainError("conflict", "Сначала ответьте на предыдущие заявки комнаты.");
      }
      const scored = scoreTask(task, payload);
      const combo = comboFor(context, scored.base);
      return {
        id: createId(),
        payload: scored.payload,
        basePoints: scored.base,
        comboBonus: comboBonus(combo),
        combo,
        answeredAt: this.now()
      };
    });

    const state = await this.loadState(sessionId);
    const progress = roomProgress(this.campaign, state, room);
    const reveal = revealOf(this.campaign, state, answer)!;
    const lastOfRoom = taskId === room.tasks.at(-1)!.id;
    return {
      reveal,
      score: currentScore(this.campaign, state),
      room: progress,
      roomResult: progress.completed && lastOfRoom ? progress.summary : null,
      nextTaskId: progress.currentTaskId
    };
  }

  /**
   * Финализация: нужны все 15 заданий и завершённый рывок (или истёкший по дедлайну сервера).
   * Идемпотентна: повторный вызов возвращает сохранённый итог.
   */
  async complete(sessionId: string): Promise<CompleteResponse> {
    const session = await this.get(sessionId);
    if (session.status === "completed") {
      return this.presentCompleted(session, await this.loadState(sessionId));
    }

    let state = await this.loadState(sessionId);
    if (!allRoomsCompleted(this.campaign, state)) {
      throw new DomainError(
        "conflict",
        `Для завершения нужно пройти все комнаты (${this.campaign.rooms.length}).`
      );
    }
    if (!state.run) {
      throw new DomainError("conflict", "Перед финалом нужно пройти рывок.");
    }
    if (!state.run.finishedAt) {
      const now = this.now();
      const exhausted = state.rushAnswers.length >= state.run.poolOrder.length;
      const expired = now.getTime() > state.run.deadlineAt.getTime() + RUSH.graceMs;
      if (!exhausted && !expired) {
        throw new DomainError("conflict", "Рывок ещё идёт.");
      }
      const finishedAt = new Date(Math.min(now.getTime(), state.run.deadlineAt.getTime()));
      await this.repository.finishRushOnce(sessionId, finishedAt);
      // Состояние перечитывается после закрытия рывка: ответы после этого уже не принимаются.
      state = await this.loadState(sessionId);
    }

    const score = currentScore(this.campaign, state);
    const level = resolveReward(score, this.campaign.rewardTiers);
    const completed = await this.repository.completeOnce(sessionId, {
      score,
      rewardTierTitle: level.title,
      completedAt: this.now()
    });
    return this.presentCompleted(completed, state);
  }

  private presentCompleted(session: GameSessionRecord, state: RawState): CompleteResponse {
    const level = resolveReward(session.score!, this.campaign.rewardTiers);
    return {
      score: session.score!,
      rewardTierTitle: session.rewardTierTitle!,
      final: finalResult(this.campaign, state, level)
    };
  }
}

