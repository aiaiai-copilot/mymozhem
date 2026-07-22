-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "realtime";

-- CreateEnum
CREATE TYPE "realtime"."EventVisibility" AS ENUM ('public', 'organizer', 'module-private');

-- CreateTable
CREATE TABLE "realtime"."LogEvent" (
    "roomId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" UUID,
    "visibility" "realtime"."EventVisibility" NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEvent_pkey" PRIMARY KEY ("roomId","seq")
);

-- AddForeignKey
ALTER TABLE "realtime"."LogEvent" ADD CONSTRAINT "LogEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime"."LogEvent" ADD CONSTRAINT "LogEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
