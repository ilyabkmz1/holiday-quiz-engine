// Логин оператора клиента: `npm run quiz:admin -- <slug> [--user ops] [--password …] [--disable] [--list]`.
// Создаёт логин для админки арендатора `<slug>` или меняет пароль существующего. Пароль не задан — генерируется и печатается один раз
// (в БД хранится только хеш scrypt). Нужен DATABASE_URL базы, к которой подключено приложение клиента.
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { ADMIN_USERNAME_PATTERN, TENANT_ADMIN_ROLES, disableTenantAdmin, listTenantAdmins, saveTenantAdmin, type TenantAdminRole } from "../src/server/tenant-admins";
import { packs } from "../tenants/index";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const slug = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const USAGE =
  "Использование: npm run quiz:admin -- <slug> [--user ops] [--password <≥16 символов>] [--role operator|cashier] [--disable] [--list]\n" +
  "  --role cashier — логин кассира: только страница /redeem (адвент); по умолчанию operator (админка).\n" +
  "  без --password пароль генерируется и печатается один раз; повторный запуск с тем же --user меняет пароль.";

if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error(USAGE);
  process.exit(2);
}
if (!(packs as Array<{ tenant?: string }>).some((item) => item.tenant === slug)) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts: логин создаётся только для известного арендатора.`);
  process.exit(2);
}
const username = flag("user") ?? "operator";
if (!ADMIN_USERNAME_PATTERN.test(username)) {
  console.error(`Логин «${username}»: 2–40 символов, латиница в нижнем регистре, цифры, «.», «-», «_».`);
  process.exit(2);
}
const role = flag("role");
if (role !== undefined && !TENANT_ADMIN_ROLES.includes(role as TenantAdminRole)) {
  console.error(`Роль «${role}»: ${TENANT_ADMIN_ROLES.join(" или ")}.`);
  process.exit(2);
}
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Задайте DATABASE_URL базы приложения (например, DATABASE_URL=… npm run quiz:admin -- " + slug + ").");
  process.exit(2);
}

const schema = new URL(connectionString).searchParams.get("schema") ?? undefined;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
try {
  if (has("list")) {
    const rows = await listTenantAdmins(prisma, slug);
    if (rows.length === 0) console.log(`У арендатора ${slug} нет операторов.`);
    for (const row of rows) console.log(`${row.username}\t${row.role}\tсоздан ${row.createdAt.toISOString()}${row.disabledAt ? `\tотключён ${row.disabledAt.toISOString()}` : ""}`);
  } else if (has("disable")) {
    const done = await disableTenantAdmin(prisma, slug, username);
    console.log(done ? `Логин ${username} арендатора ${slug} отключён.` : `Активного логина ${username} у арендатора ${slug} нет.`);
    process.exitCode = done ? 0 : 1;
  } else {
    const result = await saveTenantAdmin(prisma, { tenantSlug: slug, username, password: flag("password"), role: role as TenantAdminRole | undefined });
    console.log(`${result.created ? "Создан" : "Обновлён"} ${result.role === "cashier" ? "кассир" : "оператор"} ${result.username} арендатора ${slug}.`);
    // Пароль печатается только если сгенерирован: заданный вручную человек уже знает.
    if (!flag("password")) console.log(`Пароль (показан один раз, в БД хранится хеш): ${result.password}`);
    console.log(`Вход: https://<домен арендатора>/${result.role === "cashier" ? "redeem" : "admin"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не удалось сохранить оператора");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
