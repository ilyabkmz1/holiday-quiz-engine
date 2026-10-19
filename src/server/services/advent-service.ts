import type { AdventConfig, AdventDay, DayBlock } from "@/config/advent-schema";
import type { Task } from "@/config/schema";
import { adventPhase, dayIndexAt, dayRewardAvailable, dayUnlockAt, doorStatus, rewardExpiresAt, streakState, type OpenedDay, type StreakPolicy, type StreakState } from "@/domain/advent";
import { DomainError } from "@/domain/errors";
import { correctIds, scoreTask } from "@/domain/tasks";
import { createId, createOpaqueToken, hashToken } from "@/server/crypto";
import { maskEmail } from "@/server/mask";
import { publicTask } from "@/server/presentation";
import {
  CAMPAIGN_GRANT_DAY,
  type AdventRepository,
  type DayBlockResultRecord,
  type DayOpenRecord,
  type ParticipantRecord,
  type RewardGrantRecord
} from "@/server/repositories/advent-repository";
import type {
  AdventBlockState,
  AdventDayContent,
  AdventDoor,
  AdventGoal,
  AdventGrantView,
  AdventState,
  AdventTaskOutcome,
  SubmitBlockResponse
} from "@/types/advent";
import type { TaskOutcome, TaskPayloadBody } from "@/types/api";

/**
 * Id «награды» подаренного дня, если в пакете нет `streak.endowedRewardId`: запись нужна для учёта и идемпотентности,
 * в публичном списке наград её нет.
 */
export const ENDOWED_REWARD_ID = "endowed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertParticipantId(participantId: string): void {
  // Колонка id имеет тип uuid: произвольная строка роняет запрос в БД, а не даёт «не найдено».
  if (!UUID_PATTERN.test(participantId)) throw new DomainError("not_found", "Участник не найден.");
}

/** Блоки, без которых день не считается пройденным. Блоки удачи и подарка (A2) пока не учитываются. */
function isRequiredBlock(block: DayBlock): boolean {
  return block.type === "story" || block.type === "task";
}

/** Сохранённый результат блока в БД: форма зависит от типа блока. */
type StoredResult = { kind: "story" } | { kind: "task"; taskId: string; payload: TaskPayloadBody; base: number };

type Snapshot = {
  participant: ParticipantRecord;
  opens: DayOpenRecord[];
  results: DayBlockResultRecord[];
  grants: RewardGrantRecord[];
};

function outcomeOf(base: number): TaskOutcome {
  return base === 100 ? "perfect" : base === 50 ? "partial" : "miss";
}

export class AdventService {
  constructor(
    private readonly repository: AdventRepository,
    private readonly advent: AdventConfig
  ) {}

  private get policy(): StreakPolicy {
    return { endowedDay: this.advent.streak.endowedDay, freezes: this.advent.streak.freezes, goals: this.advent.streak.goals };
  }

  private requireDay(n: number): AdventDay {
    const day = Number.isInteger(n) ? this.advent.days.find((candidate) => candidate.n === n) : undefined;
    if (!day) throw new DomainError("not_found", "День не найден.");
    return day;
  }

  /** Анонимный участник и ключ cookie (в БД только хеш). Подаренный день выдаётся сразу. */
  async createParticipant(now: Date): Promise<{ participant: ParticipantRecord; accessKey: string }> {
    if (adventPhase(now, this.advent.schedule) === "closed") {
      throw new DomainError("conflict", "Адвент завершён.");
    }
    const accessKey = createOpaqueToken();
    const participant = await this.repository.createParticipant({
      id: createId(),
      campaignSlug: this.advent.slug,
      accessKeyHash: hashToken(accessKey),
      normalizedEmail: null,
      teamId: null,
      consentAt: null,
      marketingConsentAt: null,
      reminderOptIn: false,
      unsubscribeHash: null,
      createdAt: now
    });
    await this.reconcile(await this.snapshot(participant.id), now);
    return { participant, accessKey };
  }

  /** Участник по ключу из cookie или `null`: ключа нет, он неизвестен или принадлежит другой кампании. */
  async identify(accessKey: string | undefined): Promise<ParticipantRecord | null> {
    if (!accessKey) return null;
    const participant = await this.repository.findParticipantByAccessKeyHash(hashToken(accessKey));
    return participant && participant.campaignSlug === this.advent.slug ? participant : null;
  }

