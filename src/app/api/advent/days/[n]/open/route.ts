import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { participantFromRequest, pathNumber, unauthorized } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { OpenDayResponse } from "@/types/advent";

/** Открыть дверь дня n. Идемпотентно: повтор возвращает то же состояние. */
export async function POST(request: NextRequest, context: { params: Promise<{ n: string }> }) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const { n } = await context.params;
    const day = pathNumber(n, "День");
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService);
    if (!participant) return unauthorized();
    const body: OpenDayResponse = { state: await adventService.openDay(participant.id, day, now) };
    return NextResponse.json(body);
  } catch (error) {
    return apiError(error);
  }
}
