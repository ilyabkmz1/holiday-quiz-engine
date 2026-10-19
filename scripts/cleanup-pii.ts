import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { cleanupAdventPii, parseRetentionDays } from "../src/server/advent-pii";
import { PrismaAdventRepository } from "../src/server/repositories/prisma-advent-repository";
import { getTenants, isAdventTenant } from "../src/server/tenants";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.CONFIRM_PII_DELETION !== "DELETE_QUIZ_PII") {
  throw new Error("Set CONFIRM_PII_DELETION=DELETE_QUIZ_PII to confirm the operation");
}

const cutoff = new Date(process.env.PII_CREATED_BEFORE ?? "2027-04-01T00:00:00+03:00");
if (Number.isNaN(cutoff.getTime())) throw new Error("PII_CREATED_BEFORE must be a valid date");
// Адвент: email и согласия хранятся до claimEndsAt + ADVENT_PII_RETENTION_DAYS (по умолчанию 30 суток).
const retentionDays = parseRetentionDays(process.env.ADVENT_PII_RETENTION_DAYS);
const advents = getTenants().filter(isAdventTenant).map((tenant) => tenant.advent);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const result = await prisma.prizeClaim.deleteMany({ where: { createdAt: { lt: cutoff } } });
  console.info(JSON.stringify({ event: "pii_cleanup_completed", deletedClaims: result.count, cutoff: cutoff.toISOString() }));
  const advent = await cleanupAdventPii(new PrismaAdventRepository(prisma), advents, new Date(), retentionDays);
  console.info(JSON.stringify({ event: "advent_pii_cleanup_completed", retentionDays, ...advent }));
} finally {
  await prisma.$disconnect();
}
