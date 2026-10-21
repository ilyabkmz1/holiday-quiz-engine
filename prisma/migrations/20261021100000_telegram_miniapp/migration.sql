-- Telegram Mini App для адвента. Аддитивно: новый необязательный столбец и две новые таблицы.
ALTER TABLE "Participant" ADD COLUMN "platform" TEXT;

CREATE TABLE "ParticipantIdentity" (
  "id" UUID NOT NULL,
  "campaignSlug" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "subjectHash" TEXT NOT NULL,
  "participantId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParticipantIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParticipantIdentity_campaignSlug_platform_subjectHash_key" ON "ParticipantIdentity"("campaignSlug", "platform", "subjectHash");
CREATE INDEX "ParticipantIdentity_participantId_idx" ON "ParticipantIdentity"("participantId");
ALTER TABLE "ParticipantIdentity" ADD CONSTRAINT "ParticipantIdentity_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdventSourceVisit" (
  "campaignSlug" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "opens" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AdventSourceVisit_pkey" PRIMARY KEY ("campaignSlug", "source", "date")
);
