-- Этап A2 адвента: роль логина клиента (оператор / кассир) и индекс поиска выдачи по коду для кассы. Аддитивно.
CREATE TYPE "TenantAdminRole" AS ENUM ('operator', 'cashier');

ALTER TABLE "TenantAdmin" ADD COLUMN "role" "TenantAdminRole" NOT NULL DEFAULT 'operator';

CREATE INDEX "RewardGrant_code_idx" ON "RewardGrant"("code");
