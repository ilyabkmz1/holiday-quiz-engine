-- CreateTable
CREATE TABLE "TaskShown" (
    "sessionId" UUID NOT NULL,
    "taskId" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskShown_pkey" PRIMARY KEY ("sessionId","taskId")
);

-- AddForeignKey
ALTER TABLE "TaskShown" ADD CONSTRAINT "TaskShown_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
