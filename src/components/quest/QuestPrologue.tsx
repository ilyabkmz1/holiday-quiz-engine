"use client";

import { useEffect, useMemo, useState } from "react";

import { useWorldModel } from "@/components/play/world-context";
import type { BubbleSpec } from "@/components/quest/ScreenOverlay";
import type { PublicCampaign, PublicHero } from "@/types/api";

/** Сколько длится «вылет» робота с иллюстрации, мс. */
export const ROBOT_FLIGHT_MS = 2200;

/**
 * Пролог без очков, по спецификации: общий план шара и «встряхивание» снега, робот слетает со своего
 * места на иллюстрации, камера приближается к персонажу, герой пролога объясняет правила, обучающий тап — MFA.
 * Шаги мира: 0 — общий план, 1 — полёт робота, 2 — приближение и диалог с героем пролога.
 */
export function usePrologue(campaign: PublicCampaign, active: boolean, reduced: boolean) {
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(1);
  const [mfaOn, setMfaOn] = useState(false);
  const { START_POS } = useWorldModel();
  const hero: PublicHero = campaign.heroes.find((candidate) => candidate.id === campaign.prologue.heroId) ?? campaign.heroes[0];
  const { lines, mfa } = campaign.prologue;
  const allShown = shown >= lines.length;

  useEffect(() => {
    if (!active || step !== 1) return;
    const timer = window.setTimeout(() => setStep(2), reduced ? 0 : ROBOT_FLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [active, step, reduced]);

  const heroLine = !allShown ? lines[shown - 1] : mfaOn ? mfa.done : mfa.prompt;
  const bubbles = useMemo<BubbleSpec[]>(() => {
    if (!active) return [];
    if (step === 0) return [{ id: "prologue-robot", anchor: { kind: "robot" }, tone: "robot", text: campaign.story.guideIntro }];
    if (step === 1) return [{ id: "prologue-robot", anchor: { kind: "robot" }, tone: "robot", text: "Лечу к вам!" }];
    return [{ id: "prologue-hero", anchor: { kind: "point", at: { x: START_POS.x + 84, y: START_POS.y } }, title: `${hero.name}, ${hero.role}`, text: heroLine }];
  }, [active, step, hero, heroLine, campaign.story.guideIntro, START_POS]);

  return {
    step,
    hero,
    lines,
    mfa,
    shown,
    allShown,
    mfaOn,
    heroLine,
    bubbles,
    start: () => setStep(1),
    next: () => setShown((count) => count + 1),
    enableMfa: () => setMfaOn(true)
  };
}

export type PrologueState = ReturnType<typeof usePrologue>;

/** Нижняя панель пролога: подпись, «Дальше», обучающий переключатель MFA и вход в офис. */
export function ProloguePanel({ campaign, state, busy, onDone }: { campaign: PublicCampaign; state: PrologueState; busy: boolean; onDone: () => void }) {
  const { step, mfa, allShown, mfaOn } = state;
  return (
    <section className="qw-panel qw-ui" aria-label="Пролог">
      {step === 0 && (
        <>
          <div className="eyebrow">{campaign.scene.dateLabel}</div>
          <h2 className="qw-panel-title">{campaign.title}</h2>
          <p className="muted">{campaign.intro}</p>
          <button type="button" className="btn btn-primary" onClick={state.start} autoFocus>
            Дальше
          </button>
        </>
      )}
      {step === 1 && <p className="muted" role="status">Робот-помощник летит к вам…</p>}
      {step >= 2 && (
        <>
          <p className="sr-only" role="status" aria-live="polite">{`${state.hero.name}: ${state.heroLine}`}</p>
          {allShown && (
            <div className="mfa rise">
              <button type="button" role="switch" aria-checked={mfaOn} className={mfaOn ? "switch-row on" : "switch-row"} onClick={state.enableMfa}>
                <span className="switch-title">{mfa.switchLabel}</span>
                <span className="sw" aria-hidden="true" />
              </button>
            </div>
          )}
          {!allShown ? (
            <button type="button" className="btn btn-primary" onClick={state.next} autoFocus>
              Дальше
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!mfaOn || busy} onClick={onDone}>
              {busy ? "Открываем офис…" : "Войти в офис"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
