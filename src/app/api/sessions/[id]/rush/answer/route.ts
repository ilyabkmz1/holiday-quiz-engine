import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { tenantFromHeaders } from "@/server/tenants";

const rushAnswerSchema = z.object({
  itemId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64)
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    const body = rushAnswerSchema.parse(await request.json());
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService, rushService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    return NextResponse.json(await rushService.answer(id, body.itemId, body.serviceId));
  } catch (error) {
    return apiError(error);
  }
}