  private async snapshot(participantId: string): Promise<Snapshot> {
    assertParticipantId(participantId);
    const participant = await this.repository.getParticipant(participantId);
    // Участник другой кампании для этого сервиса не существует.
    if (!participant || participant.campaignSlug !== this.advent.slug) {
      throw new DomainError("not_found", "Участник не найден.");
    }
    const [opens, results, grants] = await Promise.all([
      this.repository.listDayOpens(participantId),
      this.repository.listBlockResults(participantId),
      this.repository.listGrants(participantId)
    ]);
    return { participant, opens, results, grants };
  }

  private streakOf(opens: readonly DayOpenRecord[], today: number | null): StreakState {
    return streakState(opens.map((open): OpenedDay => ({ day: open.day, onTime: open.onTime })), today, this.policy);
  }

  /** Состояние для клиента: двери, содержимое открытых дней, серия, цели и награды. Ничего не пишет. */
  async state(participantId: string, now: Date): Promise<AdventState> {
    return this.present(await this.snapshot(participantId), now);
  }

  /**
   * Открывает дверь дня n. Идемпотентно: повтор возвращает то же состояние, время и `onTime` первого открытия.
   * Дверь можно открыть, если день сегодняшний или догоняемый по правилам `catchUp`.
   */
  async openDay(participantId: string, n: number, now: Date): Promise<AdventState> {
    this.requireDay(n);
    const before = await this.snapshot(participantId);
    const phase = adventPhase(now, this.advent.schedule);
    const today = dayIndexAt(now, this.advent.schedule);
    const opened = new Set(before.opens.map((open) => open.day));
    const status = doorStatus(n, today, opened, this.advent.schedule, phase);
    if (status === "locked") throw new DomainError("conflict", "Этот день ещё не наступил.");
    if (status === "missed") throw new DomainError("conflict", "Этот день уже нельзя открыть.");
    if (status !== "opened") {
      await this.repository.openDayOnce(participantId, n, now, status === "today");
    }
    // Бонус за возвращение проверяется и при повторном открытии: так выдача переживает сбой между записью дня и наградой.
    await this.reconcile(await this.snapshot(participantId), now, { returning: true });
    return this.present(await this.snapshot(participantId), now);
  }

  /**
   * Ответ на блок дня. История подтверждается, задание считается на сервере и разбирается только после записи.
   * Повторная отправка (в том числе с другим ответом) возвращает сохранённый результат.
   * Блоки удачи и подарка появятся в A2.
   */
  async submitBlock(participantId: string, n: number, index: number, payload: unknown, now: Date): Promise<SubmitBlockResponse> {
    const day = this.requireDay(n);
    const block = Number.isInteger(index) ? day.blocks[index] : undefined;
    if (!block) throw new DomainError("not_found", "Блок не найден.");
    if (block.type === "luck" || block.type === "promo") {
      throw new DomainError("conflict", "reward_blocks_not_ready: блоки удачи и подарка дня появятся в следующем обновлении.");
    }
    const before = await this.snapshot(participantId);
    if (adventPhase(now, this.advent.schedule) === "closed") throw new DomainError("conflict", "Адвент завершён.");
    if (!before.opens.some((open) => open.day === n)) throw new DomainError("conflict", "Сначала откройте дверь дня.");

    const existing = before.results.find((result) => result.day === n && result.blockIndex === index);
    let stored = existing;
    if (!stored) {
      // Форма ответа проверяется до записи: неверное тело не оставляет следа.
      const draft: { result: StoredResult; points: number } =
        block.type === "story"
          ? { result: { kind: "story" }, points: 0 }
          : (() => {
              const scored = scoreTask(block.task, payload);
              return { result: { kind: "task", taskId: block.task.id, payload: scored.payload, base: scored.base }, points: scored.base };
            })();
      stored = (
        await this.repository.recordBlockResultOnce({ participantId, day: n, blockIndex: index, result: draft.result, points: draft.points, createdAt: now })
      ).result;
    }

    await this.reconcile(await this.snapshot(participantId), now);
    const state = await this.present(await this.snapshot(participantId), now);
    const outcome = block.type === "task" ? this.taskOutcome(block.task, stored.result as StoredResult) : null;
    return { block: { index, type: block.type, outcome }, state };
  }

