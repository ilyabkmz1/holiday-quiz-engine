import { dayIndexAt, dayLocalDate, dayUnlockAt, localInstant, type AdventSchedule } from "./calendar";

/**
 * Момент, с которого можно слать напоминание о дне n: не раньше открытия двери и не раньше `sendAtLocal`
 * на локальную дату этого дня. Если `sendAtLocal` раньше открытия, письмо уходит в момент открытия.
 */
export function reminderSendAt(day: number, schedule: AdventSchedule, sendAtLocal: string): Date {
  const unlock = dayUnlockAt(day, schedule).getTime();
  const wanted = localInstant(dayLocalDate(day, schedule), sendAtLocal, schedule.timezone).getTime();
  return new Date(Math.max(unlock, wanted));
}

export type ReminderWindow = {
  /** Номер текущего дня. */
  day: number;
  /** `early` — время рассылки ещё не наступило; `open` — можно слать; `late` — окно рассылки прошло. */
  state: "early" | "open" | "late";
};

/**
 * Окно рассылки о текущем дне: от `sendAt` до `sendAt + lateMs`. Опоздавшее письмо («дверь открыта» в десять вечера) только
 * раздражает, поэтому после окна день не напоминается. `null` — до открытия первого дня. Фазу (`running`) вызывающий проверяет сам.
 */
export function reminderWindowAt(now: Date, schedule: AdventSchedule, sendAtLocal: string, lateMs: number): ReminderWindow | null {
  const day = dayIndexAt(now, schedule);
  if (day === null) return null;
  const sendAt = reminderSendAt(day, schedule, sendAtLocal).getTime();
  const time = now.getTime();
  return { day, state: time < sendAt ? "early" : time < sendAt + lateMs ? "open" : "late" };
}

/** Подставляет `{имя}` из `vars`; неизвестные плейсхолдеры остаются как есть. Значения не экранируются: это делает шаблон письма. */
export function fillPlaceholders(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Плейсхолдеры, которые умеют тексты напоминаний пакета. */
export const REMINDER_PLACEHOLDERS = ["day", "teaser"] as const;

/** Неизвестные плейсхолдеры шаблона (для `quiz:check`). */
export function unknownPlaceholders(template: string, known: readonly string[] = REMINDER_PLACEHOLDERS): string[] {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  return [...new Set(names.filter((name) => !known.includes(name)))];
}
