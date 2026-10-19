-- CreateTable
CREATE TABLE "TaskAnswer" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "basePoints" INTEGER NOT NULL,
    "comboBonus" INTEGER NOT NULL,
    "combo" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomEntry" (
    "sessionId" UUID NOT NULL,
    "roomId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomEntry_pkey" PRIMARY KEY ("sessionId","roomId")
);

-- CreateTable
CREATE TABLE "RushRun" (
    "sessionId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "poolOrder" JSONB NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RushRun_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "RushAnswer" (
    "sessionId" UUID NOT NULL,
    "itemId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RushAnswer_pkey" PRIMARY KEY ("sessionId","itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskAnswer_sessionId_taskId_key" ON "TaskAnswer"("sessionId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAnswer_sessionId_seq_key" ON "TaskAnswer"("sessionId", "seq");

-- AddForeignKey
ALTER TABLE "TaskAnswer" ADD CONSTRAINT "TaskAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEntry" ADD CONSTRAINT "RoomEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RushRun" ADD CONSTRAINT "RushRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RushAnswer" ADD CONSTRAINT "RushAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
