import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/server/admin";
import { apiError, isOriginAllowedForRequest } from "@/server/api";
import { getNow } from "@/server/container";
import { getPrisma } from "@/server/db";
import { tenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/**
 * Отметка «выгружено»: переводит подтверждённые заявки в `exported`. Отдельный POST, а не побочный
 * эффект скачивания: GET /api/admin/claims.csv ничего не меняет, поэтому чужая страница не может
 * через `<img src>` с закешированным в браузере Basic-паролем перевести заявки в другой статус.
 * Кнопка в админке вызывает этот POST, затем скачивает CSV (выгруженные заявки в него тоже входят).
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  // Источник — APP_URL или Host самого арендатора (оператор на <slug>.<TENANT_BASE_DOMAIN> или своём домене), как у публичного API.
  const site = request.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin") || !isOriginAllowedForRequest(request.headers)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  try {
    const { campaign } = tenantFromHeaders(request.headers);
    const result = await getPrisma().prizeClaim.updateMany({
      where: { campaignSlug: campaign.slug, status: "email_verified", verifiedAt: { not: null } },
      data: { status: "exported", exportedAt: getNow() }
    });
    return NextResponse.json({ exported: result.count }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
