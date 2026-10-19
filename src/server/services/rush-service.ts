import type { CampaignConfig } from "@/config/schema";
import { DomainError } from "@/domain/errors";
import { initialDeadline, penalizedDeadline, rushAcceptsAnswers, shuffle } from "@/domain/rush";
import { SCORING } from "@/domain/scoring";
import { allRoomsCompleted, currentScore, rushState } from "@/server/game-state";
import type { SessionRepository } from "@/server/repositories/session-repository";
import { SessionService } from "@/server/services/session-service";
import type { RushAnswerResponse, RushFinishResponse, RushStartResponse } from "@/types/api";

/** Финальный «Рывок»: 30 секунд на поток заявок, дедлайн и штрафы считает только сервер. */
export class RushService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly sessions: SessionService,
    private readonly campaign: CampaignConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random
  ) {}

  /** Старт возможен после всех пяти комнат. Идемпотентен: повторный вызов возвращает идущий прогон. */
  async start(sessionId: string): Promise<RushStartResponse> {
    const session = await this.sessions.get(sessionId);
    const before = await this.sessions.loadState(sessionId);
    if (!before.run) {
      if (session.status !== "playing") {
        throw new DomainError("conflict", "Игра уже завершена.");
      }
      if (!allRoomsCompleted(this.campaign, before)) {
        throw new DomainError("conflict", "Рывок откроется после того, как вы запустите все комнаты.");
      }
      const startedAt = this.now();
      await this.repository.startRushOnce({
        sessionId,
        startedAt,
        deadlineAt: initialDeadline(startedAt),
        poolOrder: shuffle(this.campaign.rush.pool.map((item) => item.id), this.random),
        finishedAt: null
      });
    }
    return this.snapshot(sessionId);
  }

  /**
   * Ответ на текущую заявку рывка. На каждую заявку принимается один ответ: верный — +20,
   * неверный сдвигает дедлайн на 2 секунды и тоже закрывает заявку. После дедлайна сервера
   * (с допуском на сеть) ответы не принимаются.
   */
  async answer(sessionId: string, itemId: string, serviceId: string): Promise<RushAnswerResponse> {
    const item = this.campaign.rush.pool.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new DomainError("not_found", "Заявка рывка не найдена.");
    }
    if (!this.campaign.rush.services.some((service) => service.id === serviceId)) {
      throw new DomainError("invalid", "Выбран неизвестный сервис.");
    }
    await this.sessions.get(sessionId);

    const { answer } = await this.repository.recordRushAnswerOnce(sessionId, itemId, ({ run, answers }) => {
      const now = this.now();
      if (run.finishedAt) {
        throw new DomainError("expired", "Рывок уже завершён.");
      }
      if (!rushAcceptsAnswers(run, now)) {
        throw new DomainError("expired", "Время рывка вышло.");
      }
      const answered = new Set(answers.map((candidate) => candidate.itemId));
      const current = run.poolOrder.find((candidateId) => !answered.has(candidateId));
      if (current === undefined) {
        throw new DomainError("conflict", "Заявки рывка закончились.");
      }
      if (current !== itemId) {
        throw new DomainError("conflict", "Эта заявка сейчас не выдана.");
      }
      const correct = item.serviceId === serviceId;
      return {
        answer: { serviceId, correct, answeredAt: now },
        deadlineAt: correct ? run.deadlineAt : penalizedDeadline(run.deadlineAt)
      };
    });

    const snapshot = await this.snapshot(sessionId);
    return {
      correct: answer.correct,
      scoreDelta: answer.correct ? SCORING.rushHitPoints : 0,
      score: snapshot.score,
      rush: snapshot.rush
    };
  }

  /** Досрочное или по таймеру завершение. Идемпотентно: первая отметка сохраняется. */
  async finish(sessionId: string): Promise<RushFinishResponse> {
    await this.sessions.get(sessionId);
    const run = await this.repository.getRushRun(sessionId);
    if (!run) {
      throw new DomainError("conflict", "Рывок ещё не начат.");
    }
    if (!run.finishedAt) {
      // Отметка не позже дедлайна сервера: опоздание клиента не продлевает рывок.
      const finishedAt = new Date(Math.min(this.now().getTime(), run.deadlineAt.getTime()));
      await this.repository.finishRushOnce(sessionId, finishedAt);
    }
    return this.snapshot(sessionId);
  }

  private async snapshot(sessionId: string) {
    const state = await this.sessions.loadState(sessionId);
    return {
      rush: rushState(this.campaign, state.run!, state.rushAnswers, this.now()),
      score: currentScore(this.campaign, state)
    };
  }
}
