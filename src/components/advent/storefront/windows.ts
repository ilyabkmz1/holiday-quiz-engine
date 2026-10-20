import { DAY_DECOR_ICONS } from "@/config/facade";
import type { AdventCopy } from "@/config/advent-schema";
import type { IconName } from "@/components/advent/icons";
import { fill } from "@/components/advent/format";
import type { AdventGrantView, AdventState, DoorStatus } from "@/types/advent";

/**
 * Форма окна по статусу — второй, не цветовой признак (первый — значок, третий — подпись для скринридера):
 * открытое светится (`lit`), закрытое тёмное (`shut`), догоняемое с пунктирной рамкой (`dashed`),
 * пропущенное заиндевело (`frost`), сегодняшнее обвязано лентой (`ribbon`).
 */
export const WINDOW_SHAPE: Record<DoorStatus, string> = { locked: "shut", today: "ribbon", catchup: "dashed", missed: "frost", opened: "lit" };
/** Значок окна по статусу; у сегодняшнего значка нет: его признак — лента и подпись «Сегодня», звезда — знак финала. */
export const WINDOW_ICON: Record<DoorStatus, IconName | null> = { locked: "lock", today: null, catchup: "replay", missed: "cross", opened: "check" };

export function windowStatusLabel(copy: AdventCopy, status: DoorStatus): string {
  return { locked: copy.windowLocked, today: copy.windowToday, catchup: copy.windowCatchup, missed: copy.windowMissed, opened: copy.windowOpened }[status];
}

/**
 * Значок открытого окна: награда, полученная за этот день (подарок дня или удача), иначе значок-декор по номеру дня.
 * Награды закрытых дней сюда не попадают: берутся только выдачи, которые уже есть у участника.
 */
export function openedWindowIcon(n: number, grants: readonly AdventGrantView[]): IconName {
  const grant = grants.find((candidate) => candidate.day === n && (candidate.source === "day" || candidate.source === "luck"));
  if (grant) return grant.icon;
  return DAY_DECOR_ICONS[(n - 1) % DAY_DECOR_ICONS.length];
}

export type StoreAction = {
  kind: "open" | "continue" | "catchup" | "tomorrow";
  /** Окно, на которое ведёт кнопка; `null` у «До завтра». */
  n: number | null;
  label: string;
  /** Реплика хозяина над кнопкой: анонс окна из пакета (у «До завтра» — общий текст). */
  line: string;
};

/**
 * Одна большая кнопка нижней плашки: открыть сегодняшнее окно, продолжить начатое, догнать пропущенное или «До завтра».
 * Сегодняшнее окно важнее догоняемого: догоняемое предлагается, когда сегодня уже всё пройдено.
 */
export function storeAction(state: AdventState, copy: AdventCopy): StoreAction {
  const today = state.today === null ? undefined : state.doors.find((door) => door.n === state.today);
  if (today?.status === "today") return { kind: "open", n: today.n, label: fill(copy.storeOpen, { n: today.n }), line: today.teaser };
  if (today?.status === "opened" && !today.completed) return { kind: "continue", n: today.n, label: fill(copy.storeContinue, { n: today.n }), line: today.teaser };
  const catchup = state.doors.find((door) => door.status === "catchup");
  if (catchup) return { kind: "catchup", n: catchup.n, label: fill(copy.storeCatchup, { n: catchup.n }), line: catchup.teaser };
  return { kind: "tomorrow", n: null, label: copy.storeTomorrow, line: copy.storeHostLine };
}
