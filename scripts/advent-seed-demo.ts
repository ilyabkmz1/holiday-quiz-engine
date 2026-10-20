// Демо-данные адвента для показа клиенту: `npm run advent:seed-demo -- <slug> [--participants 400] [--seed 1] [--through <ISO>] [--wipe | --append]`.
// Только для пакетов с `demo: true` и только вне боевого режима (локально, закрытый стенд). Синтетические участники без реальных
// адресов (seed.example.test; напоминания им не уходят). Повторный запуск на непустой кампании отказывает; `--wipe` стирает участников
// этой демо-кампании и начинает заново, `--append` добавляет к существующим (нужно другое `--seed`: адреса зависят от зерна).
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { isPreviewEnvironment } from "../src/server/env";
import { PrismaAdventRepository } from "../src/server/repositories/prisma-advent-repository";
import { AdventService } from "../src/server/services/advent-service";
import { RewardService } from "../src/server/services/reward-service";
import { getTenants, isAdventTenant } from "../src/server/tenants";
import { resolveRewardSecret } from "../src/server/launch-checks";
import { seedDemoAdvent } from "../src/tools/advent-seed-demo";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const slug = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const USAGE = "Использование: npm run advent:seed-demo -- <slug> [--participants 400] [--seed 1] [--through <ISO 8601 со смещением>] [--wipe | --append]";
const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

if (!slug || !TENANT_SLUG_PATTERN.test(slug)) fail(USAGE);
const tenant = getTenants().find((candidate) => candidate.tenant === slug);
if (!tenant || !isAdventTenant(tenant)) fail(`Пакет «${slug}» — не адвент или не найден в tenants/index.ts.`);
if (!isAdventTenant(tenant!) || tenant!.demo !== true) fail(`Пакет «${slug}» не помечен demo: true: демо-данные в боевой пакет не заливаются.`);
// Полный разбор окружения приложения (SMTP и прочее) скрипту не нужен: берём только то, что решает, боевой ли это режим.
const env = {
  NODE_ENV: (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" ? process.env.NODE_ENV : "development") as "development" | "test" | "production",
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  QUIZ_LOCAL_STACK: process.env.QUIZ_LOCAL_STACK === "true",
  STAGING_USERNAME: process.env.STAGING_USERNAME || undefined,
  STAGING_PASSWORD: process.env.STAGING_PASSWORD || undefined,
  REWARD_QR_SECRET: process.env.REWARD_QR_SECRET
};
if (!isPreviewEnvironment(env)) fail("Это боевой режим (NODE_ENV=production без закрытого стенда): демо-данные не заливаются.");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required");

const participants = Number(flag("participants") ?? 400);
const seed = Number(flag("seed") ?? 1);
if (!Number.isInteger(participants) || participants < 1 || participants > 20000) fail("--participants: целое от 1 до 20000");
if (!Number.isInteger(seed)) fail("--seed: целое число");
const advent = isAdventTenant(tenant!) ? tenant!.advent : fail("unreachable");
const through = flag("through") ? new Date(flag("through")!) : new Date(advent.schedule.finaleAt);
if (Number.isNaN(through.getTime())) fail("--through: дата и время ISO 8601 со смещением, например 2026-12-26T12:00:00+03:00");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const existing = await prisma.participant.count({ where: { campaignSlug: advent.slug } });
  if (args.includes("--wipe") && args.includes("--append")) fail("--wipe и --append несовместимы.");
  if (existing > 0 && !args.includes("--wipe") && !args.includes("--append")) fail(`В кампании «${advent.slug}» уже есть участники (${existing}). Добавьте --wipe, чтобы стереть их и заполнить заново, или --append, чтобы добавить других (с новым --seed).`);
  await prisma.campaign.upsert({ where: { slug: advent.slug }, update: {}, create: { slug: advent.slug, title: advent.title } });
  if (existing > 0 && args.includes("--wipe")) {
    // Каскад уберёт открытия, результаты, выдачи и доставки; коды освободятся, остатки сбросятся.
    await prisma.participant.deleteMany({ where: { campaignSlug: advent.slug } });
    await prisma.rewardStock.deleteMany({ where: { campaignSlug: advent.slug } });
  }
  const repository = new PrismaAdventRepository(prisma);
  const rewards = new RewardService(repository, advent, { qrSecret: resolveRewardSecret(env), baseUrl: "https://demo.example.test" });
  const service = new AdventService(repository, advent, rewards);
  const report = await seedDemoAdvent({ repository, service, advent }, { participants, seed, through });
  console.info(JSON.stringify({ event: "advent_seed_demo", tenant: advent.slug, seed, ...report, decay: Math.round(report.decay * 100) / 100 }));
  console.info(`Готово: ${report.participants} участников (из них ${report.verified} с подтверждённым email), ${report.opens} открытий, ${report.redeemed} погашений. Спад к финалу ≈ ${Math.round(report.decay * 100)}%.`);
  console.info("Панель и отчёт на дату: /admin?asOf=<ISO> и /admin/report?asOf=<ISO> (для демо-пакетов).");
} finally {
  await prisma.$disconnect();
}
