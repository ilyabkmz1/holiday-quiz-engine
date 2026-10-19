import { generatePassword, hashPassword } from "@/server/password";
import type { PrismaClient } from "@/generated/prisma/client";

export type TenantAdminRole = "operator" | "cashier";
export const TENANT_ADMIN_ROLES: readonly TenantAdminRole[] = ["operator", "cashier"];

export type TenantAdminRecord = { passwordHash: string; disabledAt: Date | null; role: TenantAdminRole };

/** Логин оператора арендатора: латиница, цифры, точка, дефис, подчёркивание. */
export const ADMIN_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,39}$/;
export const ADMIN_PASSWORD_MIN_LENGTH = 16;

/** Поиск логина в рамках арендатора. Чужой арендатор с тем же логином — другая строка, поэтому пароли не пересекаются. */
export async function findTenantAdmin(prisma: PrismaClient, tenantSlug: string, username: string): Promise<TenantAdminRecord | null> {
  const row = await prisma.tenantAdmin.findUnique({ where: { tenantSlug_username: { tenantSlug, username } } });
  return row ? { passwordHash: row.passwordHash, disabledAt: row.disabledAt, role: row.role } : null;
}

export type SaveResult = { username: string; password: string; created: boolean; role: TenantAdminRole };

/**
 * Создаёт логин или меняет пароль существующего (и снимает отключение). Пароль не задан — генерируется;
 * возвращается один раз, чтобы выдать клиенту: в БД лежит только хеш.
 */
export async function saveTenantAdmin(
  prisma: PrismaClient,
  input: { tenantSlug: string; username: string; password?: string; role?: TenantAdminRole }
): Promise<SaveResult> {
  if (input.role !== undefined && !TENANT_ADMIN_ROLES.includes(input.role)) throw new Error(`Роль: ${TENANT_ADMIN_ROLES.join(" или ")}`);
  if (!ADMIN_USERNAME_PATTERN.test(input.username)) throw new Error("Логин: 2–40 символов, латиница в нижнем регистре, цифры, «.», «-», «_»");
  const password = input.password ?? generatePassword();
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) throw new Error(`Пароль короче ${ADMIN_PASSWORD_MIN_LENGTH} символов`);
  const passwordHash = await hashPassword(password);
  const existing = await prisma.tenantAdmin.findUnique({ where: { tenantSlug_username: { tenantSlug: input.tenantSlug, username: input.username } } });
  await prisma.tenantAdmin.upsert({
    where: { tenantSlug_username: { tenantSlug: input.tenantSlug, username: input.username } },
    create: { tenantSlug: input.tenantSlug, username: input.username, passwordHash, role: input.role ?? "operator" },
    // Роль меняется только явным --role: смена пароля существующего логина её не сбрасывает.
    update: { passwordHash, disabledAt: null, ...(input.role ? { role: input.role } : {}) }
  });
  return { username: input.username, password, created: !existing, role: input.role ?? existing?.role ?? "operator" };
}

/** Отключает логин (строка остаётся для аудита). `false`, если такого логина нет. */
export async function disableTenantAdmin(prisma: PrismaClient, tenantSlug: string, username: string): Promise<boolean> {
  const result = await prisma.tenantAdmin.updateMany({ where: { tenantSlug, username, disabledAt: null }, data: { disabledAt: new Date() } });
  return result.count > 0;
}

export async function listTenantAdmins(prisma: PrismaClient, tenantSlug: string): Promise<Array<{ username: string; role: TenantAdminRole; createdAt: Date; disabledAt: Date | null }>> {
  const rows = await prisma.tenantAdmin.findMany({ where: { tenantSlug }, orderBy: { createdAt: "asc" } });
  return rows.map(({ username, role, createdAt, disabledAt }) => ({ username, role, createdAt, disabledAt }));
}
