-- Операторы клиентов (этап 6): логин и хеш пароля в рамках арендатора. Аддитивно: таблица новая.
CREATE TABLE "TenantAdmin" (
    "id" UUID NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "TenantAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAdmin_tenantSlug_username_key" ON "TenantAdmin"("tenantSlug", "username");
