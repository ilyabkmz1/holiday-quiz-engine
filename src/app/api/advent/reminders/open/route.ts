import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LOGIN_PAGE_PATH, loginTokenSchema, participantFromRequest } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { findTenant, isAdventTenant, tenantBaseUrl } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/**
 * Кнопка письма-напоминания. Ничего не тратит: на устройстве с cookie того же участника засчитывает переход и ведёт на
 * сайт (`/?day=N`); иначе отправляет на промежуточную страницу входа с кнопкой «Войти» (одноразовая ссылка тратится только
 * её POST, поэтому почтовые сканеры письмо не «сжигают» и клики не накручивают). Ссылка с токеном в логи не пишется.
 */
export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  const home = () => NextResponse.redirect(publicUrl(baseUrl, "/"), 303);
  try {
    const params = request.nextUrl.searchParams;
    const delivery = params.get("r");
    const token = loginTokenSchema.safeParse(params.get("token"));
    const { adventService, reminderService } = getAdventServices(tenant);
    const current = await participantFromRequest(request, adventService);
    const found = await reminderService.resolveOpen(delivery, current, resolveNow(request, tenant));
    if (!found) return home();
    if (found.direct) return NextResponse.redirect(publicUrl(baseUrl, `/?day=${found.day}`), 303);
    if (!token.success) return NextResponse.redirect(publicUrl(baseUrl, "/?login=error"), 303);
    const login = new URLSearchParams({ token: token.data, r: delivery ?? "" });
    return NextResponse.redirect(publicUrl(baseUrl, `${LOGIN_PAGE_PATH}?${login.toString()}`), 303);
  } catch {
    console.info(JSON.stringify({ event: "advent_reminder_open_failed" }));
    return home();
  }
}
