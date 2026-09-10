-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "rewards";

-- CreateEnum
CREATE TYPE "rewards"."AwardStatus" AS ENUM ('AWARDED', 'FULFILLED', 'REVOKED');

-- CreateTable
CREATE TABLE "rewards"."Prize" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantityTotal" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards"."Award" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "prizeId" UUID,
    "winnerId" UUID NOT NULL,
    "status" "rewards"."AwardStatus" NOT NULL DEFAULT 'AWARDED',
    "sourceAppId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards"."PointsGrant" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT,
    "sourceAppId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Award_roomId_idx" ON "rewards"."Award"("roomId");

-- CreateIndex
CREATE INDEX "PointsGrant_roomId_identityId_idx" ON "rewards"."PointsGrant"("roomId", "identityId");

-- AddForeignKey
ALTER TABLE "rewards"."Prize" ADD CONSTRAINT "Prize_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards"."Award" ADD CONSTRAINT "Award_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards"."Award" ADD CONSTRAINT "Award_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "rewards"."Prize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards"."Award" ADD CONSTRAINT "Award_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards"."PointsGrant" ADD CONSTRAINT "PointsGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards"."PointsGrant" ADD CONSTRAINT "PointsGrant_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- REQ-RWD-010: ограниченность призового фонда — DB-инвариант (рукописной CHECK;
-- preview-функцию Prisma partialIndexes/checkConstraints НЕ использовать, REQ-DEV-006).
ALTER TABLE rewards."Prize" ADD CONSTRAINT "Prize_quantity_nonnegative" CHECK (quantity >= 0);

-- REQ-RWD-003 + REQ-DEV-006: единичность победителя по активным записям.
-- «Активная» = не отозванная: отзыв освобождает место (приз можно переразыграть),
-- вручённая — нет. Сетевой повтор того же награждения конфликтует по индексу →
-- типизированный no-op в RewardsService (Task 5).
CREATE UNIQUE INDEX "Award_single_active_winner_per_prize_key"
  ON rewards."Award" ("roomId", "prizeId", "winnerId")
  WHERE "status" IN ('AWARDED', 'FULFILLED');
