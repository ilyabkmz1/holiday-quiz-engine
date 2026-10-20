"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { Burst } from "@/components/advent/Burst";
import { fill } from "@/components/advent/format";
import type { AdventCopy } from "@/config/advent-schema";
import type { AdventGrantView } from "@/types/advent";

export type LuckSkin = "boxes" | "wheel" | "scratch";
/** `choose` — игрок выбирает; `pending` — выбор отправлен, ждём сервер (результата ещё нет); `reveal` — сервер ответил. */
export type LuckPhase = "choose" | "pending" | "reveal";

/** Сколько длится показ результата, мс. С `prefers-reduced-motion` результат показывается сразу. */
export const LUCK_REVEAL_MS: Record<LuckSkin, number> = { boxes: 1100, wheel: 3900, scratch: 1400 };

type Props = {
  skin: LuckSkin;
  choices: number;
  copy: AdventCopy;
  phase: LuckPhase;
  chosen: number | null;
  /** Фактический исход с сервера. До `reveal` его нет, и анимация не стартует. */
  result: AdventGrantView | null;
  reduced: boolean;
  disabled?: boolean;
  onChoose: (index: number) => void;
  /** Показывается после завершения раскрытия: карточка награды и кнопка «дальше». */
  children?: ReactNode;
};

const PROMPTS: Record<LuckSkin, keyof Pick<AdventCopy, "luckPromptBoxes" | "luckPromptWheel" | "luckPromptScratch">> = {
  boxes: "luckPromptBoxes",
  wheel: "luckPromptWheel",
  scratch: "luckPromptScratch"
};
const ITEM_LABEL: Record<LuckSkin, keyof Pick<AdventCopy, "luckBoxLabel" | "luckSectorLabel" | "luckCardLabel">> = {
  boxes: "luckBoxLabel",
  wheel: "luckSectorLabel",
  scratch: "luckCardLabel"
};

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

function sectorPath(index: number, count: number): string {
  const step = 360 / count;
  const from = polar(index * step - step / 2, 96);
  const to = polar(index * step + step / 2, 96);
  return `M0 0L${from.x.toFixed(2)} ${from.y.toFixed(2)}A96 96 0 0 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}Z`;
}

/**
 * Удача: коробки, колесо или скретч над одной логикой. Игрок выбирает элемент (на исход это не влияет), выбор уходит на сервер,
 * и только когда сервер ответил (`phase: "reveal"`, `result`), стартует анимация, которая показывает фактический исход:
 * ни «почти выиграл», ни содержимого остальных коробок и секторов. С `prefers-reduced-motion` исход виден сразу.
 */
