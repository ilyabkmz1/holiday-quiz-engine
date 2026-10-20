import type { AdventConfig } from "@/config/advent-schema";
import {
  adventPhase,
  doorStatus,
  endOfLocalDay,
  fillPlaceholders,
  reminderWindowAt,
  streakState,
  type OpenedDay,
  type StreakPolicy
} from "@/domain/advent";
import { DomainError } from "@/domain/errors";
import { createOpaqueToken, hashToken } from "@/server/crypto";
import type { ReminderMailVars } from "@/server/mail-reminder";
import type {
  AdventRepository,
  IdentityRepository,
  ParticipantRecord,
  ReminderDeliveryRecord,
  ReminderRepository
} from "@/server/repositories/advent-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReminderOptions = {
  /** Сколько кандидатов читаем из БД за раз. */
  batchSize: number;
  /** Не больше писем за один запуск (хвост уйдёт со следующим). */
  maxPerRun: number;
  /** Сколько раз пробуем отправить письмо, прежде чем оставить его в `failed`. */
  maxAttempts: number;
  /** Повтор неудачной доставки не раньше, чем через столько миллисекунд после последней попытки. */
  retryAfterMs: number;
  /** Ограничение скорости: писем в секунду (0 — без ограничения). */
  ratePerSecond: number;
  /** Сколько миллисекунд после времени рассылки письмо ещё уместно; позже день не напоминается. */
  maxLateMs: number;
};

export const DEFAULT_REMINDER_OPTIONS: ReminderOptions = {
  batchSize: 100,
  maxPerRun: 2000,
  maxAttempts: 3,
  // Запуск раз в 15 минут: повтор в следующий запуск, а не сразу в этот же.
  retryAfterMs: 10 * 60_000,
  ratePerSecond: 5,
  maxLateMs: 6 * 60 * 60_000
};

function readInt(raw: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d{1,9}$/.test(raw.trim())) throw new Error(`${name} должен быть целым числом`);
  const value = Number(raw.trim());
  if (value < min || value > max) throw new Error(`${name} должен быть от ${min} до ${max}`);
  return value;
}

/** Параметры рассылки из окружения: `REMINDER_BATCH_SIZE`, `REMINDER_MAX_PER_RUN`, `REMINDER_MAX_ATTEMPTS`, `REMINDER_RETRY_MINUTES`, `REMINDER_RATE_PER_SECOND`, `REMINDER_MAX_LATE_HOURS`. */
export function parseReminderOptions(env: Record<string, string | undefined>): ReminderOptions {
  return {
    batchSize: readInt(env.REMINDER_BATCH_SIZE, "REMINDER_BATCH_SIZE", DEFAULT_REMINDER_OPTIONS.batchSize, 1, 1000),
    maxPerRun: readInt(env.REMINDER_MAX_PER_RUN, "REMINDER_MAX_PER_RUN", DEFAULT_REMINDER_OPTIONS.maxPerRun, 1, 100_000),
    maxAttempts: readInt(env.REMINDER_MAX_ATTEMPTS, "REMINDER_MAX_ATTEMPTS", DEFAULT_REMINDER_OPTIONS.maxAttempts, 1, 10),
    retryAfterMs: readInt(env.REMINDER_RETRY_MINUTES, "REMINDER_RETRY_MINUTES", DEFAULT_REMINDER_OPTIONS.retryAfterMs / 60_000, 0, 1440) * 60_000,
    ratePerSecond: readInt(env.REMINDER_RATE_PER_SECOND, "REMINDER_RATE_PER_SECOND", DEFAULT_REMINDER_OPTIONS.ratePerSecond, 0, 1000),
    maxLateMs: readInt(env.REMINDER_MAX_LATE_HOURS, "REMINDER_MAX_LATE_HOURS", DEFAULT_REMINDER_OPTIONS.maxLateMs / 3_600_000, 1, 23) * 3_600_000
  };
}

