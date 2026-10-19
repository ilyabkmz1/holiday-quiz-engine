import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/server/admin";
import { apiError, isOriginAllowedForRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { CODE_IMPORT_LIMITS } from "@/server/services/reward-service";
import { adventTenantFromHeaders } from "@/server/tenants";
import { DomainError } from "@/domain/errors";

export const dynamic = "force-dynamic";

const jsonBodySchema = z.object({ rewardId: z.string().min(1).max(64), csv: z.string() });

/**
 * Импорт кодов в пул награды (`codes.list`): CSV со столбцом `code`. Только роль оператора и только с Origin арендатора.
 * Тело — `text/csv` с `?rewardId=…` или JSON `{ rewardId, csv }`. Ответ — отчёт: сколько добавлено, дублей, ошибочных строк.
 * Коды в журнал не пишутся.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const site = request.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin") || !isOriginAllowedForRequest(request.headers)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > CODE_IMPORT_LIMITS.bytes * 2) throw new DomainError("invalid", "Файл слишком большой.");
    const text = await request.text();
    let rewardId: string;
    let csv: string;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = jsonBodySchema.parse(JSON.parse(text));
      ({ rewardId, csv } = body);
    } else {
      rewardId = z.string().min(1).max(64).parse(request.nextUrl.searchParams.get("rewardId"));
      csv = text;
    }
    const { rewardService, ensureCampaign } = getAdventServices(tenant);
    await ensureCampaign();
    const report = await rewardService.importCodes(rewardId, csv);
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
