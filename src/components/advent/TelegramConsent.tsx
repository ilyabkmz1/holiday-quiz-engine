"use client";

import { useId, useState, type FormEvent } from "react";

import type { PublicAdvent } from "@/types/advent";

type Props = {
  advent: PublicAdvent;
  /** Сервер отказал или связь пропала: текст показывается под кнопкой. */
  error: string | null;
  busy: boolean;
  onStart: () => void;
};

/**
 * Первое открытие в Telegram: согласие на обработку данных, без него участник не создаётся. Текст — из юридических текстов пакета
 * (`legal.telegramConsentText`, иначе `consentText`) плюс пояснение, что обрабатывается только псевдоним идентификатора Telegram.
 */
export function TelegramConsent({ advent, error, busy, onStart }: Props) {
  const { copy, legal } = advent;
  const id = useId();
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!agreed) {
      setTouched(true);
      return;
    }
    onStart();
  }

  return (
    <section className="adv-tg-consent" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`} className="adv-tg-consent-title">{copy.telegramConsentTitle}</h1>
      <p className="adv-intro">{advent.intro}</p>
      <form className="adv-tg-consent-form" onSubmit={submit} noValidate>
        <label className="adv-check" htmlFor={`${id}-agree`}>
          <input id={`${id}-agree`} type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} aria-describedby={`${id}-note`} />
          <span>{legal.telegramConsentText ?? legal.consentText}</span>
        </label>
        <p id={`${id}-note`} className="adv-muted-small">{copy.telegramConsentNote}</p>
        <p className="adv-muted-small"><a href="/privacy" target="_blank" rel="noopener noreferrer">{copy.telegramConsentPolicy}</a></p>
        {touched && !agreed && <p className="adv-error" role="alert">{copy.telegramConsentRequired}</p>}
        {error && <p className="adv-error" role="alert">{error}</p>}
        <button type="submit" className="adv-btn adv-btn-primary" disabled={busy} aria-disabled={!agreed}>{copy.telegramConsentStart}</button>
      </form>
    </section>
  );
}
