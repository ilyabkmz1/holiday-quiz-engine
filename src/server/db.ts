import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getRuntimeEnv } from "@/server/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const connectionString = getRuntimeEnv().DATABASE_URL;
    // prisma migrate учитывает параметр schema из URL, а PrismaPg — только явную опцию.
    // Без неё запросы шли бы в схему по умолчанию, а миграции — в указанную.
    const schema = new URL(connectionString).searchParams.get("schema") ?? undefined;
    const adapter = new PrismaPg({ connectionString }, { schema });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
