-- Anwesenheits-Status (Feature-Runde nach Phase 15): ONLINE / DND (Nicht
-- stören, unterdrückt Benachrichtigungen) / INVISIBLE (erscheint offline).
-- CreateEnum
CREATE TYPE "PresenceMode" AS ENUM ('ONLINE', 'DND', 'INVISIBLE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "presence" "PresenceMode" NOT NULL DEFAULT 'ONLINE';
