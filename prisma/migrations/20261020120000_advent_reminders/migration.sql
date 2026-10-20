-- Этап A5 адвента: напоминания. Аддитивно: новые столбцы с значениями по умолчанию, отправка до записи больше не требует sentAt.
ALTER TABLE "Participant" ADD COLUMN "unsubscribedAt" TIMESTAMP(3);

-- Ссылка входа, выпущенная сервером для подтверждённого адреса (письмо-напоминание).
ALTER TABLE "LoginToken" ADD COLUMN "trusted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ReminderDelivery"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "unsubscribeHash" TEXT,
  ALTER COLUMN "sentAt" DROP NOT NULL;

CREATE UNIQUE INDEX "ReminderDelivery_id_key" ON "ReminderDelivery"("id");
CREATE UNIQUE INDEX "ReminderDelivery_unsubscribeHash_key" ON "ReminderDelivery"("unsubscribeHash");
CREATE INDEX "ReminderDelivery_day_status_idx" ON "ReminderDelivery"("day", "status");
