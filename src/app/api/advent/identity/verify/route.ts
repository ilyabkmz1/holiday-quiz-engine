import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ADVENT_COOKIE, adventCookieOptions, DELIVERY_ID, LOGIN_PAGE_PATH, loginTokenSchema, participantFromRequest } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { getRuntimeEnv } from "@/server/env";
import { findTenant, isAdventTenant, tenantBaseUrl, type AdventTenant } from "@/server/tenants";
import { publicUrl } from "@/server/urls";

export const dynamic = "force-dynamic";

/** Адвент-арендатор запроса или `null` (квиз-арендатор и неизвестный Host: маршрута адвента здесь нет). */
function adventTenantOf(request: NextRequest): AdventTenant | null {
  const found = findTenant(request.headers.get("host"));
  return found && isAdventTenant(found) ? found : null;
}

const notFound = () => NextResponse.json({ error: "Адвент по этому адресу не найден." }, { status: 404 });

/**
 * Переход по ссылке из письма. Токен здесь НЕ тратится: почтовые сканеры и предпросмотр ссылок открывают адрес
 * сами и «сожгли» бы одноразовую ссылку. Ведёт на промежуточную страницу в бренде с кнопкой «Войти»,
 * которая отправляет POST сюда же.
 */
export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  const tenant = adventTenantOf(request);
  if (!tenant) return notFound();
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  const params = request.nextUrl.searchParams;
  const token = loginTokenSchema.safeParse(params.get("token"));
  if (!token.success) return NextResponse.redirect(publicUrl(baseUrl, "/?login=error"), 303);
  // Ссылка, присланная со страницы письма-напоминания, несёт идентификатор доставки: после входа откроется день письма.
  const delivery = params.get("r");
  const login = new URLSearchParams({ token: token.data, ...(delivery && DELIVERY_ID.test(delivery) ? { r: delivery } : {}) });
  return NextResponse.redirect(publicUrl(baseUrl, `${LOGIN_PAGE_PATH}?${login.toString()}`), 303);
}

/**
 * Токен (и необязательный идентификатор доставки письма-напоминания `r`) из формы промежуточной страницы
 * (`application/x-www-form-urlencoded`) или из JSON.
 */
async function fieldsFrom(request: NextRequest): Promise<{ token: unknown; delivery: unknown }> {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json()) as { token?: unknown; r?: unknown } | null;
    return { token: body?.token, delivery: body?.r };
  }
  const form = await request.formData();
  return { token: form.get("token"), delivery: form.get("r") };
}

/**
 * Кнопка «Войти» промежуточной страницы: тратит одноразовую ссылку, привязывает устройство к участнику с этим email
 * (при необходимости сливает анонимный прогресс), выдаёт новый ключ cookie и ведёт на главную. Только с Origin
 * арендатора. Любая ошибка — тот же редирект с `?login=error`, без подробностей и без токена в адресе.
 */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  const tenant = adventTenantOf(request);
  if (!tenant) return notFound();
  const baseUrl = tenantBaseUrl(tenant, getRuntimeEnv().APP_URL);
  try {
    const fields = await fieldsFrom(request);
    const token = loginTokenSchema.parse(fields.token);
    const now = resolveNow(request, tenant);
    const { adventService, identityService, reminderService } = getAdventServices(tenant);
    const current = await participantFromRequest(request, adventService);
    const { participant, accessKey } = await identityService.verify(token, current, now);
    // Вход по ссылке, присланной со страницы письма-напоминания: на сайте открывается день письма.
    let day: number | null = null;
    try {
      day = await reminderService.confirmLogin(typeof fields.delivery === "string" ? fields.delivery : null, participant.id, now);
    } catch {
      console.info(JSON.stringify({ event: "advent_reminder_click_failed", participantId: participant.id }));
    }
    const response = NextResponse.redirect(publicUrl(baseUrl, day === null ? "/" : `/?day=${day}`), 303);
    response.cookies.set(ADVENT_COOKIE, accessKey, adventCookieOptions(tenant.advent));
    console.info(JSON.stringify({ event: "advent_login_verified", participantId: participant.id }));
    return response;
  } catch {
    console.info(JSON.stringify({ event: "advent_login_failed", category: "invalid_or_expired" }));
    return NextResponse.redirect(publicUrl(baseUrl, "/?login=error"), 303);
  }
}
