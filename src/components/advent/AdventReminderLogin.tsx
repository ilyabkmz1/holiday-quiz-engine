import Link from "next/link";

import { fill } from "@/components/advent/format";
import { BrandMark } from "@/components/game/BrandMark";
import type { AdventConfig } from "@/config/advent-schema";

/** Адрес, куда кнопка «Прислать ссылку для входа» отправляет идентификатор доставки (POST, проверка Origin). */
export const REMINDER_LOGIN_ACTION = "/api/advent/reminders/login";

export type ReminderLoginView = { kind: "ask"; delivery: string; day: number | null; notice: "limited" | "failed" | null } | { kind: "sent" } | { kind: "invalid" };

/**
 * Кнопка письма-напоминания открыта на устройстве без входа владельца. Входа по ссылке письма нет (пересланное письмо не даёт
 * доступа): кнопка присылает обычную свежую ссылку входа на подтверждённый адрес владельца письма. Адрес здесь не показывается
 * и не вводится. Работает без JavaScript.
 */
export function AdventReminderLogin({ advent, view }: { advent: AdventConfig; view: ReminderLoginView }) {
  const { brand, copy } = advent;
  return (
    <main className="app verify-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark brand={{ name: brand.name, mark: brand.mark, wordmark: brand.wordmark, logo: brand.logo, tagline: brand.tagline, topNote: brand.topNote }} />
        </div>
        <div className="topbar-note">{brand.topNote}</div>
      </header>
      <section className="verify-card rise" aria-live="polite">
        <div className="eyebrow">{advent.title}</div>
        {view.kind === "ask" && (
          <>
            <h1>{view.day === null ? copy.reminderLoginTitle.replace(/\s*\{day\}/g, "") : fill(copy.reminderLoginTitle, { day: view.day })}</h1>
            <p>{copy.reminderLoginText}</p>
            {view.notice && <p role="alert">{view.notice === "limited" ? copy.reminderLoginLimited : copy.saveErrorSend}</p>}
            <form method="post" action={REMINDER_LOGIN_ACTION}>
              <input type="hidden" name="r" value={view.delivery} />
              <button className="btn btn-primary" type="submit">{copy.reminderLoginButton}</button>
            </form>
          </>
        )}
        {view.kind === "sent" && (
          <>
            <h1>{copy.reminderLoginSentTitle}</h1>
            <p>{copy.reminderLoginSentText}</p>
            <Link className="btn btn-primary" href="/">На главную</Link>
          </>
        )}
        {view.kind === "invalid" && (
          <>
            <h1>Ссылка не сработала</h1>
            <p>{copy.reminderLoginInvalid}</p>
            <Link className="btn btn-primary" href="/">На главную</Link>
          </>
        )}
      </section>
    </main>
  );
}
