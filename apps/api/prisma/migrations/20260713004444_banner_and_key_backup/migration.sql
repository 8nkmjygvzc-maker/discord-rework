-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bannerUrl" TEXT;

-- CreateTable
CREATE TABLE "KeyBackup" (
    "userId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyBackup_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "KeyBackup" ADD CONSTRAINT "KeyBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
