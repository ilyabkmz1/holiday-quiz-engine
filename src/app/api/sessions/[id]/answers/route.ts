import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, guardPublicRequest, hasSessionAccess } from "@/server/api";
import { getServices } from "@/server/container";
import { tenantFromHeaders } from "@/server/tenants";

// Форму `payload` проверяет домен по типу задания; здесь только общий каркас и защита от больших тел.
const answerSchema = z.object({
  taskId: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown())
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const { id } = await context.params;
    const body = answerSchema.parse(await request.json());
    const tenant = tenantFromHeaders(request.headers);
    const { sessionService } = getServices(tenant);
    const session = await sessionService.get(id);
    if (!hasSessionAccess(request, session)) {
      return NextResponse.json({ error: "Сессия недоступна." }, { status: 401 });
    }
    return NextResponse.json(await sessionService.answerTask(id, body.taskId, body.payload));
  } catch (error) {
    return apiError(error);
  }
}
