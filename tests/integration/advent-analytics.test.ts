import { getPrisma } from "@/server/db";
import { PrismaAdventRepository } from "@/server/repositories/prisma-advent-repository";

import { describeAnalyticsContract } from "../support/advent-analytics-contract";
import { CAMPAIGN, OTHER_CAMPAIGN } from "../support/advent-repository-contract";

// Тот же контракт метрик, что в юнит-тестах, но на настоящем PostgreSQL: SQL-агрегаты обязаны совпасть с памятью.
describeAnalyticsContract("prisma/postgres", async () => {
  const prisma = getPrisma();
  for (const slug of [CAMPAIGN, OTHER_CAMPAIGN]) {
    await prisma.campaign.upsert({ where: { slug }, update: {}, create: { slug, title: slug } });
  }
  return new PrismaAdventRepository(prisma);
});
