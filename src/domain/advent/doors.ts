import type { AdventPhase, AdventSchedule } from "./calendar";

/** `locked` — день не наступил; `today` — сегодняшний; `catchup` — прошедший, ещё можно открыть; `missed` — прошедший, уже нельзя; `opened` — открыт. */
export type DoorStatus = "locked" | "today" | "catchup" | "missed" | "opened";

type DoorRules = Pick<AdventSchedule, "catchUp" | "rewardOnlyOnDay">;

function has(openedDays: ReadonlySet<number> | readonly number[], n: number): boolean {
  return Array.isArray(openedDays) ? openedDays.includes(n) : (openedDays as ReadonlySet<number>).has(n);
}

/**
 * Состояние двери n.
 *
 * - `today` — номер текущего дня из `dayIndexAt` (`null` до старта);
 * - `phase` — фаза из `adventPhase`; вне `running` новые двери не открываются: неоткрытые прошедшие дни — `missed`,
 *   до старта — `locked`. По умолчанию `running`.
 *
 * Правила догоняния (`catchUp`): `none` — только сегодняшний день; `{ window: k }` — дни не раньше `today − k`;
 * `all` — любой прошедший день, пока фаза `running`.
 */
export function doorStatus(
  n: number,
  today: number | null,
  openedDays: ReadonlySet<number> | readonly number[],
  schedule: DoorRules,
  phase: AdventPhase = "running"
): DoorStatus {
  if (has(openedDays, n)) return "opened";
  if (phase === "upcoming" || today === null || n > today) return "locked";
  if (phase !== "running") return "missed";
  if (n === today) return "today";
  const { catchUp } = schedule;
  if (catchUp === "all") return "catchup";
  if (catchUp !== "none" && today - n <= catchUp.window) return "catchup";
  return "missed";
}

/**
 * Можно ли выдать награду дня n при открытии сейчас: в сегодняшний день — да, в догоняемый — только если
 * `rewardOnlyOnDay` выключен. Уже открытый, закрытый или будущий день награду не выдаёт (открытый получил её раньше).
 */
export function dayRewardAvailable(
  n: number,
  today: number | null,
  openedDays: ReadonlySet<number> | readonly number[],
  schedule: DoorRules,
  phase: AdventPhase = "running"
): boolean {
  const status = doorStatus(n, today, openedDays, schedule, phase);
  if (status === "today") return true;
  return status === "catchup" && !schedule.rewardOnlyOnDay;
}
