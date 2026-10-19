import { getPrisma } from "@/server/db";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { PrismaAdventRepository } from "@/server/repositories/prisma-advent-repository";

import { CAMPAIGN, OTHER_CAMPAIGN, describeAdventRepositoryContract } from "../support/advent-repository-contract";

// Тот же набор проверок, что в юнит-тестах, но и на настоящем PostgreSQL: реализации обязаны вести себя одинаково.
describeAdventRepositoryContract("in-memory", async () => new InMemoryAdventRepository());

describeAdventRepositoryContract("prisma/postgres", async () => {
  const prisma = getPrisma();
  for (const slug of [CAMPAIGN, OTHER_CAMPAIGN]) {
    await prisma.campaign.upsert({ where: { slug }, update: {}, create: { slug, title: slug } });
  }
  return new PrismaAdventRepository(prisma);
});
