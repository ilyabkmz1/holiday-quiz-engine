import { NextResponse } from "next/server";

import { verifyBasicAuth } from "@/server/auth";
import { isStagingEnabled, type RuntimeEnv } from "@/server/env";

type StagingEnv = Partial<Pick<RuntimeEnv, "STAGING_USERNAME" | "STAGING_PASSWORD">>;

/** Пути, которые staging-пароль не закрывает. */
export function isStagingExempt(pathname: string): boolean {
  // Liveness для healthcheck контейнера и внешнего мониторинга.
  if (pathname === "/api/health") return true;
  // Вопрос Caddy «выпускать ли сертификат для домена» (on-demand TLS): у него нет staging-пароля, свой секрет в TLS_ASK_TOKEN.
  if (pathname === "/api/internal/tls-ask") return true;
  // Хешированные публичные бандлы Next.js (JS/CSS/шрифты): ответов игры и ПДн в них нет. Без исключения
  // страница /admin под ADMIN-паролем остаётся без стилей и скриптов: браузер шлёт на статику тот же
  // заголовок Authorization, а он не staging-овский. Точное сравнение префикса: `/_next/image`, `/_next/data`
  // и прочее остаются закрытыми, `..` и регистр не обходятся (URL нормализуется до proxy).
  if (pathname.startsWith("/_next/static/")) return true;
  // Операторские страницы и endpoints защищены собственной Basic auth (ADMIN_*): браузер отправляет
  // только один заголовок Authorization, поэтому два пароля на один путь не сосуществуют.
  // Точное сравнение: варианты с другим регистром или %-кодированием остаются под staging-паролем,
  // а ADMIN_* для них требует adminGate (он нормализует путь).
  // Касса адвента (страница и погашение) — те же логины клиента с ролью кассира.
  if (pathname === "/redeem" || pathname === "/api/advent/redeem") return true;
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/") || pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Закрытый стенд: если заданы STAGING_USERNAME и STAGING_PASSWORD, весь сайт (страницы,
 * статика, публичное API) требует HTTP Basic auth. Возвращает 401-ответ или null, если
 * запрос можно пропускать дальше. `realm` — имя области из бренда арендатора (`authRealm`).
 */
export function stagingGate(request: { headers: Headers; nextUrl: { pathname: string } }, env: StagingEnv, realm: string): NextResponse | null {
  if (!isStagingEnabled(env)) return null;
  if (isStagingExempt(request.nextUrl.pathname)) return null;
  if (verifyBasicAuth(request.headers.get("authorization"), env.STAGING_USERNAME!, env.STAGING_PASSWORD!)) {
    return null;
  }
  return new NextResponse("Закрытый стенд: требуется авторизация", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "content-type": "text/plain; charset=utf-8"
    }
  });
}
