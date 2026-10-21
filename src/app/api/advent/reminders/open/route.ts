import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { participantFromRequest, REMINDER_PAGE_PATH } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { findTenant, isAdventTenant, tenantBaseUrl } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/**
 * Кнопка письма-напоминания (`?r=<id доставки>`). Входа по ссылке письма нет: на устройстве с cookie того же участника
 * переход засчитывается и ведёт на сайт (`/?day=N`); иначе — страница «Чтобы открыть окно, войдите» с кнопкой «Прислать
 * ссылку для входа» (`/reminder`), которая шлёт свежую ссылку входа на адрес владельца. GET ничего не тратит и не шлёт.
 */
export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  const home = () => NextResponse.redirect(publicUrl(baseUrl, "/"), 303);
  try {
    const delivery = request.nextUrl.searchParams.get("r");
    const { adventService, reminderService } = getAdventServices(tenant);
    const current = await participantFromRequest(request, adventService, tenant);
    const found = await reminderService.resolveOpen(delivery, current, resolveNow(request, tenant));
    if (!found || !delivery) return home();
    if (found.direct) return NextResponse.redirect(publicUrl(baseUrl, `/?day=${found.day}`), 303);
    const page = new URLSearchParams({ r: delivery, d: String(found.day) });
    return NextResponse.redirect(publicUrl(baseUrl, `${REMINDER_PAGE_PATH}?${page.toString()}`), 303);
  } catch {
    console.info(JSON.stringify({ event: "advent_reminder_open_failed" }));
    return home();
  }
}
