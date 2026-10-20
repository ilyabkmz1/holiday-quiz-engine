import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveNow } from "@/server/advent-time";
import { guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { findTenant, isAdventTenant, tenantBaseUrl } from "@/server/tenants";
import { unsubscribeTokenSchema } from "@/server/advent-api";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/**
 * Кнопка «Отписаться» страницы `/unsubscribe`: форма с токеном, только с Origin арендатора. Идемпотентно. Результат —
 * редирект на страницу без токена в адресе (`?done=1` или `?error=1`). Страница GET ничего не меняет.
 */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  try {
    const token = unsubscribeTokenSchema.parse((await request.formData()).get("t"));
    await getAdventServices(tenant).reminderService.unsubscribe(token, resolveNow(request, tenant));
    console.info(JSON.stringify({ event: "advent_unsubscribed", via: "page" }));
    return NextResponse.redirect(publicUrl(baseUrl, "/unsubscribe?done=1"), 303);
  } catch {
    return NextResponse.redirect(publicUrl(baseUrl, "/unsubscribe?error=1"), 303);
  }
}
