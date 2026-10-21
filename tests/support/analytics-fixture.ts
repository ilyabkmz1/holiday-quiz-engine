import type { AdventAnalytics, AnalyticsDay } from "@/types/advent-analytics";

/** Строка дня; «играли раньше» по умолчанию повторяют активных (тесты правил, где новички не важны). */
export function dayRow(day: number, patch: Partial<AnalyticsDay> = {}): AnalyticsDay {
  const row = { day, title: `День ${day}`, date: `2026-12-${String(19 + day).padStart(2, "0")}`, status: "closed" as const, onTime: 0, caughtUp: 0, opened: 0, active: 0, missed: 0, completed: 0, onTimeShare: null, ...patch };
  return { returning: row.active, returningOnTime: row.onTime, returningShare: row.onTimeShare, ...row };
}

/** Метрики с разумными значениями по умолчанию: тесты правил меняют только нужное. */
export function analyticsFixture(patch: Partial<AdventAnalytics> = {}): AdventAnalytics {
  const days = Array.from({ length: 6 }, (_, index) => {
    const share = 0.8 - index * 0.01;
    return dayRow(index + 1, { onTime: Math.round(share * 100), opened: Math.round(share * 100), active: 100, missed: 100 - Math.round(share * 100), onTimeShare: share });
  });
  return {
    generatedAt: "2026-12-26T09:00:00.000Z",
    timezone: "Europe/Moscow",
    phase: "running",
    today: 6,
    totalDays: 12,
    minGroup: 5,
    kpis: {
      participants: 120,
      players: 100,
      activeToday: 40,
      d1: { count: 30, base: 100, share: 0.3 },
      d7: { count: 10, base: 60, share: 10 / 60 },
      doorsAvg: 4.2,
      redeemed: 20,
      subscribers: 30
    },
    days,
    doors: { avg: 4.2, median: 4, zero: 20, buckets: [{ value: 1, count: 30 }, { value: 4, count: 70 }] },
    streaks: { avg: 3, median: 3, buckets: [{ value: 1, count: 30 }, { value: 4, count: 70 }] },
    goals: [],
    registration: [
      { key: "participants", label: "Все участники", count: 120, share: 1 },
      { key: "player", label: "Открыли дверь", count: 100, share: 100 / 120 },
      { key: "email", label: "Подтвердили email", count: 30, share: 0.25 }
    ],
    rewards: [],
    rewardsBySource: [],
    rewardsByKind: [],
    cohorts: { offsets: [1, 3, 7], rows: [] },
    reminders: null,
    teams: null,
    bestDays: [days[0]],
    weakDays: [days[5]],
    insights: [],
    ...patch
  };
}
