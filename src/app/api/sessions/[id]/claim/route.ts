import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { tenantFromHeaders } from "@/server/tenants";

const claimSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  company: z.string().trim().min(2).max(160),
  consent: z.literal(true)
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    const input = claimSchema.parse(await request.json());
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService, claimService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    const result = await claimService.create(id, input);
    console.info(JSON.stringify({ event: "claim_created", claimId: result.claim.id, created: result.created }));
    return NextResponse.json({ status: result.claim.status, created: result.created });
  } catch (error) {
    return apiError(error);
  }
}