/** Результат запуска для журнала: только счётчики, без адресов и ссылок. */
export type ReminderRunResult = {
  /** Почему письма не шли (`off`, `not_running`, `too_early`, `too_late`); у отработавшего запуска `null`. */
  skipped: "off" | "not_running" | "too_early" | "too_late" | null;
  day: number | null;
  /** Заявлено доставок (claim выигран). */
  claimed: number;
  sent: number;
  failed: number;
  /** Кандидатов, у которых заявку выиграл другой запуск или которые успели отписаться/открыть день. */
  lostClaims: number;
};

const emptyResult = (skipped: ReminderRunResult["skipped"], day: number | null): ReminderRunResult => ({ skipped, day, claimed: 0, sent: 0, failed: 0, lostClaims: 0 });

type ReminderRepositories = AdventRepository & IdentityRepository & ReminderRepository;

type ReminderServiceDependencies = {
  repository: ReminderRepositories;
  advent: AdventConfig;
  /** Публичный адрес сайта арендатора. */
  baseUrl: string;
  /** Отправляет письмо. Адрес и ссылки в логи не пишутся. */
  send: (to: string, vars: ReminderMailVars) => Promise<void>;
  options?: ReminderOptions;
  sleep?: (ms: number) => Promise<void>;
};

/** Код ошибки отправки без текста: сообщение SMTP-сервера может содержать адрес получателя. */
export function reminderErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const safe = code.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  return safe ? `smtp_${safe.toLowerCase()}` : "send_failed";
}

