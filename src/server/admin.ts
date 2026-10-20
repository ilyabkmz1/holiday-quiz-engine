import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import { adminChallenge } from "@/server/admin-gate";
import { authenticateAdminRole, type AdminRole } from "@/server/admin-auth";
import { getPrisma } from "@/server/db";
import { getRuntimeEnv } from "@/server/env";
import { hashPassword } from "@/server/password";
import { authRealm } from "@/server/realm";
import { adminAuthRateLimiter } from "@/server/rate-limit";
import { findTenantAdmin } from "@/server/tenant-admins";
import { findTenant } from "@/server/tenants";

/**
 * Роль администратора арендатора, выбранного по Host, или `null`. Арендатор не определился — отказ.
 * Логин ищется только среди операторов этого арендатора, поэтому подмена Host чужие данные не открывает.
 */
export async function adminRole(headers: Headers): Promise<AdminRole | null> {
  let tenantSlug: string | undefined;
  try {
    tenantSlug = findTenant(headers.get("host"))?.tenant;
  } catch {
    return null;
  }
  if (!tenantSlug) return null;
  // Без заголовка Authorization проверять нечего: так браузер получает вызов Basic auth, не тратя лимит.
  if (headers.get("authorization")) {
    const client = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!adminAuthRateLimiter.allow(`${tenantSlug}|${client}`)) return null;
  }
  const result = await authenticateAdminRole(headers.get("authorization"), {
    tenantSlug,
    env: getRuntimeEnv(),
    findAdmin: (slug, username) => findTenantAdmin(getPrisma(), slug, username),
    onRehash: async (slug, username, password) => {
      await getPrisma().tenantAdmin.update({ where: { tenantSlug_username: { tenantSlug: slug, username } }, data: { passwordHash: await hashPassword(password) } });
    }
  });
  return result?.role ?? null;
}

/** Админка и операторские API: только роль `operator` (кассир сюда не допускается). */
export async function adminAuthorized(headers: Headers): Promise<boolean> {
  return (await adminRole(headers)) === "operator";
}

/** Касса (`/redeem`, `POST /api/advent/redeem`): кассир или оператор. */
export async function redeemAuthorized(headers: Headers): Promise<boolean> {
  return (await adminRole(headers)) !== null;
}

export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  return (await adminAuthorized(request.headers)) ? null : adminChallenge(authRealm(request.headers.get("host")));
}

export async function requireCashier(request: NextRequest): Promise<NextResponse | null> {
  return (await redeemAuthorized(request.headers)) ? null : adminChallenge(authRealm(request.headers.get("host")));
}
