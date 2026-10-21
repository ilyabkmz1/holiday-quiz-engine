import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { participantFromRequest, pathNumber, readJsonBody, unauthorized } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";

// Форму `payload` проверяет домен по типу задания; здесь только каркас. Для блока истории тело пустое.
const bodySchema = z.object({ payload: z.record(z.string(), z.unknown()).optional() });

/** Ответ на блок дня: история (подтверждение) или задание. Результат и разбор возвращаются только после записи. */
export async function POST(request: NextRequest, context: { params: Promise<{ n: string; i: string }> }) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const params = await context.params;
    const day = pathNumber(params.n, "День");
    const index = pathNumber(params.i, "Блок");
    const body = bodySchema.parse(await readJsonBody(request));
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService, tenant);
    if (!participant) return unauthorized();
    return NextResponse.json(await adventService.submitBlock(participant.id, day, index, body.payload ?? {}, now));
  } catch (error) {
    return apiError(error);
  }
}
