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
