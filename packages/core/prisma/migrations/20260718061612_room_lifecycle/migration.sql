-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "room";

-- CreateEnum
CREATE TYPE "room"."RoomStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "room"."Room" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "status" "room"."RoomStatus" NOT NULL DEFAULT 'DRAFT',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- Soft-delete is orthogonal to status (REQ-RT-005): deletion is not a status, and a
-- soft-deleted room can never be ACTIVE. Enforced as a DB invariant (REQ-RWD-010
-- philosophy: constraint, not check-before-write) rather than only in RoomService.
-- Holds unconditionally because every transition guard requires deletedAt IS NULL, so a
-- soft-deleted room can never transition to ACTIVE in the first place.
ALTER TABLE "room"."Room" ADD CONSTRAINT "Room_softdelete_not_active"
  CHECK ("deletedAt" IS NULL OR "status" <> 'ACTIVE');
