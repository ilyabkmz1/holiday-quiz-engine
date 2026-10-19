/** Как далеко назад можно открыть пропущенный день. */
export type CatchUp = "none" | "all" | { window: number };

/** Расписание адвента; структурно совпадает с `schedule` из `advent-schema.ts`, но домен от конфигурации не зависит. */
export type AdventSchedule = {
  /** Часовой пояс IANA, например `Europe/Moscow`. */
  timezone: string;
  /** Локальная дата первого дня, `YYYY-MM-DD`. */
  startDate: string;
  days: number;
  /** Час (0–23) локального времени, в который открывается очередной день. */
  unlockHour: number;
  finaleAt: string;
  claimEndsAt: string;
  catchUp: CatchUp;
  rewardOnlyOnDay: boolean;
};

export type AdventPhase = "upcoming" | "running" | "finale" | "closed";

type ScheduleTime = Pick<AdventSchedule, "timezone" | "startDate" | "unlockHour">;

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** Смещение часового пояса от UTC в миллисекундах на момент `instant` (секундная точность). */
function offsetAt(instant: number, timezone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * Момент, когда настенные часы в `timezone` показывают `wall` (дату и время, записанные как UTC).
 * Перебираем смещения за сутки до и после: подходит то, при котором часы действительно показывают `wall`.
 * В «лишний» час при переводе часов берётся первое вхождение, в несуществующий час — момент сразу после перевода.
 */
function wallToInstant(wall: number, timezone: string): number {
  const offsets = new Set([offsetAt(wall - DAY_MS, timezone), offsetAt(wall + DAY_MS, timezone)]);
  const valid = [...offsets].map((offset) => wall - offset).filter((instant) => offsetAt(instant, timezone) === wall - instant);
  if (valid.length > 0) return Math.min(...valid);
  return wall - offsetAt(wall - DAY_MS, timezone);
}

function parseStartDate(startDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) throw new Error(`Дата начала должна быть в формате YYYY-MM-DD: ${startDate}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Календарная дата (YYYY-MM-DD) для дня n: `startDate` + n − 1 суток, без часовых поясов. */
export function dayLocalDate(n: number, schedule: Pick<AdventSchedule, "startDate">): string {
  const { year, month, day } = parseStartDate(schedule.startDate);
  return new Date(Date.UTC(year, month - 1, day + n - 1)).toISOString().slice(0, 10);
}

/** Момент открытия дня n: локальная дата `startDate + n − 1` в `unlockHour:00` по `timezone`. */
export function dayUnlockAt(n: number, schedule: ScheduleTime): Date {
  const { year, month, day } = parseStartDate(schedule.startDate);
  const wall = Date.UTC(year, month - 1, day + n - 1, schedule.unlockHour, 0, 0);
  return new Date(wallToInstant(wall, schedule.timezone));
}

/**
 * Номер текущего дня: самый поздний уже открытый. До открытия первого дня — `null`,
 * после открытия последнего остаётся `schedule.days` (дальше решает `adventPhase`).
 */
export function dayIndexAt(now: Date, schedule: AdventSchedule): number | null {
  const timestamp = now.getTime();
  let current: number | null = null;
  for (let n = 1; n <= schedule.days; n += 1) {
    if (dayUnlockAt(n, schedule).getTime() > timestamp) break;
    current = n;
  }
  return current;
}

/**
 * Фаза адвента: `upcoming` до открытия первого дня; `running` до `finaleAt` (не включая);
 * `finale` до `claimEndsAt` (не включая) — главная награда и итоги, новые двери уже не открываются;
 * `closed` с `claimEndsAt`.
 */
export function adventPhase(now: Date, schedule: AdventSchedule): AdventPhase {
  const timestamp = now.getTime();
  if (timestamp < dayUnlockAt(1, schedule).getTime()) return "upcoming";
  if (timestamp < new Date(schedule.finaleAt).getTime()) return "running";
  if (timestamp < new Date(schedule.claimEndsAt).getTime()) return "finale";
  return "closed";
}
