import { isAdventTenant, findTenant, type AnyTenant } from "@/server/tenants";

/**
 * Кто может встроить страницу во фрейм. По умолчанию никто (`frame-ancestors 'none'`, защита от clickjacking). Исключение —
 * страницы адвент-арендатора с включённым Telegram: Telegram Web (web.telegram.org) открывает мини-приложение внутри iframe,
 * поэтому им разрешены только фреймы с origin'ов Telegram и своего сайта. Приложения Telegram на телефоне и десктопе — WebView
 * без фрейма, им это не нужно. Операторские и служебные пути (`/admin`, `/api`, `/redeem`) не встраиваются никогда.
 */
export const TELEGRAM_FRAME_ORIGINS = [
  "https://web.telegram.org",
  "https://webk.telegram.org",
  "https://webz.telegram.org",
  "https://k.web.telegram.org",
  "https://z.web.telegram.org"
] as const;

const NEVER_FRAMED = /^\/(?:admin|api|redeem)(?:\/|$)/;

const DENY = { "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" } as const;

function tenantOf(host: string | null): AnyTenant | null {
  try {
    return findTenant(host);
  } catch {
    return null;
  }
}

/** Заголовки защиты от встраивания для запроса: `X-Frame-Options` отдаётся только там, где фрейм запрещён полностью. */
export function frameHeaders(host: string | null, pathname: string): Record<string, string> {
  if (NEVER_FRAMED.test(pathname)) return { ...DENY };
  const tenant = tenantOf(host);
  if (!tenant || !isAdventTenant(tenant) || !tenant.platforms.telegram) return { ...DENY };
  return { "Content-Security-Policy": `frame-ancestors 'self' ${TELEGRAM_FRAME_ORIGINS.join(" ")}` };
}