export class ReminderService {
  private readonly options: ReminderOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly dependencies: ReminderServiceDependencies) {
    this.options = dependencies.options ?? DEFAULT_REMINDER_OPTIONS;
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private get policy(): StreakPolicy {
    const { streak } = this.dependencies.advent;
    return { endowedDay: streak.endowedDay, freezes: streak.freezes, goals: streak.goals };
  }

  /**
   * Один запуск (cron раз в 15 минут). Письма идут участникам с подтверждённым email и включёнными напоминаниями, не открывшим
   * сегодняшний день, когда фаза `running`, день уже открыт и локальное время достигло `sendAtLocal` (но не позже `maxLateMs` после него).
   * Доставка заявляется в БД ДО отправки (`ReminderDelivery`, уникальный ключ участник+день): параллельные запуски не дублируют письма.
   * Если процесс упал между заявкой и отправкой, доставка остаётся в `sending` и не повторяется: лучше потерять письмо, чем прислать два.
   */
  async run(now: Date): Promise<ReminderRunResult> {
    const { repository, advent } = this.dependencies;
    if (advent.reminders.channel !== "email") return emptyResult("off", null);
    if (adventPhase(now, advent.schedule) !== "running") return emptyResult("not_running", null);
    const window = reminderWindowAt(now, advent.schedule, advent.reminders.sendAtLocal, this.options.maxLateMs);
    if (window === null || window.state === "early") return emptyResult("too_early", window?.day ?? null);
    if (window.state === "late") return emptyResult("too_late", window.day);
    const { day } = window;

    const result = emptyResult(null, day);
    const retryBefore = new Date(now.getTime() - this.options.retryAfterMs);
    const interval = this.options.ratePerSecond > 0 ? 1000 / this.options.ratePerSecond : 0;
    let handled = 0;
    while (handled < this.options.maxPerRun) {
      const candidates = await repository.listReminderCandidates({
        campaignSlug: advent.slug,
        day,
        limit: Math.min(this.options.batchSize, this.options.maxPerRun - handled),
        retryBefore,
        maxAttempts: this.options.maxAttempts
      });
      if (candidates.length === 0) break;
      let progressed = false;
      for (const participant of candidates) {
        handled += 1;
        const outcome = await this.deliver(participant, day, now, retryBefore);
        if (outcome === "lost") {
          result.lostClaims += 1;
          continue;
        }
        progressed = true;
        result.claimed += 1;
        if (outcome === "sent") result.sent += 1;
        else result.failed += 1;
        if (interval > 0) await this.sleep(interval);
      }
      // Все кандидаты пачки уже заняты другим запуском: чтобы не крутиться впустую, выходим.
      if (!progressed) break;
    }
    return result;
  }

  private async deliver(participant: ParticipantRecord, day: number, now: Date, retryBefore: Date): Promise<"sent" | "failed" | "lost"> {
    const { repository } = this.dependencies;
    if (!participant.normalizedEmail) return "lost";
    const unsubscribeToken = createOpaqueToken();
    const delivery = await repository.claimReminder({
      participantId: participant.id,
      day,
      now,
      retryBefore,
      maxAttempts: this.options.maxAttempts,
      unsubscribeHash: hashToken(unsubscribeToken)
    });
    if (!delivery) return "lost";
    try {
      const vars = await this.compose(participant, delivery, day, now, unsubscribeToken);
      await this.dependencies.send(participant.normalizedEmail, vars);
    } catch (error) {
      await repository.markReminderFailed(delivery.id, reminderErrorCode(error));
      return "failed";
    }
    await repository.markReminderSent(delivery.id, now);
    return "sent";
  }

  /** Письмо одному участнику: вариант «возвращение», упоминание догоняния, ссылки со входом и отпиской. */
  private async compose(participant: ParticipantRecord, delivery: ReminderDeliveryRecord, day: number, now: Date, unsubscribeToken: string): Promise<ReminderMailVars> {
    const { repository, advent, baseUrl } = this.dependencies;
    const content = advent.days.find((candidate) => candidate.n === day);
    if (!content || !participant.normalizedEmail) throw new Error("reminder_day_missing");

    const [opens, grants] = await Promise.all([repository.listDayOpens(participant.id), repository.listGrants(participant.id)]);
    const openedDays = new Set(opens.map((open) => open.day));
    const streak = streakState(opens.map((open): OpenedDay => ({ day: open.day, onTime: open.onTime })), day, this.policy);
    const comebackGranted = grants.some((grant) => grant.source === "comeback");
    const comeback = Boolean(advent.streak.comebackBonusRewardId) && streak.comebackEligible && !comebackGranted;
    const missed = day - 1;
    // Вчерашний день пропущен и его ещё можно открыть правилами догоняния (приз при этом может быть не положен — это дело окна).
    const canCatchUp = missed >= 1 && !openedDays.has(missed) && doorStatus(missed, day, openedDays, advent.schedule, "running") === "catchup";

    const { reminders } = advent;
    const placeholders = { day, teaser: content.teaser };
    const token = createOpaqueToken();
    await repository.createLoginToken({
      tokenHash: hashToken(token),
      participantId: participant.id,
      normalizedEmail: participant.normalizedEmail,
      // Согласие уже дано при подтверждении адреса; ссылка нового согласия не создаёт и подписку не включает.
      consentAt: participant.consentAt ?? now,
      marketingConsentAt: null,
      reminderOptIn: false,
      trusted: true,
      createdAt: now,
      // До конца местных суток, но не меньше двух часов: письмо, пришедшее поздно вечером, не должно умирать через минуты.
      expiresAt: new Date(Math.max(endOfLocalDay(now, advent.schedule.timezone).getTime(), now.getTime() + 2 * 60 * 60_000)),
      usedAt: null
    });

    const open = new URL("/api/advent/reminders/open", baseUrl);
    open.searchParams.set("r", delivery.id);
    open.searchParams.set("token", token);
    const page = new URL("/unsubscribe", baseUrl);
    page.searchParams.set("t", unsubscribeToken);
    const oneClick = new URL("/api/advent/unsubscribe/one-click", baseUrl);
    oneClick.searchParams.set("t", unsubscribeToken);

    const { colors, derived } = advent.brand;
    return {
      subject: fillPlaceholders(comeback ? reminders.comebackSubject : reminders.subject, placeholders),
      preheader: fillPlaceholders(comeback ? reminders.comebackPreheader : reminders.preheader, placeholders),
      brandName: advent.brand.name,
      colors: {
        bg: colors.bg,
        ink: colors.ink,
        accent: colors.accent,
        onAccent: derived.onAccent ?? "#ffffff",
        paper: derived.paper ?? "#ffffff",
        paperInk: derived.paperInk ?? "#1f2430"
      },
      dayNumber: day,
      dayTitle: content.title,
      teaser: content.teaser,
      ...(comeback ? { comebackText: fillPlaceholders(reminders.comebackText, placeholders) } : {}),
      ...(canCatchUp ? { catchUpText: fillPlaceholders(reminders.catchUpText, { ...placeholders, missed }) } : {}),
      buttonLabel: fillPlaceholders(reminders.button, placeholders),
      link: open.toString(),
      progress: { opened: Math.min(streak.progress, advent.schedule.days), total: advent.schedule.days },
      unsubscribeUrl: page.toString(),
      unsubscribeOneClickUrl: oneClick.toString(),
      operatorName: advent.legal.operatorName,
      ...(advent.legal.operatorDetails ? { operatorDetails: advent.legal.operatorDetails } : {})
    };
  }

  /**
   * Отписка по токену из письма (страница или RFC 8058). Идемпотентна: повтор и токен давно отправленного письма
   * действуют так же. Снимает только напоминания; согласие на обработку персональных данных остаётся.
   * Неизвестный токен — `not_found`.
   */
  async unsubscribe(token: string, now: Date): Promise<void> {
    const { repository, advent } = this.dependencies;
    const participant = await repository.findParticipantByUnsubscribeHash(hashToken(token));
    if (!participant || participant.campaignSlug !== advent.slug) throw new DomainError("not_found", "Ссылка отписки недействительна.");
    await repository.setReminderOptIn(participant.id, false, now);
  }

  /** Доставка письма этой кампании по идентификатору из ссылки или `null` (не uuid, чужая кампания, нет такой). */
  private async deliveryOf(deliveryId: string | null | undefined): Promise<{ delivery: ReminderDeliveryRecord; participant: ParticipantRecord } | null> {
    if (!deliveryId || !UUID.test(deliveryId)) return null;
    const { repository, advent } = this.dependencies;
    const delivery = await repository.getReminderDelivery(deliveryId);
    const participant = delivery ? await repository.getParticipant(delivery.participantId) : null;
    return delivery && participant && participant.campaignSlug === advent.slug ? { delivery, participant } : null;
  }

  /**
   * Переход по кнопке письма (GET). Если на устройстве уже есть cookie того же участника, переход засчитывается сразу и
   * вход не нужен (`direct`). Иначе клик не фиксируем: GET открывают и почтовые сканеры; он засчитывается, когда человек
   * нажал «Войти» (`confirmLogin`). `null` — доставка неизвестна.
   */
  async resolveOpen(deliveryId: string | null | undefined, current: ParticipantRecord | null, now: Date): Promise<{ day: number; direct: boolean } | null> {
    const found = await this.deliveryOf(deliveryId);
    if (!found) return null;
    if (current && current.id === found.participant.id) {
      await this.dependencies.repository.recordReminderClick(found.delivery.id, now);
      return { day: found.delivery.day, direct: true };
    }
    return { day: found.delivery.day, direct: false };
  }

  /** После успешного входа по ссылке письма: засчитывает переход и возвращает день. Чужая доставка (участник не тот) — `null`. */
  async confirmLogin(deliveryId: string | null | undefined, participantId: string, now: Date): Promise<number | null> {
    const found = await this.deliveryOf(deliveryId);
    if (!found || found.participant.id !== participantId) return null;
    await this.dependencies.repository.recordReminderClick(found.delivery.id, now);
    return found.delivery.day;
  }
}
