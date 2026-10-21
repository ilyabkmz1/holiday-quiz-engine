import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardIdentityRequest, participantFromRequest, readJsonBody, unauthorized } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError, guardPublicRequest } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { IdentityRequestResponse } from "@/types/advent";

const requestSchema = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    /** Согласие на обработку персональных данных (152-ФЗ): без него ссылка не уходит. */
    consent: z.boolean(),
    /** Отдельное согласие на рекламную и информационную рассылку (ст. 18 38-ФЗ). */
    marketingConsent: z.boolean().default(false),
    /** Напоминания — рассылка: только вместе с `marketingConsent: true`. */
    reminderOptIn: z.boolean().default(false)
  })
  .refine((input) => !input.reminderOptIn || input.marketingConsent, { message: "Напоминания включаются только с согласием на рассылку.", path: ["marketingConsent"] });

/** «Сохранить серию»: письмо со ссылкой входа. Ответ не зависит от того, известен ли email. */
export async function POST(request: NextRequest) {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  try {
    const input = requestSchema.parse(await readJsonBody(request));
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { adventService, identityService } = getAdventServices(tenant);
    const participant = await participantFromRequest(request, adventService, tenant);
    if (!participant) return unauthorized();
    const limited = guardIdentityRequest(request, participant.id, tenant.advent.slug, input.email);
    if (limited) return limited;
    await identityService.requestLink(participant.id, input, now);
    console.info(JSON.stringify({ event: "advent_login_link_requested", participantId: participant.id }));
    const body: IdentityRequestResponse = { sent: true };
    return NextResponse.json(body);
  } catch (error) {
    return apiError(error);
  }
}
