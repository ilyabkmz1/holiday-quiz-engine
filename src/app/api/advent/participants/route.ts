import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ADVENT_COOKIE, adventCookieOptions, guardParticipantCreation, participantFromRequest } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError } from "@/server/api";
import { getAdventServices } from "@/server/container";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { CreateParticipantResponse } from "@/types/advent";

/**
 * Анонимный участник и cookie. Идемпотентно для устройства: если cookie уже ведёт к участнику этой кампании,
 * возвращается он (новый не создаётся и cookie не меняется).
 */
export async function POST(request: NextRequest) {
  const blocked = guardParticipantCreation(request);
  if (blocked) return blocked;

  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { prisma, adventService } = getAdventServices(tenant);

    const existing = await participantFromRequest(request, adventService);
    if (existing) {
      const body: CreateParticipantResponse = { participantId: existing.id, state: await adventService.state(existing.id, now) };
      return NextResponse.json(body);
    }

    await prisma.campaign.upsert({
      where: { slug: tenant.advent.slug },
      update: { title: tenant.advent.title },
      create: { slug: tenant.advent.slug, title: tenant.advent.title }
    });
    const created = await adventService.createParticipant(now);
    const body: CreateParticipantResponse = { participantId: created.participant.id, state: await adventService.state(created.participant.id, now) };
    const response = NextResponse.json(body);
    response.cookies.set(ADVENT_COOKIE, created.accessKey, adventCookieOptions(tenant.advent));
    console.info(JSON.stringify({ event: "advent_participant_created", participantId: created.participant.id }));
    return response;
  } catch (error) {
    return apiError(error);
  }
}
