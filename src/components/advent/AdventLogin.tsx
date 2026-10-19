import Link from "next/link";

import { BrandMark } from "@/components/game/BrandMark";
import type { AdventConfig } from "@/config/advent-schema";

/** Адрес, куда кнопка «Войти» отправляет токен (POST, проверка Origin). */
export const LOGIN_FORM_ACTION = "/api/advent/identity/verify";

/**
 * Промежуточная страница входа по ссылке из письма. Ссылка одноразовая, поэтому тратится только по кнопке:
 * почтовые сканеры и предпросмотр открывают адрес (GET), но форму не отправляют. Работает без JavaScript.
 * `token === null` — ссылка битая: сразу предлагаем вернуться на главную.
 */
export function AdventLogin({ advent, token }: { advent: AdventConfig; token: string | null }) {
  const { brand } = advent;
  return (
    <main className="app verify-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark brand={{ name: brand.name, mark: brand.mark, wordmark: brand.wordmark, logo: brand.logo, tagline: brand.tagline, topNote: brand.topNote }} />
        </div>
        <div className="topbar-note">{brand.topNote}</div>
      </header>
      <section className="verify-card rise">
        <div className="eyebrow">Вход по ссылке</div>
        {token ? (
          <>
            <h1>{`Войти в «${advent.title}»`}</h1>
            <p>Нажмите «Войти», чтобы открыть свою серию и награды на этом устройстве.</p>
            <form method="post" action={LOGIN_FORM_ACTION}>
              <input type="hidden" name="token" value={token} />
              <button className="btn btn-primary" type="submit">Войти</button>
            </form>
            <p>Если вы не запрашивали вход, просто закройте страницу.</p>
          </>
        ) : (
          <>
            <h1>Ссылка не сработала</h1>
            <p>Запросите новую ссылку входа на главной странице.</p>
            <Link className="btn btn-primary" href="/">На главную</Link>
          </>
        )}
      </section>
    </main>
  );
}
