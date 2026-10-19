import { getRuntimeEnv } from "@/server/env";

export function verificationEndpoint(appUrl: string): string {
  return new URL("/api/claims/verify", appUrl).toString();
}

/**
 * Абсолютный адрес страницы сайта на основе публичного APP_URL.
 * `request.url` за прокси содержит внутренний адрес (например, https://0.0.0.0:3000), поэтому
 * редиректы и ссылки строим только от APP_URL, а не от запроса.
 */
export function publicUrl(appUrl: string, pathAndQuery: string): URL {
  return new URL(pathAndQuery, appUrl);
}

/**
 * Публичная ссылка на страницу результата для «Поделиться». Адрес берётся из APP_URL (за прокси
 * `request.url` внутренний). В ссылке только id сессии: он ничего не открывает, кроме публичного итога.
 */
export function shareUrl(sessionId: string, appUrl: string = getRuntimeEnv().APP_URL): string {
  return publicUrl(appUrl, `/share/${encodeURIComponent(sessionId)}`).toString();
}

/** Адрес картинки результата 1200×630 для Open Graph и Twitter-карточки. */
export function shareImageUrl(sessionId: string, appUrl: string = getRuntimeEnv().APP_URL): string {
  return publicUrl(appUrl, `/share/${encodeURIComponent(sessionId)}/image`).toString();
}
