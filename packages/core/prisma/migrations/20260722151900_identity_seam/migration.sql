-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateEnum
CREATE TYPE "identity"."IdentityKind" AS ENUM ('REGISTERED', 'GUEST');

-- CreateTable
CREATE TABLE "identity"."Identity" (
    "id" UUID NOT NULL,
    "kind" "identity"."IdentityKind" NOT NULL,
    "email" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- REQ-ID-001 + REQ-DEV-006: registered-email uniqueness is a partial unique index,
-- hand-written (Prisma preview partialIndexes forbidden). lower() because email is
-- case-insensitive; deletedAt IS NULL frees the email after anonymization
-- (REQ-ID-014). The predicate "REGISTERED and not anonymized" also lives in the
-- guarded INSERT of RoomService.create (design §7) — change both or neither.
CREATE UNIQUE INDEX "Identity_registered_email_key"
  ON "identity"."Identity" (lower("email"))
  WHERE "kind" = 'REGISTERED' AND "deletedAt" IS NULL;
