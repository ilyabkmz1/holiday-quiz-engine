import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCashier } from "@/server/admin";
import { readJsonBody } from "@/server/advent-api";
import { clientKey, apiError, isOriginAllowedForRequest } from "@/server/api";
import { getAdventServices, getNow } from "@/server/container";
import { redeemRateLimiter } from "@/server/rate-limit";
import { redeemBody, redeemHttpStatus } from "@/server/redeem-api";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

// Код может быть текстом из выдачи, содержимым личного QR или ссылкой `/redeem?code=…`: потолок длины защищает разбор.
const bodySchema = z.object({ code: z.string().min(1).max(300), action: z.enum(["check", "redeem"]).default("redeem") });

/**
 * Касса: проверка (`action: "check"`) и погашение награды адвента по коду или личному QR. Доступ — Basic auth кассира
 * или оператора арендатора (`quiz:admin --role cashier`), только с Origin арендатора, с лимитом на точку.
 * Погашение — один условный UPDATE: повтор отвечает «уже погашен», просроченное — «срок истёк». В журнал код не пишется.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireCashier(request);
  if (unauthorized) return unauthorized;
  const site = request.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin") || !isOriginAllowedForRequest(request.headers)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    if (!redeemRateLimiter.allow(`${tenant.tenant}|${clientKey(request)}`)) {
      return NextResponse.json({ error: "Слишком много запросов. Подождите минуту." }, { status: 429, headers: { "cache-control": "no-store" } });
    }
    const body = bodySchema.parse(await readJsonBody(request));
    const { rewardService } = getAdventServices(tenant);
    const now = getNow();
    const result = body.action === "check" ? await rewardService.inspect(body.code, now) : await rewardService.redeem(body.code, now);
    // Проверка отвечает 200, если выдача найдена (состояние — в `status`); погашение различает исходы кодом ответа.
    const status = body.action === "check" && "grantId" in result ? 200 : redeemHttpStatus(result.status);
    return NextResponse.json(redeemBody(result), { status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
