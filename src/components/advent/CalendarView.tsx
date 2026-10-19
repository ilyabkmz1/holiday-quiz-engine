"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { AdventIcon, type IconName } from "@/components/advent/icons";
import { dayLabel, fill } from "@/components/advent/format";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventDoor, AdventPhase, DoorStatus } from "@/types/advent";

/** Форма двери — второй, не цветовой признак статуса. */
export const DOOR_SHAPE: Record<DoorStatus, string> = { locked: "rect", today: "arch", catchup: "notch", missed: "chamfer", opened: "stamp" };
const DOOR_ICON: Record<DoorStatus, IconName> = { locked: "lock", today: "star", catchup: "replay", missed: "cross", opened: "check" };

export function statusLabel(copy: AdventCopy, status: DoorStatus): string {
  return { locked: copy.doorLocked, today: copy.doorToday, catchup: copy.doorCatchup, missed: copy.doorMissed, opened: copy.doorOpened }[status];
}

type Props = {
  doors: AdventDoor[];
  copy: AdventCopy;
  timezone: string;
  phase: AdventPhase;
  /** Дверь, которую сейчас открываем (запрос в пути). */
  busy: number | null;
  onOpen: (n: number) => void;
  /** Подсказка для двери, которую нельзя открыть («откроется 24 декабря»): показывается и читается скринридером. */
  onHint: (text: string) => void;
};

/**
 * Сетка дверей. Каждая дверь — кнопка с форменным и значковым признаком статуса, не только цветом.
 * Клавиатура: Tab заходит в сетку одной остановкой, стрелки двигают фокус (вверх и вниз — на строку), Home и End — к краям,
 * Enter и пробел открывают дверь или объясняют, почему она закрыта.
 */
export function CalendarView({ doors, copy, timezone, phase, busy, onOpen, onHint }: Props) {
  const gridRef = useRef<HTMLUListElement>(null);
  const todayDoor = doors.find((door) => door.status === "today") ?? doors.find((door) => door.status === "catchup") ?? doors[0];
  const [active, setActive] = useState<number | null>(null);
  const tabStop = active ?? todayDoor?.n ?? 1;

  function focusDoor(n: number) {
    setActive(n);
    gridRef.current?.querySelector<HTMLElement>(`[data-door="${n}"]`)?.focus();
  }

  function columns(): number {
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-door]") ?? [])];
    if (buttons.length === 0) return 1;
    const top = buttons[0].getBoundingClientRect().top;
    const inFirstRow = buttons.filter((button) => Math.abs(button.getBoundingClientRect().top - top) < 2).length;
    return Math.max(1, inFirstRow);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = Number((event.target as HTMLElement).closest<HTMLElement>("[data-door]")?.dataset.door);
    if (!Number.isInteger(current)) return;
    const last = doors.length;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() };
    let next: number | null = null;
    if (event.key in step) next = Math.min(last, Math.max(1, current + step[event.key]));
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    if (next !== current) focusDoor(next);
  }

  function activate(door: AdventDoor) {
    if (door.status === "locked") {
      onHint(fill(copy.doorLockedHint, { date: dayLabel(door.unlocksAt, timezone) }));
    } else if (door.status === "missed") {
      onHint(copy.doorMissedHint);
    } else if (door.status !== "opened" && phase !== "running") {
      onHint(copy.doorFinaleHint);
    } else {
      onOpen(door.n);
    }
  }

  return (
    <ul className="adv-doors" ref={gridRef} aria-label={copy.calendarTitle} onKeyDown={onKeyDown}>
      {doors.map((door) => {
        const label = statusLabel(copy, door.status);
        const extra =
          door.status === "locked"
            ? fill(copy.doorLockedHint, { date: dayLabel(door.unlocksAt, timezone) })
            : door.status === "missed"
              ? copy.doorMissedHint
              : door.status === "opened"
                ? door.title
                : door.teaser;
        return (
          <li key={door.n} style={{ "--i": door.n } as CSSProperties}>
            <button
              type="button"
              className={`adv-door adv-door-${door.status}`}
              data-door={door.n}
              data-status={door.status}
              data-shape={DOOR_SHAPE[door.status]}
              data-done={door.completed ? "true" : undefined}
              tabIndex={door.n === tabStop ? 0 : -1}
              aria-label={`${fill(copy.doorAria, { n: door.n, status: label })}. ${extra}`}
              aria-busy={busy === door.n || undefined}
              aria-disabled={door.status === "locked" || door.status === "missed" || undefined}
              onFocus={() => setActive(door.n)}
              onClick={() => activate(door)}
            >
              <span className="adv-door-num" aria-hidden="true">{door.n}</span>
              <AdventIcon name={DOOR_ICON[door.status]} size={door.status === "today" ? 26 : 22} className="adv-door-icon" />
              <span className="adv-door-status" aria-hidden="true">{label}</span>
              {door.status === "opened" && door.blocksTotal > 0 && !door.completed && (
                <span className="adv-door-pips" aria-hidden="true">
                  {Array.from({ length: door.blocksTotal }, (_, index) => (
                    <i key={index} className={index < door.blocksDone ? "on" : ""} />
                  ))}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
