import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { participantFromRequest, unauthorized } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

/** Состояние календаря участника: двери, серия, цели, награды. Правильные ответы и исход удачи сюда не попадают. */
export async function GET(request: NextRequest) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService, tenant);
    if (!participant) return unauthorized();
    const response = NextResponse.json(await adventService.state(participant.id, now));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
