import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { runAdventReminders } from "../src/server/advent-reminders-run";
import { sendMail } from "../src/server/mailer";
import { PrismaAdventRepository } from "../src/server/repositories/prisma-advent-repository";
import { parseReminderOptions } from "../src/server/services/reminder-service";
import { getTenants, isAdventTenant } from "../src/server/tenants";

// Напоминания адвента (A5): письма участникам, не открывшим сегодняшний день. Запускается cron раз в 15 минут
// (сервис reminders в deploy/compose.yml). Адреса, ссылки и токены в журнал не пишутся: только счётчики.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error("APP_URL is required");

// SIGTERM/SIGINT (деплой, docker stop): текущее письмо дописывается, следующее не начинается, процесс выходит штатно.
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const tenants = getTenants().filter(isAdventTenant);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
let failed = 0;
try {
  const repository = new PrismaAdventRepository(prisma);
  const reports = await runAdventReminders({
    tenants,
    env: process.env,
    now: () => new Date(),
    appUrl,
    options: parseReminderOptions(process.env),
    repositoryFor: () => repository,
    send: (email, vars) => sendMail("reminder", email, vars),
    shouldStop: () => stopping
  });
  for (const report of reports) {
    failed += report.failed;
    if (report.skipped === "error") process.exitCode = 1;
    console.info(JSON.stringify({ event: "advent_reminders_run", ...report }));
  }
  if (stopping) console.info(JSON.stringify({ event: "advent_reminders_stopped" }));
  if (reports.length === 0) console.info(JSON.stringify({ event: "advent_reminders_run", tenants: 0 }));
} finally {
  await prisma.$disconnect();
}
// Письма, не ушедшие в этот запуск, повторятся в следующий (до REMINDER_MAX_ATTEMPTS): сам запуск при этом успешен.
if (failed > 0) console.warn(JSON.stringify({ event: "advent_reminders_failures", failed }));
