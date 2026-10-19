import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { loadTenants, tenantCore } from "../src/server/tenants";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  // Все пакеты из tenants/ (квизы и адвенты): у каждого своя кампания (slug) в общей БД.
  for (const campaign of loadTenants().map(tenantCore)) {
    await prisma.campaign.upsert({
      where: { slug: campaign.slug },
      update: { title: campaign.title, configVersion: 1 },
      create: { slug: campaign.slug, title: campaign.title, configVersion: 1 }
    });
  }
} finally {
  await prisma.$disconnect();
}
