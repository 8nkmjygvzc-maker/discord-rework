-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" BIGINT NOT NULL DEFAULT 0,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRole" (
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "MemberRole_pkey" PRIMARY KEY ("userId","serverId","roleId")
);

-- CreateIndex
CREATE INDEX "Role_serverId_idx" ON "Role"("serverId");

-- CreateIndex
CREATE INDEX "MemberRole_roleId_idx" ON "MemberRole"("roleId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_userId_serverId_fkey" FOREIGN KEY ("userId", "serverId") REFERENCES "Membership"("userId", "serverId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: Bestehende Server bekommen ihre Standardrolle ("Mitglied") mit
-- ViewChannels|SendMessages (Bits 0+1 = 3), wie sie createServer ab Phase 5 anlegt.
INSERT INTO "Role" ("id", "serverId", "name", "permissions", "color", "position", "isDefault")
SELECT gen_random_uuid(), s."id", 'Mitglied', 3, NULL, 0, true
FROM "Server" s
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" r WHERE r."serverId" = s."id" AND r."isDefault" = true
);
