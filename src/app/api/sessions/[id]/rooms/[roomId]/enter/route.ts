import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { tenantFromHeaders } from "@/server/tenants";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; roomId: string }> }
) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const { id, roomId } = await context.params;
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    return NextResponse.json(await sessionService.enterRoom(id, roomId));
  } catch (error) {
    return apiError(error);
  }
}