  private taskOutcome(task: Task, stored: StoredResult): AdventTaskOutcome | null {
    if (stored.kind !== "task") return null;
    const outcome = outcomeOf(stored.base);
    return {
      taskId: task.id,
      type: task.type,
      payload: stored.payload,
      base: stored.base,
      outcome,
      correctIds: correctIds(task),
      explanation: task.explanation,
      tip: task.tip,
      mood: outcome === "perfect" ? "happy" : outcome === "partial" ? "neutral" : "sad",
      line: outcome === "perfect" ? task.thanks : task.oops
    };
  }

  private isDayComplete(day: AdventDay, results: readonly DayBlockResultRecord[]): boolean {
    return day.blocks.every((block, index) => !isRequiredBlock(block) || results.some((result) => result.day === day.n && result.blockIndex === index));
  }

  /**
   * Выдаёт заработанные награды (без кодов: код из пула появится в A2). Каждая выдача идемпотентна по
   * (участник, источник, день), поэтому повторный вызов ничего не дублирует и безопасно вызывается после любой записи.
   * - подаренный день: ключ день 0, награда `streak.endowedRewardId` или псевдо-id `endowed`;
   * - цели серии: ключ — число открытых дверей цели;
   * - бонус за возвращение (только при открытии двери, `returning`): один раз за кампанию (день 0), когда серия
   *   реально прервана; право считается так, будто сегодняшняя дверь ещё не открыта, чтобы выдача пережила
   *   сбой между открытием и выдачей;
   * - награда дня: когда день пройден и награда положена (открыт вовремя или `rewardOnlyOnDay` выключен).
   * После `claimEndsAt` награды не выдаются.
   */
  private async reconcile(snapshot: Snapshot, now: Date, options: { returning?: boolean } = {}): Promise<void> {
    const { participant, opens, results } = snapshot;
    const { schedule, streak: streakConfig } = this.advent;
    const phase = adventPhase(now, schedule);
    const today = dayIndexAt(now, schedule);
    const rewards = new Map(this.advent.rewards.map((reward) => [reward.id, reward]));

    const grant = async (source: RewardGrantRecord["source"], day: number, rewardId: string) => {
      const reward = rewards.get(rewardId);
      await this.repository.grantOnce({
        id: createId(),
        participantId: participant.id,
        day,
        source,
        rewardId,
        code: null,
        expiresAt: reward ? rewardExpiresAt(now, reward) : null,
        status: "issued",
        redeemedAt: null,
        createdAt: now
      });
    };

    if (phase === "closed") return;
    if (streakConfig.endowedDay) await grant("endowed", CAMPAIGN_GRANT_DAY, streakConfig.endowedRewardId ?? ENDOWED_REWARD_ID);

    for (const goal of this.streakOf(opens, today).goalsReached) await grant("goal", goal.opened, goal.rewardId);

    if (options.returning && streakConfig.comebackBonusRewardId) {
      const withoutToday = today === null ? opens : opens.filter((open) => open.day !== today);
      if (this.streakOf(withoutToday, today).comebackEligible) {
        await grant("comeback", CAMPAIGN_GRANT_DAY, streakConfig.comebackBonusRewardId);
      }
    }

    for (const open of opens) {
      const day = this.advent.days.find((candidate) => candidate.n === open.day);
      if (!day?.rewardId || !this.isDayComplete(day, results)) continue;
      if (open.onTime || !schedule.rewardOnlyOnDay) await grant("day", day.n, day.rewardId);
    }
  }

