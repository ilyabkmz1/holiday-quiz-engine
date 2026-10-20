"use client";

import { useEffect, useRef, useState } from "react";

import { fill } from "@/components/advent/format";
import type { AdventCopy } from "@/config/advent-schema";
import { bulbPositions, garlandModel, pluralForm, wirePoint } from "@/domain/advent";
import type { AdventState } from "@/types/advent";

const WIDTH = 360;
const TOP = 8;
const SAG = 20;
const HEIGHT = 50;
/** Цвета огоньков чередуются по токенам бренда; горит — заливка и ореол, не горит — пустой контур. */
const BULB_COLORS = ["var(--gold)", "var(--cyan)", "var(--coral)", "var(--green)"] as const;

/** «Участие в розыгрыше» → «участие в розыгрыше» в середине фразы; аббревиатуры («ПДн», «VIP») и имена не трогаем. */
export function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/**
 * Подпись под гирляндой: «Ещё 3 окна — и <награда>», либо «Горит k из n», либо «Все цели достигнуты».
 * Считаем окна (дни), а не огоньки: при N > 16 один огонёк покрывает несколько дней.
 */
export function garlandCaption(state: AdventState, copy: AdventCopy): string {
  const { streak, nextGoal, goals, totalDays } = state;
  const windowsLeft = nextGoal ? Math.max(0, nextGoal.opened - Math.min(streak.progress, totalDays)) : 0;
  if (nextGoal && windowsLeft > 0) {
    const windows = pluralForm(windowsLeft, [copy.garlandBulbOne, copy.garlandBulbFew, copy.garlandBulbMany]);
    return fill(copy.garlandLeft, { left: windowsLeft, bulbs: windows, label: lowerFirst(nextGoal.label) });
  }
  if (goals.length > 0) return copy.garlandDone;
  return fill(copy.garlandProgress, { k: Math.min(streak.progress, totalDays), n: totalDays });
}

type Props = { state: AdventState; copy: AdventCopy; /** Новый огонёк только что зажёгся (возврат с экрана дня). */ flash: boolean; onOpen: () => void };

/**
 * Гирлянда — шкала прогресса вместо блока серии: провисающий провод, огоньков столько же, сколько дней (при N > 16 —
 * сегменты), горит столько, сколько открыто. На ближайшей цели серии стоит значок подарка. Нажатие открывает подробности серии.
 */
export function Garland({ state, copy, flash, onOpen }: Props) {
  const { streak, nextGoal, totalDays } = state;
  const model = garlandModel(totalDays, streak.progress, nextGoal?.opened ?? null);
  const points = bulbPositions(model.bulbs, WIDTH, TOP, SAG);
  const caption = garlandCaption(state, copy);

  // Новый огонёк вспыхивает при возврате к фасаду и когда число горящих выросло (догнали день, зажгли с другого экрана).
  const previous = useRef(model.lit);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (model.lit > previous.current) {
      const start = window.setTimeout(() => setGrown(true), 0);
      const stop = window.setTimeout(() => setGrown(false), 2200);
      previous.current = model.lit;
      return () => {
        window.clearTimeout(start);
        window.clearTimeout(stop);
      };
    }
    previous.current = model.lit;
  }, [model.lit]);
  const flashing = flash || grown;

  const wire = Array.from({ length: 25 }, (_, index) => {
    const point = wirePoint(index / 24, WIDTH, TOP, SAG);
    return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }).join(" ");

  return (
    <section className="adv-garland" aria-label={copy.streakCurrent}>
      <button
        type="button"
        className="adv-garland-btn"
        aria-haspopup="dialog"
        aria-label={`${fill(copy.garlandAria, { caption })}. ${fill(copy.streakOpened, { k: state.doors.filter((door) => door.status === "opened").length, n: totalDays })}`}
        onClick={onOpen}
        data-lit={model.lit}
        data-bulbs={model.bulbs}
      >
        <svg className="adv-garland-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
          <path className="adv-garland-wire" d={wire} />
          {points.map((point, index) => {
            const number = index + 1;
            const lit = number <= model.lit;
            const goal = number === model.goalBulb;
            const fresh = flashing && number === model.lit;
            const color = BULB_COLORS[index % BULB_COLORS.length];
            return (
              <g key={index} className={`adv-bulb${lit ? " lit" : ""}${fresh ? " fresh" : ""}${goal ? " goal" : ""}`} transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`} data-bulb={number} data-lit={lit ? "true" : "false"}>
                {goal ? (
                  <>
                    <rect className="adv-goal-tag" x="-11" y="2" width="22" height="22" rx="6" />
                    <path className="adv-goal-glyph" d="M-6 12h12v8h-12z M-7 9h14v3h-14z M0 9v11 M0 9c-1-3.4-4.6-3.6-4.6-1.6C-4.6 9 -2 9 0 9zm0 0c1-3.4 4.6-3.6 4.6-1.6C4.6 9 2 9 0 9z" />
                  </>
                ) : (
                  <>
                    {lit && <circle className="adv-bulb-halo" r="9" style={{ fill: color }} />}
                    <path className="adv-bulb-cap" d="M-2.2 1.6h4.4v3h-4.4z" />
                    <path className="adv-bulb-glass" d="M0 4.2c-3.4 0-4.6 2.6-4.6 5a4.6 4.6 0 0 0 9.2 0c0-2.4-1.2-5-4.6-5z" style={lit ? { fill: color, stroke: color } : undefined} />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <span className="adv-garland-caption">{caption}</span>
      </button>
    </section>
  );
}
