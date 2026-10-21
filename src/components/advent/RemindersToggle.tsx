"use client";

import { useId, useState } from "react";

import type { AdventCopy } from "@/config/advent-schema";
import type { AdventState } from "@/types/advent";

type Props = {
  copy: AdventCopy;
  /** Текст согласия на рассылку (`legal.marketingConsentText`); `null` — кампания писем не шлёт. */
  marketingText: string | null;
  state: AdventState;
  /** Включает или выключает напоминания; включение записывает и согласие на рассылку. Возвращает свежее состояние. */
  onChange: (enabled: boolean) => Promise<AdventState>;
  onState: (state: AdventState) => void;
};

/**
 * Переключатель «Напоминания на почту» в листе серии: только для участника с подтверждённым адресом. Письма — рассылка
 * (ст. 18 38-ФЗ), поэтому включён он, только если есть и отметка, и согласие на рассылку. Включение без согласия сначала
 * показывает его текст: запрос уходит по кнопке «Согласен(на), включить». Выключение отзывает согласие на рассылку;
 * согласие на обработку данных не трогает. Состояние берётся с сервера, при ошибке возвращается прежнее.
 */
export function RemindersToggle({ copy, marketingText, state, onChange, onState }: Props) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!state.participant.canRemind || marketingText === null) return null;
  const enabled = state.participant.reminderOptIn && state.participant.marketingConsent;

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      onState(await onChange(next));
      setAsking(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function request(next: boolean) {
    if (next && !state.participant.marketingConsent) {
      setError(false);
      setAsking(true);
      return;
    }
    void toggle(next);
  }

  return (
    <div className="adv-reminders">
      <label className="adv-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          aria-expanded={asking || undefined}
          aria-controls={asking ? `${id}-consent` : undefined}
          onChange={(event) => request(event.target.checked)}
        />
        <span>{copy.remindersToggle}</span>
      </label>
      <p id={`${id}-hint`} className="adv-muted">{copy.remindersToggleHint}</p>
      {asking && (
        <div className="adv-reminders-consent" id={`${id}-consent`} role="group" aria-label={copy.remindersToggle}>
          <p>{marketingText}</p>
          <div className="adv-reminders-actions">
            <button type="button" className="adv-btn adv-btn-primary" disabled={busy} onClick={() => void toggle(true)}>{copy.remindersConsentAccept}</button>
            <button type="button" className="adv-btn adv-btn-ghost" disabled={busy} onClick={() => setAsking(false)}>{copy.remindersConsentCancel}</button>
          </div>
        </div>
      )}
      {error && <p className="adv-error" role="alert">{copy.remindersToggleError}</p>}
    </div>
  );
}
