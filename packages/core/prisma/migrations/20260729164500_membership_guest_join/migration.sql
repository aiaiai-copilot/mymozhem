/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Room` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "membership";

-- CreateEnum
CREATE TYPE "room"."RoomJoinPolicy" AS ENUM ('guests', 'registered', 'invite_only');

-- CreateEnum
CREATE TYPE "membership"."MemberRole" AS ENUM ('ORGANIZER', 'MODERATOR', 'PARTICIPANT', 'SPECTATOR');

-- AlterTable
ALTER TABLE "identity"."Identity" ADD COLUMN     "displayName" TEXT;

-- AlterTable
ALTER TABLE "room"."Room" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "joinPolicy" "room"."RoomJoinPolicy" NOT NULL DEFAULT 'guests';

-- CreateTable
CREATE TABLE "membership"."Membership" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "role" "membership"."MemberRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_roomId_identityId_key" ON "membership"."Membership"("roomId", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "room"."Room"("code");

-- AddForeignKey
ALTER TABLE "membership"."Membership" ADD CONSTRAINT "Membership_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "room"."Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership"."Membership" ADD CONSTRAINT "Membership_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Рукописная часть (практика REQ-DEV-006): ровно один ORGANIZER-membership на
-- комнату (design §2). PARTICIPANT/SPECTATOR/MODERATOR не ограничиваются.
CREATE UNIQUE INDEX "Membership_single_organizer_key"
  ON "membership"."Membership" ("roomId")
  WHERE "role" = 'ORGANIZER';
