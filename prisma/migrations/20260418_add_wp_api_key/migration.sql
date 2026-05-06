-- AlterTable: Add wpApiKey column to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "wpApiKey" TEXT;

-- CreateIndex: Unique index on User.wpApiKey
CREATE UNIQUE INDEX IF NOT EXISTS "User_wpApiKey_key" ON "User"("wpApiKey");

-- CreateIndex: Regular index on User.wpApiKey
CREATE INDEX IF NOT EXISTS "User_wpApiKey_idx" ON "User"("wpApiKey");
