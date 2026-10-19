-- CreateEnum
CREATE TYPE "GrantSource" AS ENUM ('day', 'luck', 'goal', 'comeback', 'endowed');

-- CreateEnum
CREATE TYPE "GrantStatus" AS ENUM ('issued', 'redeemed');

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "campaignSlug" TEXT NOT NULL,
    "accessKeyHash" TEXT NOT NULL,
    "normalizedEmail" TEXT,
    "teamId" TEXT,
    "consentAt" TIMESTAMP(3),
    "marketingConsentAt" TIMESTAMP(3),
    "reminderOptIn" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantKey" (
    "accessKeyHash" TEXT NOT NULL,
    "participantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipantKey_pkey" PRIMARY KEY ("accessKeyHash")
);

-- CreateTable
CREATE TABLE "DayOpen" (
    "participantId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "onTime" BOOLEAN NOT NULL,

    CONSTRAINT "DayOpen_pkey" PRIMARY KEY ("participantId","day")
);

-- CreateTable
CREATE TABLE "DayBlockResult" (
    "participantId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "blockIndex" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayBlockResult_pkey" PRIMARY KEY ("participantId","day","blockIndex")
);

-- CreateTable
CREATE TABLE "RewardGrant" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 0,
    "source" "GrantSource" NOT NULL,
    "rewardId" TEXT NOT NULL,
    "code" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "GrantStatus" NOT NULL DEFAULT 'issued',
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardCode" (
    "campaignSlug" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "grantId" UUID
);

-- CreateTable
CREATE TABLE "RewardStock" (
    "campaignSlug" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "left" INTEGER NOT NULL,

    CONSTRAINT "RewardStock_pkey" PRIMARY KEY ("campaignSlug","rewardId")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "tokenHash" TEXT NOT NULL,
    "participantId" UUID NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "marketingConsentAt" TIMESTAMP(3),
    "reminderOptIn" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "participantId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "clickedAt" TIMESTAMP(3),

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("participantId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_accessKeyHash_key" ON "Participant"("accessKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_unsubscribeHash_key" ON "Participant"("unsubscribeHash");

-- CreateIndex
CREATE INDEX "Participant_campaignSlug_idx" ON "Participant"("campaignSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_campaignSlug_normalizedEmail_key" ON "Participant"("campaignSlug", "normalizedEmail");

-- CreateIndex
CREATE INDEX "ParticipantKey_participantId_idx" ON "ParticipantKey"("participantId");

-- CreateIndex
CREATE INDEX "RewardGrant_participantId_idx" ON "RewardGrant"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_participantId_source_day_key" ON "RewardGrant"("participantId", "source", "day");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCode_grantId_key" ON "RewardCode"("grantId");

-- CreateIndex
CREATE INDEX "RewardCode_campaignSlug_rewardId_grantId_idx" ON "RewardCode"("campaignSlug", "rewardId", "grantId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardCode_campaignSlug_code_key" ON "RewardCode"("campaignSlug", "code");

-- CreateIndex
CREATE INDEX "LoginToken_participantId_idx" ON "LoginToken"("participantId");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_campaignSlug_fkey" FOREIGN KEY ("campaignSlug") REFERENCES "Campaign"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantKey" ADD CONSTRAINT "ParticipantKey_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayOpen" ADD CONSTRAINT "DayOpen_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayBlockResult" ADD CONSTRAINT "DayBlockResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardCode" ADD CONSTRAINT "RewardCode_campaignSlug_fkey" FOREIGN KEY ("campaignSlug") REFERENCES "Campaign"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardCode" ADD CONSTRAINT "RewardCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "RewardGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardStock" ADD CONSTRAINT "RewardStock_campaignSlug_fkey" FOREIGN KEY ("campaignSlug") REFERENCES "Campaign"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginToken" ADD CONSTRAINT "LoginToken_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

