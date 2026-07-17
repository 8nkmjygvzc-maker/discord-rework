-- Die Tabelle "KeyBackup" existiert bereits aus 20260713004444_banner_and_key_backup,
-- dort aber mit dem alten Backup-Format (salt/nonce/ciphertext). Das neue Format
-- (separater KDF- und Wrapped-Key-Teil) ist damit inkompatibel und alte Blobs sind
-- vom neuen Client nicht lesbar – daher Tabelle verwerfen und neu anlegen.
DROP TABLE IF EXISTS "KeyBackup";

-- CreateTable
CREATE TABLE "KeyBackup" (
    "userId" TEXT NOT NULL,
    "kdfSalt" TEXT NOT NULL,
    "kdfOpsLimit" INTEGER NOT NULL,
    "kdfMemLimit" INTEGER NOT NULL,
    "wrappedKeyNonce" TEXT NOT NULL,
    "wrappedKeyCiphertext" TEXT NOT NULL,
    "blobNonce" TEXT NOT NULL,
    "blobCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyBackup_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "KeyBackup" ADD CONSTRAINT "KeyBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
