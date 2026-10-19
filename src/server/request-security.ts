import { timingSafeEqual } from "node:crypto";

import { hashToken } from "@/server/crypto";

export function isAllowedOrigin(origin: string | null, appUrl: string): boolean {
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Запрос послан со страницы этого же сайта: заголовок Origin совпадает с APP_URL, а если браузер прислал
 * Sec-Fetch-Site, он равен same-origin. Для операторских POST, которые нельзя дёргать с чужих страниц.
 */
export function isSameOriginRequest(headers: Headers, appUrl: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return false;
  }
  return isAllowedOrigin(headers.get("origin"), appUrl);
}

export function verifySessionAccess(rawKey: string | undefined, storedHash: string): boolean {
  if (!rawKey) {
    return false;
  }
  return timingSafeEqual(Buffer.from(hashToken(rawKey), "hex"), Buffer.from(storedHash, "hex"));
}
