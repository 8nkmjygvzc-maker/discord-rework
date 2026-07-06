-- Phase 6 (E2EE): Klartext kann nicht rückwirkend verschlüsselt werden –
-- die Bestands-Nachrichten aus Phase 4/5 (Dev-Daten) werden gelöscht.
DELETE FROM "Message";

-- AlterTable: content (Klartext) → ciphertext + nonce + header
ALTER TABLE "Message" DROP COLUMN "content",
ADD COLUMN     "ciphertext" TEXT NOT NULL,
ADD COLUMN     "nonce" TEXT NOT NULL,
ADD COLUMN     "header" JSONB NOT NULL;

-- CreateTable: öffentliche Geräteschlüssel (ein Gerät pro Account, v1)
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "signedPreKey" TEXT NOT NULL,
    "signedPreKeySignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mailbox für verschlüsselte Schlüssel-Umschläge
CREATE TABLE "KeyEnvelope" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_key" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "KeyEnvelope_toUserId_createdAt_idx" ON "KeyEnvelope"("toUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyEnvelope" ADD CONSTRAINT "KeyEnvelope_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyEnvelope" ADD CONSTRAINT "KeyEnvelope_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
