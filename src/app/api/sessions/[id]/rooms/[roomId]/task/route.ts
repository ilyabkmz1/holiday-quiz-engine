import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { tenantFromHeaders } from "@/server/tenants";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; roomId: string }> }
) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  try {
    const { id, roomId } = await context.params;
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    const answeredTaskId = request.nextUrl.searchParams.get("taskId") ?? undefined;
    return NextResponse.json(await sessionService.roomTask(id, roomId, answeredTaskId));
  } catch (error) {
    return apiError(error);
  }
}