  private present(snapshot: Snapshot, now: Date): AdventState {
    const { participant, opens, results, grants } = snapshot;
    const { schedule } = this.advent;
    const phase = adventPhase(now, schedule);
    const today = dayIndexAt(now, schedule);
    const openedDays = new Set(opens.map((open) => open.day));
    const streak = this.streakOf(opens, today);
    const rewards = new Map(this.advent.rewards.map((reward) => [reward.id, reward]));

    const doors: AdventDoor[] = this.advent.days.map((day) => {
      const required = day.blocks.map((block, index) => ({ block, index })).filter(({ block }) => isRequiredBlock(block));
      const done = required.filter(({ index }) => results.some((result) => result.day === day.n && result.blockIndex === index)).length;
      return {
        n: day.n,
        title: day.title,
        teaser: day.teaser,
        heroId: day.heroId ?? null,
        unlocksAt: dayUnlockAtIso(day.n, schedule),
        status: doorStatus(day.n, today, openedDays, schedule, phase),
        completed: openedDays.has(day.n) && this.isDayComplete(day, results),
        blocksDone: done,
        blocksTotal: required.length,
        rewardAvailable: dayRewardAvailable(day.n, today, openedDays, schedule, phase)
      };
    });

    const days: AdventDayContent[] = this.advent.days
      .filter((day) => openedDays.has(day.n))
      .map((day) => ({
        n: day.n,
        chapter: day.chapter.lines,
        heroId: day.heroId ?? null,
        rewardId: day.rewardId ?? null,
        blocks: day.blocks.map((block, index): AdventBlockState => {
          const stored = results.find((result) => result.day === day.n && result.blockIndex === index);
          switch (block.type) {
            case "story":
              return { index, type: "story", lines: block.lines, done: stored !== undefined };
            case "task":
              return {
                index,
                type: "task",
                // Перемешивание по зерну «участник + задание»: порядок в конфигурации не выдаёт ответ.
                task: publicTask(`day-${day.n}`, block.task, participant.id),
                done: stored !== undefined,
                outcome: stored ? this.taskOutcome(block.task, stored.result as StoredResult) : null
              };
            case "luck":
              return { index, type: "luck", choices: block.choices, done: false, ready: false };
            case "promo":
              return { index, type: "promo", rewardId: block.rewardId, done: false, ready: false };
          }
        })
      }));

    const grantedGoals = new Set(grants.filter((grant) => grant.source === "goal").map((grant) => grant.day));
    const goals: AdventGoal[] = [...this.advent.streak.goals]
      .sort((a, b) => a.opened - b.opened)
      .map((goal) => ({
        opened: goal.opened,
        rewardId: goal.rewardId,
        label: rewards.get(goal.rewardId)?.label ?? goal.rewardId,
        reached: goal.opened <= streak.progress,
        granted: grantedGoals.has(goal.opened)
      }));

    const grantViews: AdventGrantView[] = grants
      .filter((grant) => rewards.has(grant.rewardId))
      .map((grant) => {
        const reward = rewards.get(grant.rewardId)!;
        return {
          source: grant.source,
          day: grant.day,
          rewardId: grant.rewardId,
          label: reward.label,
          description: reward.description,
          status: grant.status,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          // Коды из пулов выдаёт A2; до этого награды без кода.
          code: null,
          grantedAt: grant.createdAt.toISOString()
        };
      });

    return {
      serverTime: now.toISOString(),
      phase,
      today,
      totalDays: schedule.days,
      participant: {
        id: participant.id,
        email: participant.normalizedEmail ? maskEmail(participant.normalizedEmail) : null,
        consent: participant.consentAt !== null,
        marketingConsent: participant.marketingConsentAt !== null,
        reminderOptIn: participant.reminderOptIn
      },
      doors,
      days,
      streak: {
        current: streak.current,
        best: streak.best,
        freezes: this.advent.streak.freezes,
        freezesLeft: streak.freezesLeft,
        progress: streak.progress,
        endowed: this.advent.streak.endowedDay,
        comebackEligible: streak.comebackEligible && !grants.some((grant) => grant.source === "comeback"),
        comebackGranted: grants.some((grant) => grant.source === "comeback")
      },
      goals,
      nextGoal: streak.nextGoal
        ? { opened: streak.nextGoal.opened, rewardId: streak.nextGoal.rewardId, label: rewards.get(streak.nextGoal.rewardId)?.label ?? streak.nextGoal.rewardId }
        : null,
      grants: grantViews
    };
  }
}

function dayUnlockAtIso(n: number, schedule: AdventConfig["schedule"]): string {
  return dayUnlockAt(n, schedule).toISOString();
}
