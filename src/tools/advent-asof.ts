import type { AdventSchedule } from "@/config/advent-schema";

/** Смещение часового пояса в момент `date` в виде `+03:00`. */
function offsetOf(timeZone: string, date: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((item) => item.type === "timeZoneName")!.value;
  return part === "GMT" ? "+00:00" : part.replace("GMT", "");
}

/**
 * Момент `hour`:00 по времени кампании в день n (день 1 — `startDate`) в виде ISO со смещением — значение для `?asOf=`.
 * Так скриншоты, E2E и демо показывают клиенту «день 7 сегодня» без правки часов сервера.
 */
export function asOfForDay(schedule: Pick<AdventSchedule, "startDate" | "timezone">, n: number, hour = 12): string {
  const start = new Date(`${schedule.startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + n - 1);
  const date = start.toISOString().slice(0, 10);
  return `${date}T${String(hour).padStart(2, "0")}:00:00${offsetOf(schedule.timezone, new Date(`${date}T12:00:00Z`))}`;
}
