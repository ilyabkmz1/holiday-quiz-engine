import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ADVENT_COOKIE, adventCookieOptions, guardParticipantCreation, participantFromRequest, readJsonBody } from "@/server/advent-api";
import { resolveNow } from "@/server/advent-time";
import { apiError } from "@/server/api";
import { DomainError } from "@/domain/errors";
import { getAdventServices } from "@/server/container";
import { telegramCaller } from "@/server/telegram-auth";
import { adventTenantFromHeaders } from "@/server/tenants";
import type { CreateParticipantResponse } from "@/types/advent";

/**
 * Участник в Telegram: запрос подписан initData (`X-Telegram-Init-Data`), cookie не используется. Идемпотентно: один аккаунт —
 * один участник (параллельные первые запросы сходятся на уникальном индексе). Участник создаётся только с `{ "consent": true }`:
 * согласие на обработку данных фиксируется сервером, без него — 409 и экран согласия.
 *
 * Иначе — анонимный участник и cookie. Идемпотентно для устройства: если cookie уже ведёт к участнику этой кампании,
 * возвращается он (новый не создаётся и cookie не меняется).
 */
export async function POST(request: NextRequest) {
  const blocked = guardParticipantCreation(request);
  if (blocked) return blocked;

  try {
    const tenant = adventTenantFromHeaders(request.headers);
    const now = resolveNow(request, tenant);
    const { prisma, adventService } = getAdventServices(tenant);

    const telegram = telegramCaller(request.headers, tenant);
    if (telegram) {
      const known = await adventService.identifyPlatform("telegram", telegram.subjectHash);
      if (known) return NextResponse.json({ participantId: known.id, state: await adventService.state(known.id, now) } satisfies CreateParticipantResponse);
      const body = await readJsonBody(request);
      if (typeof body !== "object" || body === null || (body as { consent?: unknown }).consent !== true) {
        throw new DomainError("conflict", "Нужно согласие на обработку данных.");
      }
      await prisma.campaign.upsert({
        where: { slug: tenant.advent.slug },
        update: { title: tenant.advent.title },
        create: { slug: tenant.advent.slug, title: tenant.advent.title }
      });
      const { participant, created } = await adventService.createPlatformParticipant("telegram", telegram.subjectHash, now);
      if (created) console.info(JSON.stringify({ event: "advent_participant_created", participantId: participant.id, platform: "telegram" }));
      return NextResponse.json({ participantId: participant.id, state: await adventService.state(participant.id, now) } satisfies CreateParticipantResponse);
    }

    const existing = await participantFromRequest(request, adventService, tenant);
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
