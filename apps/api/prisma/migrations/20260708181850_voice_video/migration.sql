-- AlterTable
ALTER TABLE "VoiceSession" ADD COLUMN     "cameraOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "screenOn" BOOLEAN NOT NULL DEFAULT false;
