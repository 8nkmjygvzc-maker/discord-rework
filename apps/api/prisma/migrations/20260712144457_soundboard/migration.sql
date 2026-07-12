-- CreateTable
CREATE TABLE "SoundboardSound" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "mimeType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundboardSound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoundboardSound_objectKey_key" ON "SoundboardSound"("objectKey");

-- CreateIndex
CREATE INDEX "SoundboardSound_serverId_idx" ON "SoundboardSound"("serverId");

-- AddForeignKey
ALTER TABLE "SoundboardSound" ADD CONSTRAINT "SoundboardSound_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoundboardSound" ADD CONSTRAINT "SoundboardSound_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: Bestehende Standardrollen bekommen das neue UseSoundboard-Recht
-- (1n << 12n = 4096) – gleiche Semantik wie DEFAULT_ROLE_PERMISSIONS für neue
-- Server. Nur die Standardrolle; individuell angelegte Rollen bleiben unberührt.
UPDATE "Role" SET "permissions" = "permissions" | 4096 WHERE "isDefault" = true;
