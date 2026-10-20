"use client";

import { CountUp } from "@/components/game/CountUp";
import { AdventIcon } from "@/components/advent/icons";
import { fill } from "@/components/advent/format";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventState } from "@/types/advent";

type Props = { state: AdventState; copy: AdventCopy };

/**
 * «k из N», шкала к ближайшей цели, заморозки и лучшая серия. Шкала — число открытых дверей плюс подаренный день
 * (`streak.progress`), по нему же сервер считает цели.
 */
export function StreakHud({ state, copy }: Props) {
  const { streak, goals, nextGoal, totalDays } = state;
  const opened = state.doors.filter((door) => door.status === "opened").length;
  const scaleEnd = Math.max(totalDays, ...goals.map((goal) => goal.opened));
  const percent = Math.min(100, Math.round((streak.progress / scaleEnd) * 100));
  const left = nextGoal ? nextGoal.opened - streak.progress : 0;
  return (
    <section className="adv-streak" aria-label={copy.streakCurrent}>
      <div className="adv-streak-top">
        <div className="adv-streak-count">
          <span className="sr-only">{fill(copy.streakOpened, { k: opened, n: totalDays })}</span>
          <span aria-hidden="true">
            <b className="adv-streak-k"><CountUp value={opened} duration={900} /></b>
            <span className="adv-streak-of"> / {totalDays}</span>
          </span>
        </div>
        <ul className="adv-streak-chips">
          <li className="adv-chip" title={copy.streakCurrent}>
            <AdventIcon name="flame" size={16} />
            <span className="sr-only">{copy.streakCurrent}: </span>
            <b>{streak.current}</b>
          </li>
          <li className="adv-chip" title={copy.streakBest}>
            <AdventIcon name="trophy" size={16} />
            <span className="sr-only">{copy.streakBest}: </span>
            <b>{streak.best}</b>
          </li>
          {streak.freezes > 0 && (
            <li className="adv-chip" title={copy.streakFreezes}>
              <span className="sr-only">{copy.streakFreezes}: {streak.freezesLeft} из {streak.freezes}</span>
              <span className="adv-freezes" aria-hidden="true">
                {Array.from({ length: streak.freezes }, (_, index) => (
                  <AdventIcon key={index} name="snow" size={16} className={index < streak.freezesLeft ? "on" : "off"} />
                ))}
              </span>
            </li>
          )}
        </ul>
      </div>
      <div
        className="adv-scale"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={scaleEnd}
        aria-valuenow={Math.min(streak.progress, scaleEnd)}
        aria-label={nextGoal ? fill(copy.streakGoal, { label: nextGoal.label, left }) : copy.streakGoalDone}
      >
        <span className="adv-scale-fill" style={{ width: `${percent}%` }} />
        {goals.map((goal) => (
          <span key={goal.opened} className={`adv-scale-goal${goal.reached ? " reached" : ""}`} style={{ left: `${(goal.opened / scaleEnd) * 100}%` }} title={goal.label}>
            <AdventIcon name={goal.reached ? "check" : "gift"} size={12} strokeWidth={2.4} />
          </span>
        ))}
      </div>
      <p className="adv-streak-goal" aria-hidden="true">
        {nextGoal ? fill(copy.streakGoal, { label: nextGoal.label, left }) : goals.length > 0 ? copy.streakGoalDone : ""}
      </p>
    </section>
  );
}
