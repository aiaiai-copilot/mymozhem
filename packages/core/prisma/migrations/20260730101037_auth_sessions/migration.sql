-- CreateTable
CREATE TABLE "identity"."Session" (
    "id" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "replacedById" UUID,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "identity"."Session"("refreshTokenHash");

-- AddForeignKey
ALTER TABLE "identity"."Session" ADD CONSTRAINT "Session_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
