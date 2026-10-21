import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ADVENT_COOKIE, adventCookieOptions, DELIVERY_ID, participantFromRequest, REMINDER_PAGE_PATH } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { clientKey, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { hashToken } from "@/server/crypto";
import { getRuntimeEnv } from "@/server/env";
import {
  adventParticipantRateLimiter,
  identityRequestEmailRateLimiter,
  identityRequestIpRateLimiter,
  reminderLoginDeliveryRateLimiter
} from "@/server/rate-limit";
import { findTenant, isAdventTenant, tenantBaseUrl } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/**
 * Кнопка «Прислать ссылку для входа» страницы `/reminder` (форма, только с Origin арендатора). Шлёт обычную свежую ссылку
 * входа (30 минут, одноразовая) на подтверждённый адрес владельца письма; запросившим устройством считается это (cookie
 * или новый анонимный участник), поэтому чужое устройство доступа не получает, пока ссылку не откроют на нём (семантика A1).
 * Лимиты: на IP, на доставку и на адрес владельца (общий с обычным запросом ссылки). Ответ — редирект на страницу без
 * подробностей: адрес, его наличие и сбои наружу не выходят.
 */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  const tenant = findTenant(request.headers.get("host"));
  if (!tenant || !isAdventTenant(tenant)) return NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  const page = (query: Record<string, string>) => NextResponse.redirect(publicUrl(baseUrl, `${REMINDER_PAGE_PATH}?${new URLSearchParams(query).toString()}`), 303);
  const sent = () => page({ sent: "1" });

  let delivery: string;
  try {
    const raw = (await request.formData()).get("r");
    if (typeof raw !== "string" || !DELIVERY_ID.test(raw)) return page({});
    delivery = raw;
  } catch {
    return page({});
  }
  const limited = () => page({ r: delivery, limited: "1" });
  if (!identityRequestIpRateLimiter.allow(clientKey(request))) return limited();
  if (!reminderLoginDeliveryRateLimiter.allow(`${tenant.advent.slug}:${delivery}`)) return limited();

  try {
    const now = resolveNow(request, tenant);
    const { adventService, identityService, reminderService, ensureCampaign } = getAdventServices(tenant);
    const target = await reminderService.loginTarget(delivery, now);
    // Неизвестная доставка или адреса уже нет (данные обезличены): ответ тот же, письма нет.
    if (!target || target.owner.normalizedEmail === null) return sent();
    if (!identityRequestEmailRateLimiter.allow(`${tenant.advent.slug}:${hashToken(target.owner.normalizedEmail)}`)) return limited();

    let requester = await participantFromRequest(request, adventService, tenant);
    // Владелец уже вошёл на этом устройстве (например, в соседней вкладке): письмо не нужно.
    if (requester?.id === target.owner.id) return NextResponse.redirect(publicUrl(baseUrl, `/?day=${target.day}`), 303);
    let newKey: string | null = null;
    if (!requester) {
      if (!adventParticipantRateLimiter.allow(clientKey(request))) return limited();
      await ensureCampaign();
      const created = await adventService.createParticipant(now);
      requester = created.participant;
      newKey = created.accessKey;
    }
    await identityService.requestOwnerLink(requester.id, target.owner, delivery, now);
    console.info(JSON.stringify({ event: "advent_reminder_login_requested", participantId: requester.id }));
    const response = sent();
    if (newKey) response.cookies.set(ADVENT_COOKIE, newKey, adventCookieOptions(tenant.advent));
    return response;
  } catch {
    // Без подробностей: в ошибке SMTP бывает адрес.
    console.info(JSON.stringify({ event: "advent_reminder_login_failed" }));
    return page({ r: delivery, failed: "1" });
  }
}
