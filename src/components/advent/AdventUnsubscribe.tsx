import Link from "next/link";

import { BrandMark } from "@/components/game/BrandMark";
import type { AdventConfig } from "@/config/advent-schema";

/** Адрес, куда кнопка «Отписаться» отправляет токен (POST, проверка Origin). */
export const UNSUBSCRIBE_FORM_ACTION = "/api/advent/unsubscribe";

export type UnsubscribeView = "confirm" | "done" | "error";

/**
 * Страница отписки от напоминаний. Открытие страницы (GET) ничего не меняет: письмо отключается кнопкой, то есть POST.
 * Работает без JavaScript. Отписка отзывает согласие на рассылку и не затрагивает согласие на обработку персональных данных.
 */
export function AdventUnsubscribe({ advent, view, token }: { advent: AdventConfig; view: UnsubscribeView; token: string | null }) {
  const { brand } = advent;
  return (
    <main className="app verify-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark brand={{ name: brand.name, mark: brand.mark, wordmark: brand.wordmark, logo: brand.logo, tagline: brand.tagline, topNote: brand.topNote }} />
        </div>
        <div className="topbar-note">{brand.topNote}</div>
      </header>
      <section className="verify-card rise" aria-live="polite">
        <div className="eyebrow">Напоминания</div>
        {view === "done" && (
          <>
            <h1>Вы отписались</h1>
            <p>Письма-напоминания больше не придут, согласие на рассылку отозвано. Играть можно по-прежнему, а вернуть напоминания — в разделе серии на сайте.</p>
            <Link className="btn btn-primary" href="/">К адвенту</Link>
          </>
        )}
        {view === "confirm" && token && (
          <>
            <h1>Отписаться от напоминаний?</h1>
            <p>Мы перестанем присылать письма об открытых днях и отзовём ваше согласие на рассылку. Прогресс, награды и вход по email останутся.</p>
            <form method="post" action={UNSUBSCRIBE_FORM_ACTION}>
              <input type="hidden" name="t" value={token} />
              <button className="btn btn-primary" type="submit">Отписаться</button>
            </form>
            <p><Link href="/">Остаться и вернуться к адвенту</Link></p>
          </>
        )}
        {(view === "error" || (view === "confirm" && !token)) && (
          <>
            <h1>Ссылка не сработала</h1>
            <p>Отключить напоминания можно на сайте: в разделе серии есть переключатель «Напоминания на почту».</p>
            <Link className="btn btn-primary" href="/">На главную</Link>
          </>
        )}
      </section>
    </main>
  );
}
