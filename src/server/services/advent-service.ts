import { rewardIconFor, type AdventConfig, type AdventDay, type DayBlock } from "@/config/advent-schema";
import type { Task } from "@/config/schema";
import { adventPhase, dayIndexAt, dayRewardAvailable, dayUnlockAt, doorStatus, streakState, type OpenedDay, type StreakPolicy, type StreakState } from "@/domain/advent";
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
  type ReminderRepository,
  type RewardGrantRecord
} from "@/server/repositories/advent-repository";
import { isVerified, rewardNeedsIdentity, RewardService } from "@/server/services/reward-service";
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

/** Блоки награды: открываются после остальных блоков дня, а анонимному участнику могут ответить `identity_required`. */
function isRewardBlock(block: DayBlock): block is Extract<DayBlock, { type: "luck" | "promo" }> {
  return block.type === "luck" || block.type === "promo";
}

/**
 * Сохранённый результат блока в БД: форма зависит от типа блока. Для удачи `choice` — только косметика (какую коробку
 * выбрал игрок), исход определяет сервер; `rewardId` — разыгранный приз.
 */
type StoredResult =
  | { kind: "story" }
  | { kind: "task"; taskId: string; payload: TaskPayloadBody; base: number }
  | { kind: "luck"; choice: number; rewardId: string }
  /** `rewardId` пуст, если награда не положена (день догнан при `rewardOnlyOnDay`). */
  | { kind: "promo"; rewardId: string | null };

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
  private readonly rewards: RewardService;

  constructor(
    private readonly repository: AdventRepository & ReminderRepository,
    private readonly advent: AdventConfig,
    rewards?: RewardService
  ) {
    this.rewards = rewards ?? new RewardService(repository, advent);
  }

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
      unsubscribedAt: null,
      createdAt: now
    });
    await this.reconcile(await this.snapshot(participant.id), now);
    return { participant, accessKey };
  }

  /**
   * Переключатель «Напоминания на почту» (`POST reminders`). Только для участника с подтверждённым адресом и согласием на
   * обработку данных: анонимному напоминать некуда. Напоминания — рассылка (ст. 18 38-ФЗ): включение только с явным
   * согласием на неё (`marketingConsent`) и записывает его, выключение отзывает. Идемпотентно; согласие на обработку
   * данных не затрагивает.
   */
  async setReminders(participantId: string, input: { enabled: boolean; marketingConsent: boolean }, now: Date): Promise<AdventState> {
    const { enabled } = input;
    if (enabled && !input.marketingConsent) throw new DomainError("invalid", "Напоминания включаются только с согласием на рассылку.");
    const { participant } = await this.snapshot(participantId);
    if (this.advent.reminders.channel !== "email") throw new DomainError("conflict", "Напоминания в этой кампании не рассылаются.");
    if (participant.normalizedEmail === null || participant.consentAt === null) {
      throw new DomainError("conflict", "Сначала сохраните прогресс по email: напоминания приходят на подтверждённый адрес.");
    }
    await this.repository.setReminderOptIn(participantId, enabled, now);
    return this.state(participantId, now);
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

  /**
   * Состояние для клиента: двери, содержимое открытых дней, серия, цели и награды. Единственная запись — дозаполнение
   * кодов подтверждённому участнику (после входа по ссылке или пополнения пула кодов), идемпотентная.
   */
  async state(participantId: string, now: Date): Promise<AdventState> {
    const snapshot = await this.snapshot(participantId);
    return this.present(await this.activatePending(snapshot, now), now);
  }

  /**
   * Дозаполняет коды у выдач подтверждённого участника (`RewardService.ensureCodes`). Вызывается после входа по ссылке
   * (`IdentityService`, связывается в `container.ts`): награды, выданные до входа без кода, получают код и срок.
   * Идемпотентно.
   */
  async ensureCodes(participantId: string, now: Date): Promise<void> {
    await this.activatePending(await this.snapshot(participantId), now, true);
  }

  private async activatePending(snapshot: Snapshot, now: Date, notify = false): Promise<Snapshot> {
    if (!isVerified(snapshot.participant) || adventPhase(now, this.advent.schedule) === "closed") return snapshot;
    if (!snapshot.grants.some((grant) => this.rewards.needsActivation(grant))) return snapshot;
    await this.rewards.ensureCodes(snapshot.participant, snapshot.grants, now, notify);
    return { ...snapshot, grants: await this.repository.listGrants(snapshot.participant.id) };
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
   *
   * Блоки награды (`luck`, `promo`) открываются после остальных блоков дня. Анонимному участнику награда с кодом, остатком
   * или погашением на кассе не выдаётся: ответ `identity_required`, блок не отмечен, ничего не разыграно и не списано;
   * после входа по ссылке блок проходится как обычно. Исход удачи возвращается только после фиксации выдачи.
   */
  async submitBlock(participantId: string, n: number, index: number, payload: unknown, now: Date): Promise<SubmitBlockResponse> {
    const day = this.requireDay(n);
    const block = Number.isInteger(index) ? day.blocks[index] : undefined;
    if (!block) throw new DomainError("not_found", "Блок не найден.");
    const before = await this.snapshot(participantId);
    if (adventPhase(now, this.advent.schedule) === "closed") throw new DomainError("conflict", "Адвент завершён.");
    const open = before.opens.find((candidate) => candidate.day === n);
    if (!open) throw new DomainError("conflict", "Сначала откройте дверь дня.");

    const existing = before.results.find((result) => result.day === n && result.blockIndex === index);
    if (isRewardBlock(block)) {
      return this.submitRewardBlock(before, day, block, index, existing, payload, open, now);
    }

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
    return { status: "ok", block: { index, type: block.type, outcome, reward: null }, state };
  }

  private async submitRewardBlock(
    before: Snapshot,
    day: AdventDay,
    block: Extract<DayBlock, { type: "luck" | "promo" }>,
    index: number,
    existing: DayBlockResultRecord | undefined,
    payload: unknown,
    open: DayOpenRecord,
    now: Date
  ): Promise<SubmitBlockResponse> {
    const { participant } = before;
    const n = day.n;
    const respond = async (): Promise<SubmitBlockResponse> => {
      const after = await this.snapshot(participant.id);
      const state = this.present(await this.activatePending(after, now), now);
      const reward = state.days.find((content) => content.n === n)?.blocks[index];
      const reveal = reward && (reward.type === "luck" || reward.type === "promo") ? reward.reveal : null;
      return { status: "ok", block: { index, type: block.type, outcome: null, reward: reveal }, state };
    };
    if (existing) return respond();

    const reward = block.type === "promo" ? this.rewards.reward(block.rewardId) : undefined;
    const needsIdentity = block.type === "luck" || rewardNeedsIdentity(reward);
    if (!this.blocksBeforeDone(day, index, before.results)) {
      throw new DomainError("conflict", "Сначала выполните остальные блоки дня.");
    }
    if (needsIdentity && !isVerified(participant)) {
      return { status: "identity_required", block: { index, type: block.type, outcome: null, reward: null }, state: this.present(before, now) };
    }

    if (block.type === "luck") {
      const choice = (payload as { choice?: unknown } | null)?.choice;
      if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= block.choices) {
        throw new DomainError("invalid", "Выберите один из вариантов.");
      }
      // Сначала выдача (идемпотентна по ключу «участник, удача, день»), потом отметка блока: сбой между ними чинится повтором.
      const grant = await this.rewards.playLuck(participant, n, block.pool, now);
      await this.repository.recordBlockResultOnce({
        participantId: participant.id,
        day: n,
        blockIndex: index,
        result: { kind: "luck", choice, rewardId: grant.rewardId } satisfies StoredResult,
        points: 0,
        createdAt: now
      });
    } else {
      // Подарок дня догнанного дня не положен при rewardOnlyOnDay: блок пройден, награды нет.
      const entitled = open.onTime || !this.advent.schedule.rewardOnlyOnDay;
      if (entitled) await this.rewards.issue(participant, "day", n, block.rewardId, now);
      await this.repository.recordBlockResultOnce({
        participantId: participant.id,
        day: n,
        blockIndex: index,
        result: { kind: "promo", rewardId: entitled ? block.rewardId : null } satisfies StoredResult,
        points: 0,
        createdAt: now
      });
    }
    await this.reconcile(await this.snapshot(participant.id), now);
    return respond();
  }

  /** Все блоки дня, кроме блоков награды, выполнены (иначе награду можно получить, не пройдя день). */
  private blocksBeforeDone(day: AdventDay, index: number, results: readonly DayBlockResultRecord[]): boolean {
    return day.blocks.every((block, position) => position === index || isRewardBlock(block) || results.some((result) => result.day === day.n && result.blockIndex === position));
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
    return day.blocks.every((_block, index) => results.some((result) => result.day === day.n && result.blockIndex === index));
  }

  /**
   * Выдаёт заработанные награды. Каждая выдача идемпотентна по (участник, источник, день), поэтому повторный вызов
   * ничего не дублирует и безопасно вызывается после любой записи. Код назначает `RewardService`: общий, из пула или
   * сгенерированный, в одной транзакции с выдачей; анонимному участнику награда с кодом записывается без кода и получает
   * его при входе по ссылке (`ensureCodes`).
   * - подаренный день: ключ день 0, награда `streak.endowedRewardId` или псевдо-id `endowed`;
   * - цели серии: ключ — число открытых дверей цели;
   * - бонус за возвращение (только при открытии двери, `returning`): один раз за кампанию (день 0), когда серия
   *   реально прервана; право считается так, будто сегодняшняя дверь ещё не открыта, чтобы выдача пережила
   *   сбой между открытием и выдачей;
   * - награда дня: когда день пройден (все блоки, включая удачу и подарок) и награда положена (открыт вовремя или
   *   `rewardOnlyOnDay` выключен); блок подарка дня выдаёт ту же запись раньше (ключ тот же).
   * После `claimEndsAt` награды не выдаются.
   */
  private async reconcile(snapshot: Snapshot, now: Date, options: { returning?: boolean } = {}): Promise<void> {
    const { participant, opens, results } = snapshot;
    const { schedule, streak: streakConfig } = this.advent;
    const phase = adventPhase(now, schedule);
    const today = dayIndexAt(now, schedule);

    const grant = (source: RewardGrantRecord["source"], day: number, rewardId: string) => this.rewards.issue(participant, source, day, rewardId, now);

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
    // Вошедший участник: дозаполнить код у выдач, оставшихся без него (анонимно выданных ранее, пустой пул).
    await this.activatePending({ ...snapshot, grants: await this.repository.listGrants(participant.id) }, now);
  }

  private present(snapshot: Snapshot, now: Date): AdventState {
    const { participant, opens, results, grants } = snapshot;
    const { schedule } = this.advent;
    const phase = adventPhase(now, schedule);
    const today = dayIndexAt(now, schedule);
    const openedDays = new Set(opens.map((open) => open.day));
    const streak = this.streakOf(opens, today);
    const rewards = new Map(this.advent.rewards.map((reward) => [reward.id, reward]));

    // Награды пакета видны владельцу целиком (с кодом и QR); псевдо-награда подаренного дня в список не входит.
    const grantView = (grant: RewardGrantRecord): AdventGrantView => {
      const reward = rewards.get(grant.rewardId)!;
      const verified = isVerified(participant);
      const gated = rewardNeedsIdentity(reward) && !verified;
      return {
        id: grant.id,
        source: grant.source,
        day: grant.day,
        rewardId: grant.rewardId,
        kind: reward.kind,
        label: reward.label,
        description: reward.description,
        icon: rewardIconFor(reward),
        status: grant.status,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        code: gated ? null : grant.code,
        grantedAt: grant.createdAt.toISOString(),
        redeemedAt: grant.redeemedAt?.toISOString() ?? null,
        redeem: reward.redeem,
        url: reward.url ?? null,
        needsIdentity: gated,
        codePending: !gated && reward.codes !== undefined && grant.code === null,
        qr: gated ? null : this.rewards.qr(grant)
      };
    };
    const doors: AdventDoor[] = this.advent.days.map((day) => {
      const done = day.blocks.filter((_block, index) => results.some((result) => result.day === day.n && result.blockIndex === index)).length;
      return {
        n: day.n,
        title: day.title,
        teaser: day.teaser,
        heroId: day.heroId ?? null,
        unlocksAt: dayUnlockAtIso(day.n, schedule),
        status: doorStatus(day.n, today, openedDays, schedule, phase),
        completed: openedDays.has(day.n) && this.isDayComplete(day, results),
        blocksDone: done,
        blocksTotal: day.blocks.length,
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
                cover: block.cover ?? null,
                done: stored !== undefined,
                outcome: stored ? this.taskOutcome(block.task, stored.result as StoredResult) : null
              };
            case "luck": {
              const grant = grants.find((candidate) => candidate.source === "luck" && candidate.day === day.n);
              return {
                index,
                type: "luck",
                choices: block.choices,
                done: stored !== undefined,
                ready: this.blocksBeforeDone(day, index, results),
                needsIdentity: !isVerified(participant),
                // Исход виден только после фиксации блока.
                reveal: stored !== undefined && grant ? grantView(grant) : null
              };
            }
            case "promo": {
              const grant = grants.find((candidate) => candidate.source === "day" && candidate.day === day.n && candidate.rewardId === block.rewardId);
              return {
                index,
                type: "promo",
                rewardId: block.rewardId,
                done: stored !== undefined,
                ready: this.blocksBeforeDone(day, index, results),
                needsIdentity: rewardNeedsIdentity(this.rewards.reward(block.rewardId)) && !isVerified(participant),
                reveal: stored !== undefined && grant ? grantView(grant) : null
              };
            }
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

    const grantViews: AdventGrantView[] = grants.filter((grant) => rewards.has(grant.rewardId)).map(grantView);

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
        reminderOptIn: participant.reminderOptIn,
        // Переключатель напоминаний доступен после подтверждения адреса, если кампания рассылает письма.
        canRemind: this.advent.reminders.channel === "email" && participant.normalizedEmail !== null && participant.consentAt !== null
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