export function LuckReveal({ skin, choices, copy, phase, chosen, result, reduced, disabled = false, onChoose, children }: Props) {
  const revealKey = phase === "reveal" && result ? result.id : null;
  const [doneKey, setDoneKey] = useState<string | null>(null);
  useEffect(() => {
    if (revealKey === null || reduced) return;
    const timer = window.setTimeout(() => setDoneKey(revealKey), LUCK_REVEAL_MS[skin]);
    return () => window.clearTimeout(timer);
  }, [revealKey, reduced, skin]);
  // После выбора кнопки блокируются (у колеса — исчезают), и фокус ушёл бы на body: Escape и Tab в листе перестали бы работать.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = sectionRef.current;
    if (phase === "choose" || !section) return;
    const active = document.activeElement;
    if (active === null || active === document.body || (section.contains(active) && (active as HTMLButtonElement).disabled)) {
      section.focus({ preventScroll: true });
    }
  }, [phase]);
  const revealing = revealKey !== null;
  const settled = revealing && (reduced || doneKey === revealKey);
  const locked = disabled || phase !== "choose";
  const itemLabel = (index: number) => {
    const base = fill(copy[ITEM_LABEL[skin]], { i: index + 1 });
    return settled && chosen === index && result ? `${base}: ${result.label}` : base;
  };
  const stateOf = (index: number) => (chosen === null ? "idle" : chosen === index ? (revealing ? "open" : "picked") : "dim");

  const step = 360 / choices;
  // При reduced-motion без оборотов и без перехода (transitionDuration 0s), но указатель всё равно на выбранном секторе.
  const spin = revealing && chosen !== null ? (reduced ? -chosen * step : 360 * 4 - chosen * step) : 0;

  return (
    <section ref={sectionRef} tabIndex={-1} className={`adv-luck adv-luck-${skin}`} data-phase={phase} data-settled={settled ? "true" : "false"} aria-label={copy.luckTitle}>
      <h3 className="adv-luck-title">{copy.luckTitle}</h3>
      <p className="adv-luck-prompt">{phase === "choose" ? copy[PROMPTS[skin]] : phase === "pending" ? copy.luckPending : ""}</p>

      {skin === "wheel" ? (
        <div className="adv-wheel-wrap">
          <span className="adv-wheel-pointer" aria-hidden="true" />
          <svg
            className={`adv-wheel${phase === "pending" ? " charging" : ""}`}
            viewBox="-100 -100 200 200"
            aria-hidden="true"
            style={{ transform: `rotate(${spin}deg)`, transitionDuration: reduced || !revealing ? "0s" : `${LUCK_REVEAL_MS.wheel}ms` }}
          >
            {Array.from({ length: choices }, (_, index) => {
              const label = polar(index * step, 66);
              const parity = index % 2 === 0 ? "a" : choices % 2 === 1 && index === choices - 1 ? "c" : "b";
              return (
                <g key={index} className={`adv-wheel-sector s-${parity}`}>
                  <path d={sectorPath(index, choices)} />
                  <text x={label.x} y={label.y} transform={`rotate(${index * step} ${label.x} ${label.y})`} textAnchor="middle" dominantBaseline="central">
                    {index + 1}
                  </text>
                </g>
              );
            })}
            <circle r="14" className="adv-wheel-hub" />
          </svg>
          {phase === "choose" && (
            <div className="adv-wheel-pick">
              {Array.from({ length: choices }, (_, index) => {
                const at = polar(index * step, 66);
                return (
                  <button
                    key={index}
                    type="button"
                    className="adv-wheel-btn"
                    style={{ left: `${50 + at.x / 2}%`, top: `${50 + at.y / 2}%` }}
                    aria-label={itemLabel(index)}
                    disabled={locked}
                    onClick={() => onChoose(index)}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="adv-luck-grid" data-count={choices}>
          {Array.from({ length: choices }, (_, index) => {
            const state = stateOf(index);
            return (
              <button
                key={index}
                type="button"
                className={`adv-luck-item adv-${skin === "boxes" ? "box" : "scratch"}`}
                data-state={state}
                aria-label={itemLabel(index)}
                disabled={locked}
                onClick={() => onChoose(index)}
              >
                {skin === "boxes" ? (
                  <span className="adv-box-art" aria-hidden="true">
                    <span className="adv-box-glow" />
                    <span className="adv-box-body" />
                    <span className="adv-box-lid"><i /></span>
                    <span className="adv-box-ribbon" />
                    <span className="adv-box-num">{index + 1}</span>
                  </span>
                ) : (
                  <span className="adv-scratch-art" aria-hidden="true">
                    <span className="adv-scratch-prize">
                      {state === "open" && settled && result ? result.label : <AdventIcon name="star" size={26} />}
                    </span>
                    <span className="adv-scratch-foil"><b>{index + 1}</b></span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="adv-luck-live" role="status" aria-live="polite">
        {phase === "pending" && <span className="sr-only">{copy.luckPending}</span>}
        {settled && result && (
          <p className="adv-luck-won" key={result.id}>
            {!reduced && <Burst />}
            <span className="adv-luck-won-cap">{copy.luckWon}</span>
            <b>{result.label}</b>
          </p>
        )}
      </div>
      {settled && children}
    </section>
  );
}
