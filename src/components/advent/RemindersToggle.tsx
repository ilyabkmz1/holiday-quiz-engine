"use client";

import { useId, useState } from "react";

import type { AdventCopy } from "@/config/advent-schema";
import type { AdventState } from "@/types/advent";

type Props = {
  copy: AdventCopy;
  state: AdventState;
  /** Включает или выключает напоминания; возвращает свежее состояние. */
  onChange: (enabled: boolean) => Promise<AdventState>;
  onState: (state: AdventState) => void;
};

/**
 * Переключатель «Напоминания на почту» в листе серии: только для участника с подтверждённым адресом. Отдельное
 * согласие на обработку данных он не трогает. Состояние берётся с сервера, при ошибке возвращается прежнее.
 */
export function RemindersToggle({ copy, state, onChange, onState }: Props) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!state.participant.canRemind) return null;
  const enabled = state.participant.reminderOptIn;

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      onState(await onChange(next));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adv-reminders">
      <label className="adv-check" htmlFor={id}>
        <input id={id} type="checkbox" checked={enabled} disabled={busy} aria-describedby={`${id}-hint`} onChange={(event) => void toggle(event.target.checked)} />
        <span>{copy.remindersToggle}</span>
      </label>
      <p id={`${id}-hint`} className="adv-muted">{copy.remindersToggleHint}</p>
      {error && <p className="adv-error" role="alert">{copy.remindersToggleError}</p>}
    </div>
  );
}
