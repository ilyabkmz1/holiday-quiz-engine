import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import { adminChallenge } from "@/server/admin-gate";
import { authenticateAdmin } from "@/server/admin-auth";
import { getPrisma } from "@/server/db";
import { getRuntimeEnv } from "@/server/env";
import { hashPassword } from "@/server/password";
import { authRealm } from "@/server/realm";
import { adminAuthRateLimiter } from "@/server/rate-limit";
import { findTenantAdmin } from "@/server/tenant-admins";
import { findTenant } from "@/server/tenants";

/**
 * Прошёл ли запрос проверку администратора арендатора, выбранного по Host. Арендатор не определился — отказ.
 * Логин ищется только среди операторов этого арендатора, поэтому подмена Host чужие данные не открывает.
 */
export async function adminAuthorized(headers: Headers): Promise<boolean> {
  let tenantSlug: string | undefined;
  try {
    tenantSlug = findTenant(headers.get("host"))?.tenant;
  } catch {
    return false;
  }
  if (!tenantSlug) return false;
  // Без заголовка Authorization проверять нечего: так браузер получает вызов Basic auth, не тратя лимит.
  if (headers.get("authorization")) {
    const client = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!adminAuthRateLimiter.allow(`${tenantSlug}|${client}`)) return false;
  }
  const identity = await authenticateAdmin(headers.get("authorization"), {
    tenantSlug,
    env: getRuntimeEnv(),
    findAdmin: (slug, username) => findTenantAdmin(getPrisma(), slug, username),
    onRehash: async (slug, username, password) => {
      await getPrisma().tenantAdmin.update({ where: { tenantSlug_username: { tenantSlug: slug, username } }, data: { passwordHash: await hashPassword(password) } });
    }
  });
  return identity !== null;
}

export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  return (await adminAuthorized(request.headers)) ? null : adminChallenge(authRealm(request.headers.get("host")));
}
