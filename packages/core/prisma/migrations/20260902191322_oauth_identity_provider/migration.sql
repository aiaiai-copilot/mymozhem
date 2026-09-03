-- CreateTable
CREATE TABLE "identity"."IdentityProvider" (
    "id" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityProvider_identityId_idx" ON "identity"."IdentityProvider"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityProvider_provider_subject_key" ON "identity"."IdentityProvider"("provider", "subject");

-- AddForeignKey
ALTER TABLE "identity"."IdentityProvider" ADD CONSTRAINT "IdentityProvider_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "identity"."Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
