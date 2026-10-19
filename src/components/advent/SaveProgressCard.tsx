"use client";

import { useId, useState, type FormEvent } from "react";

import { AdventIcon } from "@/components/advent/icons";
import { fill } from "@/components/advent/format";
import type { AdventCopy } from "@/config/advent-schema";

export type SaveProgressInput = { email: string; consent: boolean; marketingConsent: boolean; reminderOptIn: boolean };

type Props = {
  copy: AdventCopy;
  /** Согласие на обработку персональных данных из юридических текстов пакета. */
  consentText: string;
  /** `identity` — сервер ответил `identity_required`: без входа приз не выдаётся. */
  reason: "after-day" | "identity";
  onSubmit: (input: SaveProgressInput) => Promise<void>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * «Сохранить прогресс»: email, обязательное согласие на обработку персональных данных и отдельное необязательное
 * согласие на напоминания (ст. 18 38-ФЗ). Письмо уходит только по явному действию; после отправки — экран «проверьте почту».
 */
export function SaveProgressCard({ copy, consentText, reason, onSubmit }: Props) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"form" | "sending" | "sent">("form");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    const clean = email.trim();
    if (!EMAIL.test(clean)) return setError(copy.saveErrorEmail);
    if (!consent) return setError(copy.saveErrorConsent);
    setError(null);
    setState("sending");
    try {
      await onSubmit({ email: clean, consent, marketingConsent: marketing, reminderOptIn: marketing });
      setSentTo(clean);
      setState("sent");
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : copy.saveErrorSend);
      setState("form");
    }
  }

  if (state === "sent") {
    return (
      <section className="adv-save adv-save-sent" aria-live="polite">
        <span className="adv-save-badge" aria-hidden="true"><AdventIcon name="mail" size={24} /></span>
        <h3>{copy.saveSentTitle}</h3>
        <p>{fill(copy.saveSentText, { email: sentTo })}</p>
        <button type="button" className="adv-btn adv-btn-ghost" onClick={() => setState("form")}>{copy.saveChange}</button>
      </section>
    );
  }

  return (
    <section className="adv-save" aria-labelledby={`${ids}-t`}>
      <span className="adv-save-badge" aria-hidden="true"><AdventIcon name="mail" size={24} /></span>
      <h3 id={`${ids}-t`}>{copy.saveTitle}</h3>
      <p>{reason === "identity" ? copy.saveIdentityRequired : copy.saveText}</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label className="adv-field" htmlFor={`${ids}-e`}>
          <span>{copy.saveEmail}</span>
          <input
            id={`${ids}-e`}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            aria-invalid={error === copy.saveErrorEmail || undefined}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="adv-check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} aria-required="true" />
          <span>{copy.saveConsent}</span>
        </label>
        <p className="adv-legal">
          {consentText} <a href="/privacy" target="_blank" rel="noopener noreferrer">{copy.savePolicy}</a>
        </p>
        <label className="adv-check">
          <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
          <span>{copy.saveMarketing}</span>
        </label>
        {error && <p className="adv-error" id={`${ids}-err`} role="alert">{error}</p>}
        <button type="submit" className="adv-btn adv-btn-primary" disabled={state === "sending"}>
          {state === "sending" ? copy.saveSending : copy.saveSubmit}
        </button>
      </form>
    </section>
  );
}
