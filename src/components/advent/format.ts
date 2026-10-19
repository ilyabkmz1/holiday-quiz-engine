import type { AdventGrantView } from "@/types/advent";

const LOCALE = "ru-RU";

/** Подставляет `{имя}` из значений; неизвестные плейсхолдеры остаются как есть. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** «20 декабря» в часовом поясе кампании. */
export function dayLabel(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", timeZone }).format(new Date(iso));
}

/** «21 декабря, 14:30» в часовом поясе кампании. */
export function dateTimeLabel(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** Остаток до момента: дни, часы, минуты, секунды (не меньше нуля). */
export function countdownParts(targetMs: number, nowMs: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

/** Ссылка награды годится для `href`, только если это http или https (на случай пакета в обход схемы). */
export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Состояние выдачи: `redeemed` — погашена, `expired` — срок вышел, иначе `active`. */
export function grantCondition(grant: Pick<AdventGrantView, "status" | "expiresAt">, nowMs: number): "active" | "redeemed" | "expired" {
  if (grant.status === "redeemed") return "redeemed";
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= nowMs) return "expired";
  return "active";
}
