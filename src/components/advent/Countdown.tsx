"use client";

import { countdownParts, dayLabel, fill } from "@/components/advent/format";
import type { PublicAdvent } from "@/types/advent";

/** Отсчёт до открытия первой двери: дни, часы, минуты, секунды. Секунды видны только глазами, скринридер читает минуты. */
export function Countdown({ advent, targetIso, nowMs }: { advent: PublicAdvent; targetIso: string; nowMs: number }) {
  const { copy } = advent;
  const parts = countdownParts(Date.parse(targetIso), nowMs);
  const cells: Array<[number, string]> = [
    [parts.days, copy.countdownDays],
    [parts.hours, copy.countdownHours],
    [parts.minutes, copy.countdownMinutes],
    [parts.seconds, copy.countdownSeconds]
  ];
  return (
    <section className="adv-countdown" aria-label={copy.upcomingEyebrow}>
      <div className="adv-eyebrow">{copy.upcomingEyebrow}</div>
      <h2 className="adv-countdown-title">{fill(copy.upcomingTitle, { date: dayLabel(targetIso, advent.schedule.timezone) })}</h2>
      <p className="sr-only" role="timer">{`${parts.days} ${copy.countdownDays} ${parts.hours} ${copy.countdownHours} ${parts.minutes} ${copy.countdownMinutes}`}</p>
      <ol className="adv-countdown-cells" aria-hidden="true">
        {cells.map(([value, label]) => (
          <li key={label}>
            <b>{String(value).padStart(2, "0")}</b>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <p className="adv-muted">{copy.upcomingNote}</p>
    </section>
  );
}
