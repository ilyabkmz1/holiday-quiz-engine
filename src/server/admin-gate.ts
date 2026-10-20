import { NextResponse } from "next/server";

/** Приводит путь к виду, в котором его увидит маршрутизатор: декодирует %XX, схлопывает слэши, регистр не важен. */
export function normalizePath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Некорректная последовательность %: проверяем как есть, строже всё равно не станет.
  }
  return decoded.replace(/\/{2,}/g, "/").toLowerCase();
}

/** Страницы оператора: `/admin` и всё под ним. API (`/api/admin/*`) проверяет сам route handler. */
export function isAdminPagePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/admin" || path.startsWith("/admin/");
}

/** Страница кассы адвента: `/redeem` (кассир или оператор). */
export function isRedeemPagePath(pathname: string): boolean {
  return normalizePath(pathname) === "/redeem";
}

/** Ответ 401 с вызовом Basic auth. Один realm и для страниц, и для API: браузер переиспользует введённый пароль. */
export function adminChallenge(realm: string): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

/**
 * Закрывает страницы оператора Basic auth. Работает в proxy, после staging-gate, который
 * `/admin` не трогает: один заголовок Authorization, поэтому staging-пароль здесь не принимается.
 * `authorize` проверяет логин в рамках арендатора по Host (см. `adminAuthorized`). Возвращает 401 или null, если запрос можно пропускать.
 */
export async function adminGate(
  request: { headers: Headers; nextUrl: { pathname: string } },
  authorize: (headers: Headers) => Promise<boolean>,
  realm: string
): Promise<NextResponse | null> {
  if (!isAdminPagePath(request.nextUrl.pathname)) return null;
  return (await authorize(request.headers)) ? null : adminChallenge(realm);
}

/** Закрывает страницу кассы Basic auth: пускает кассира и оператора (`redeemAuthorized`). Остальное — как `adminGate`. */
export async function redeemGate(
  request: { headers: Headers; nextUrl: { pathname: string } },
  authorize: (headers: Headers) => Promise<boolean>,
  realm: string
): Promise<NextResponse | null> {
  if (!isRedeemPagePath(request.nextUrl.pathname)) return null;
  return (await authorize(request.headers)) ? null : adminChallenge(realm);
}
