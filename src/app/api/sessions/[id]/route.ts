import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { publicCampaign } from "@/server/presentation";
import type { GetSessionResponse } from "@/types/api";
import { tenantFromHeaders } from "@/server/tenants";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardPublicRequest(request);
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    const body: GetSessionResponse = {
      campaign: publicCampaign(tenant.campaign, tenant.worldId),
      session: sessionService.presentProgress(session, await sessionService.loadState(id))
    };
    return NextResponse.json(body);
  } catch (error) {
    return apiError(error);
  }
}
