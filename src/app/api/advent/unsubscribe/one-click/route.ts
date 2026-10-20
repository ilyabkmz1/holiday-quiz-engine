import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { DomainError } from "@/domain/errors";
import { unsubscribeTokenSchema } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { clientKey } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { publicApiRateLimiter } from "@/server/rate-limit";
import { findTenant, isAdventTenant, tenantBaseUrl } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/**
 * Отписка одним нажатием (RFC 8058): заголовок `List-Unsubscribe` письма указывает сюда, почтовый клиент шлёт
 * `POST` с телом `List-Unsubscribe=One-Click`. Origin у такого запроса нет и быть не должно, поэтому защита здесь —
 * только токен (случайный, в БД хеш) и лимит запросов. Идемпотентно.
 */
export async function POST(request: NextRequest) {
  if (!publicApiRateLimiter.allow(clientKey(request))) return NextResponse.json({ error: "Слишком много запросов." }, { status: 429 });
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const token = unsubscribeTokenSchema.safeParse(request.nextUrl.searchParams.get("t"));
  if (!token.success) return NextResponse.json({ error: "Ссылка отписки недействительна." }, { status: 400 });
  try {
    await getAdventServices(tenant).reminderService.unsubscribe(token.data, resolveNow(request, tenant));
    console.info(JSON.stringify({ event: "advent_unsubscribed", via: "one_click" }));
    return NextResponse.json({ unsubscribed: true });
  } catch (error) {
    if (error instanceof DomainError && error.code === "not_found") return NextResponse.json({ error: "Ссылка отписки недействительна." }, { status: 404 });
    console.error(JSON.stringify({ event: "advent_unsubscribe_failed" }));
    return NextResponse.json({ error: "Не удалось отписаться. Попробуйте позже." }, { status: 500 });
  }
}

/** Почтовые клиенты и сканеры иногда открывают адрес из заголовка GET-ом: ничего не меняем, ведём на страницу с кнопкой. */
export async function GET(request: NextRequest) {
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  const token = unsubscribeTokenSchema.safeParse(request.nextUrl.searchParams.get("t"));
  if (!token.success) return NextResponse.redirect(publicUrl(baseUrl, "/unsubscribe?error=1"), 303);
  return NextResponse.redirect(publicUrl(baseUrl, `/unsubscribe?t=${encodeURIComponent(token.data)}`), 303);
}
