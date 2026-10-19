import { parseBasicAuth, verifyBasicAuth } from "@/server/auth";
import type { RuntimeEnv } from "@/server/env";
import { dummyHash, needsRehash, verifyPassword } from "@/server/password";

/** Откуда взялось право входа: логин арендатора из БД или администратор процесса из окружения. */
export type AdminIdentity = "tenant" | "process";

export type AdminAuthEnv = Pick<RuntimeEnv, "ADMIN_USERNAME" | "ADMIN_PASSWORD"> & Partial<Pick<RuntimeEnv, "TENANT" | "SUPERADMIN">>;

export type AdminAuthDeps = {
  /** Арендатор по Host запроса: логин проверяется только в его рамках. */
  tenantSlug: string;
  env: AdminAuthEnv;
  findAdmin: (tenantSlug: string, username: string) => Promise<{ passwordHash: string; disabledAt: Date | null } | null>;
  /** Хеш пересчитан под текущие параметры: сохранить (необязательно). */
  onRehash?: (tenantSlug: string, username: string, password: string) => Promise<void>;
};

/**
 * Администратор из окружения (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) действует только явно:
 * - при `TENANT=<slug>` процесс обслуживает одного арендатора, Host его не меняет, и этот логин — администратор того арендатора;
 * - без `TENANT` нужен `SUPERADMIN=true`, иначе общий пароль плюс подмена Host выгрузили бы ПДн любого арендатора.
 */
export function processAdminAllowed(env: Pick<AdminAuthEnv, "TENANT" | "SUPERADMIN">): boolean {
  return Boolean(env.TENANT) || Boolean(env.SUPERADMIN);
}

/**
 * Проверяет Basic auth для админки арендатора `tenantSlug`. Логин арендатора из БД действует только на своём Host:
 * на чужом арендаторе такой строки нет, поэтому подмена Host доступа не даёт.
 */
export async function authenticateAdmin(authorization: string | null, deps: AdminAuthDeps): Promise<AdminIdentity | null> {
  const credentials = parseBasicAuth(authorization);
  if (!credentials) return null;
  const { env, tenantSlug } = deps;

  if (processAdminAllowed(env) && verifyBasicAuth(authorization, env.ADMIN_USERNAME, env.ADMIN_PASSWORD)) return "process";

  let record: Awaited<ReturnType<AdminAuthDeps["findAdmin"]>> = null;
  try {
    record = await deps.findAdmin(tenantSlug, credentials.username);
  } catch {
    // База недоступна: отказ, а не проход. Текст ошибки не пишем: в нём может быть строка подключения.
    console.error(JSON.stringify({ event: "admin_auth_lookup_failed", tenant: tenantSlug }));
    return null;
  }
  // Проверка идёт всегда, в том числе для несуществующего логина: время ответа не выдаёт, есть ли он.
  const hash = record && !record.disabledAt ? record.passwordHash : await dummyHash();
  const matches = await verifyPassword(credentials.password, hash);
  if (!matches || !record || record.disabledAt) return null;
  if (deps.onRehash && needsRehash(record.passwordHash)) {
    await deps.onRehash(tenantSlug, credentials.username, credentials.password).catch(() => undefined);
  }
  return "tenant";
}
