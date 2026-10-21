-- A7: рейтинг команд и метрики. Аддитивно: только индекс.
CREATE INDEX "Participant_campaignSlug_teamId_idx" ON "Participant"("campaignSlug", "teamId");
