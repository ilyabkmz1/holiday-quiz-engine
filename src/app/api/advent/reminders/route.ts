import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { participantFromRequest, readJsonBody, unauthorized } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { OpenDayResponse } from "@/types/advent";

const bodySchema = z
  .object({
    enabled: z.boolean(),
    /** Согласие на рассылку (ст. 18 38-ФЗ): обязательно при включении, его текст клиент показал рядом с переключателем. */
    marketingConsent: z.boolean().default(false)
  })
  .refine((body) => !body.enabled || body.marketingConsent, { message: "Напоминания включаются только с согласием на рассылку.", path: ["marketingConsent"] });

/**
 * Переключатель «Напоминания на почту». Только для участника с подтверждённым адресом; идемпотентно. Включение записывает
 * согласие на рассылку, выключение его отзывает (как отписка); согласие на обработку данных не меняется.
 */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const input = bodySchema.parse(await readJsonBody(request));
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService);
    if (!participant) return unauthorized();
    const body: OpenDayResponse = { state: await adventService.setReminders(participant.id, input, now) };
    console.info(JSON.stringify({ event: "advent_reminders_toggled", participantId: participant.id, enabled: input.enabled }));
    return NextResponse.json(body);
  } catch (error) {
    return apiError(error);
  }
}
