-- AlterTable
ALTER TABLE "membership"."Membership" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "joinIp" TEXT;

-- CreateTable
CREATE TABLE "membership"."Exclusion" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "excludedBy" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exclusion_roomId_ip_idx" ON "membership"."Exclusion"("roomId", "ip");

-- CreateIndex
CREATE UNIQUE INDEX "Exclusion_roomId_identityId_key" ON "membership"."Exclusion"("roomId", "identityId");

-- AddForeignKey
ALTER TABLE "membership"."Exclusion" ADD CONSTRAINT "Exclusion_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership"."Exclusion" ADD CONSTRAINT "Exclusion_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership"."Exclusion" ADD CONSTRAINT "Exclusion_excludedBy_fkey" FOREIGN KEY ("excludedBy") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
