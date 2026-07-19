-- CreateTable
CREATE TABLE "Sticker" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sticker_objectKey_key" ON "Sticker"("objectKey");

-- CreateIndex
CREATE INDEX "Sticker_serverId_idx" ON "Sticker"("serverId");

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kein Backfill nötig: ManageStickers gehört nicht zu den Standardrechten
-- (Verschicken läuft über SendMessages, das die Standardrolle schon hat).
