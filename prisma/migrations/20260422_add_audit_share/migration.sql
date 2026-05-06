ALTER TABLE "Audit" ADD COLUMN IF NOT EXISTS "shares" TEXT;

CREATE TABLE IF NOT EXISTS "AuditShare" (
    "id"        TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "auditId"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AuditShare_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditShare" DROP CONSTRAINT IF EXISTS "AuditShare_token_key";
ALTER TABLE "AuditShare" ADD CONSTRAINT "AuditShare_token_key" UNIQUE ("token");

CREATE INDEX IF NOT EXISTS "AuditShare_auditId_idx" ON "AuditShare"("auditId");
CREATE INDEX IF NOT EXISTS "AuditShare_token_idx" ON "AuditShare"("token");

ALTER TABLE "AuditShare" DROP CONSTRAINT IF EXISTS "AuditShare_auditId_fkey";
ALTER TABLE "AuditShare" ADD CONSTRAINT "AuditShare_auditId_fkey"
    FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
