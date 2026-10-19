"use client";

import { useState } from "react";

import { describeRedeem, tone, type RedeemView } from "./messages";

type Props = { code: string; timeZone: string; initial: RedeemView };

/** Результат проверки кода и кнопка «Погасить» (POST, same-origin). После ответа показывает итог; повторное нажатие безопасно. */
export function RedeemPanel({ code, timeZone, initial }: Props) {
  const [view, setView] = useState<RedeemView>(initial);
  const [justRedeemed, setJustRedeemed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/advent/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, action: "redeem" })
      });
      const body = (await response.json()) as RedeemView & { error?: string };
      if (!body.status) throw new Error(body.error ?? String(response.status));
      setView(body);
      setJustRedeemed(body.status === "redeemed");
    } catch {
      setError("Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const message = describeRedeem(view, timeZone, justRedeemed);
  return (
    <section className={`redeem-result ${tone(view.status)}`} aria-live="polite">
      {view.label && <p className="redeem-reward">{view.label}</p>}
      {view.description && <p className="redeem-note">{view.description}</p>}
      <h2>{message.title}</h2>
      {message.text && <p className="redeem-note">{message.text}</p>}
      {view.status === "ready" && (
        <button type="button" className="redeem-button" onClick={redeem} disabled={busy}>
          Погасить
        </button>
      )}
      {error && <p role="alert" className="redeem-note">{error}</p>}
    </section>
  );
}
