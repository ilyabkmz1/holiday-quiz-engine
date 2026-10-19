import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { isDomainError, type DomainErrorCode } from "@/domain/errors";
import { getRuntimeEnv } from "@/server/env";
import { publicApiRateLimiter, sessionCreationRateLimiter } from "@/server/rate-limit";
import { tenantForHost } from "@/server/tenants";
import { isAllowedOrigin, verifySessionAccess } from "@/server/request-security";
import type { GameSessionRecord } from "@/server/repositories/session-repository";

export const SESSION_COOKIE = "quiz_session_access";

export const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  expired: 400
};

export function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * Источник изменяющего запроса: APP_URL либо собственный домен арендатора. Для второго Origin должен
 * совпадать с Host запроса, а Host — принадлежать пакету (`hosts` или поддомен `TENANT_BASE_DOMAIN`): чужая страница прислала бы свой Origin.
 */
export function isOriginAllowedForRequest(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (isAllowedOrigin(origin, getRuntimeEnv().APP_URL)) return true;
  const host = headers.get("host")?.toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host && tenantForHost(host) !== null;
  } catch {
    return false;
  }
}

export function guardPublicRequest(request: NextRequest, mutable = false): NextResponse | null {
  if (!publicApiRateLimiter.allow(clientKey(request))) {
    return NextResponse.json({ error: "Слишком много запросов. Попробуйте через минуту." }, { status: 429 });
  }
  if (mutable && !isOriginAllowedForRequest(request.headers)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  }
  return null;
}

/** Общая защита плюс отдельный лимит на создание сессии. */
export function guardSessionCreation(request: NextRequest): NextResponse | null {
  const blocked = guardPublicRequest(request, true);
  if (blocked) return blocked;
  if (!sessionCreationRateLimiter.allow(clientKey(request))) {
    return NextResponse.json({ error: "Слишком много новых игр. Попробуйте через минуту." }, { status: 429 });
  }
  return null;
}

export function hasSessionAccess(request: NextRequest, session: GameSessionRecord): boolean {
  return verifySessionAccess(request.cookies.get(SESSION_COOKIE)?.value, session.accessKeyHash);
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Проверьте заполнение полей." }, { status: 400 });
  }
  if (isDomainError(error)) {
    return NextResponse.json({ error: error.message }, { status: DOMAIN_ERROR_STATUS[error.code] });
  }
  console.error(JSON.stringify({ event: "api_error", category: "unexpected" }));
  return NextResponse.json({ error: "Не удалось выполнить запрос." }, { status: 500 });
}
