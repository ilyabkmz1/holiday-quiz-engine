"use client";

import { useState } from "react";


type ClaimFormProps = { sessionId: string; consentText: string };

export function ClaimForm({ sessionId, consentText }: ClaimFormProps) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setState("sending");
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          company: formData.get("company"),
          consent: formData.get("consent") === "on"
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Не удалось отправить заявку.");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="claim-success" role="status">
        <span aria-hidden="true">✦</span>
        <div>
          <strong>Письмо уже в пути</strong>
          <p>Перейдите по ссылке в письме в течение 24 часов — так результат станет призовым.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="claim-form" action={submit}>
      <div className="form-heading">
        <span className="form-step">Финальный шаг</span>
        <h2>Закрепите результат</h2>
        <p>Оставьте корпоративный email — мы отправим одноразовую ссылку подтверждения.</p>
      </div>
      <div className="form-grid">
        <label>
          <span>Имя</span>
          <input name="name" minLength={2} maxLength={100} autoComplete="name" required />
        </label>
        <label>
          <span>Компания</span>
          <input name="company" minLength={2} maxLength={160} autoComplete="organization" required />
        </label>
        <label className="wide-field">
          <span>Корпоративный email</span>
          <input name="email" type="email" maxLength={254} autoComplete="email" required />
        </label>
      </div>
      <label className="consent-row">
        <input name="consent" type="checkbox" required />
        <span>
          {consentText}{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Политика обработки данных</a>
        </span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-gold" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Отправляем…" : "Получить ссылку подтверждения"}
      </button>
    </form>
  );
}
