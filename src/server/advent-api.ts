import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { AdventConfig } from "@/config/advent-schema";
import { DomainError } from "@/domain/errors";
import { clientKey, guardPublicRequest } from "@/server/api";
import { getRuntimeEnv } from "@/server/env";
import { hashToken } from "@/server/crypto";
import { normalizeEmail } from "@/server/email";
import {
  adventParticipantRateLimiter,
  identityRequestEmailRateLimiter,
  identityRequestIpRateLimiter,
  identityRequestParticipantRateLimiter
} from "@/server/rate-limit";
import type { ParticipantRecord } from "@/server/repositories/advent-repository";
import type { AdventService } from "@/server/services/advent-service";

/** Cookie с ключом доступа участника адвента (в БД только хеш). */
export const ADVENT_COOKIE = "advent_participant_access";

/** Промежуточная страница входа по ссылке: кнопка «Войти» тратит токен (GET из письма его не тратит). */
export const LOGIN_PAGE_PATH = "/login";

/** Форма токена из ссылки входа (`createOpaqueToken`: 43 символа base64url); остальное — сразу «ссылка не сработала». */
export const loginTokenSchema = z.string().min(20).max(200);

/** Токен отписки из письма (`createOpaqueToken`: 43 символа base64url). */
export const unsubscribeTokenSchema = z.string().min(20).max(200);

/** Параметры cookie: httpOnly, SameSite=Lax, Secure в production, срок — до конца выдачи (`claimEndsAt`). */
export function adventCookieOptions(advent: Pick<AdventConfig, "schedule">) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getRuntimeEnv().NODE_ENV === "production",
    path: "/",
    expires: new Date(advent.schedule.claimEndsAt)
  };
}

/** Общая защита плюс отдельный лимит на создание участника (как у сессий квиза). */
export function guardParticipantCreation(request: NextRequest): NextResponse | null {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  if (!adventParticipantRateLimiter.allow(clientKey(request))) {
    return NextResponse.json({ error: "Слишком много новых участников. Попробуйте через минуту." }, { status: 429 });
  }
  return null;
}

/** Запрос ссылки входа шлёт письмо: лимит на IP, на участника и на адрес (в кампании). */
export function guardIdentityRequest(request: NextRequest, participantId: string, campaignSlug: string, email: string): NextResponse | null {
  const tooMany = () => NextResponse.json({ error: "Слишком много запросов ссылки. Попробуйте позже." }, { status: 429 });
  if (!identityRequestIpRateLimiter.allow(clientKey(request))) return tooMany();
  if (!identityRequestParticipantRateLimiter.allow(participantId)) return tooMany();
  if (!identityRequestEmailRateLimiter.allow(`${campaignSlug}:${hashToken(normalizeEmail(email))}`)) return tooMany();
  return null;
}

/** Участник по cookie или `null`. */
export async function participantFromRequest(request: NextRequest, service: AdventService): Promise<ParticipantRecord | null> {
  return service.identify(request.cookies.get(ADVENT_COOKIE)?.value);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Участник недоступен." }, { status: 401 });
}

/** Номер из сегмента пути; всё, что не неотрицательное целое, — «не найдено». */
export function pathNumber(value: string, what: string): number {
  if (!/^\d{1,4}$/.test(value)) throw new DomainError("not_found", `${what} не найден.`);
  return Number(value);
}

/** Тело JSON-запроса: пустое тело — `{}`, битый JSON — `invalid` (а не 500). */
export async function readJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("invalid", "Тело запроса должно быть JSON.");
  }
}
