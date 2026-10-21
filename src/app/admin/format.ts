import { REPORT_TIME_ZONE, type ClaimStatusKey } from "@/server/metrics";

export const CLAIM_STATUS_LABELS: Record<ClaimStatusKey, string> = {
  claim_pending: "Ждёт подтверждения",
  email_verified: "Email подтверждён",
  exported: "Выгружена",
  fulfilled: "Приз выдан"
};

const number = new Intl.NumberFormat("ru-RU");
export const formatCount = (value: number): string => number.format(value);

/** Доля в процентах; прочерк, пока нет данных. */
export function formatPercent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** Длительность «м:сс» или «ч:мм:сс»; прочерк, пока нет завершённых игр. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** «24.12.2026» из YYYY-MM-DD. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

export function formatDateTime(iso: string, timeZone: string = REPORT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}
