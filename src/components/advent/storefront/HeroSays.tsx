"use client";

import { useState } from "react";

import { fill } from "@/components/advent/format";
import { HeroSprite } from "@/components/quest/sprites";
import type { AdventCopy } from "@/config/advent-schema";
import type { PublicHero } from "@/types/api";

/** Фокус на главную кнопку шага без прокрутки: лист остаётся показанным с начала. */
const focusFirst = (element: HTMLElement | null) => element?.focus({ preventScroll: true });

type Props = {
  hero: PublicHero;
  lines: string[];
  copy: AdventCopy;
  /** Подпись кнопки на последней реплике («Дальше» главы, «Понятно, дальше» истории). */
  doneLabel: string;
  mood: "happy" | "neutral";
  busy?: boolean;
  onDone: () => void;
};

/**
 * Глава истории: крупный персонаж (параметрический спрайт героя) и реплика в облачке с именем и ролью.
 * Реплики листаются по нажатию на облачко или на кнопку «Дальше»; на последней реплике кнопка завершает шаг.
 */
export function HeroSays({ hero, lines, copy, doneLabel, mood, busy = false, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const last = index >= lines.length - 1;
  const advance = () => (last ? onDone() : setIndex((current) => Math.min(lines.length - 1, current + 1)));
  return (
    <section className="adv-says" aria-label={`${hero.name}, ${hero.role}`}>
      <div className="adv-says-stage">
        <span className="adv-says-hero"><HeroSprite hero={hero} mood={mood} pose="idle" facing={1} marker={null} /></span>
        <div className="adv-says-bubble" onClick={last ? undefined : advance} data-last={last || undefined}>
          <p className="adv-says-who"><b>{hero.name}</b> <span>{hero.role}</span></p>
          <p className="adv-says-line" key={index} aria-live="polite">{lines[index]}</p>
          {lines.length > 1 && (
            <p className="adv-says-count" aria-hidden="true">
              {fill(copy.bubbleCounter, { i: index + 1, n: lines.length })}
              {!last && <span> · {copy.bubbleHint}</span>}
            </p>
          )}
        </div>
      </div>
      <button type="button" className="adv-btn adv-btn-primary" disabled={busy} onClick={advance} ref={focusFirst}>
        {last ? doneLabel : copy.bubbleNext}
      </button>
    </section>
  );
}
