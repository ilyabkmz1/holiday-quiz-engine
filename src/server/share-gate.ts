import { NextResponse } from "next/server";

import { normalizePath } from "@/server/admin-gate";
import { shareRateLimiter } from "@/server/rate-limit";

/** Публичные страницы «Поделиться»: `/share/*` (страница и картинка). Путь нормализуется так же, как маршрутизатором. */
export function isSharePath(pathname: string): boolean {
  return normalizePath(pathname).startsWith("/share/");
}

/**
 * Лимит запросов на `/share/*` по IP (страница читает БД, картинка грузит процессор). Query-параметры
 * на ключ не влияют, поэтому `?x=1`, `?x=2` лимит не обходят. Возвращает 429 или null.
 */
export function shareGate(
  request: { headers: Headers; nextUrl: { pathname: string } },
  limiter: Pick<typeof shareRateLimiter, "allow"> = shareRateLimiter
): NextResponse | null {
  if (!isSharePath(request.nextUrl.pathname)) return null;
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limiter.allow(key)) return null;
  return new NextResponse("Слишком много запросов. Попробуйте через минуту.", {
    status: 429,
    headers: { "retry-after": "60", "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" }
  });
}
