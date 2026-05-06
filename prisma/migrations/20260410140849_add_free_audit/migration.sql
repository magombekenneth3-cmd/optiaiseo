-- CreateTable
CREATE TABLE "FreeAudit" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "overallScore" INTEGER,
    "categoryScores" JSONB,
    "topRecs" JSONB,
    "allRecs" JSONB,
    "errorMsg" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeAuditLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeAuditLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceSession" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "transcript" JSONB,
    "summary" TEXT,
    "actionsLog" JSONB,

    CONSTRAINT "VoiceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreeAudit_domain_idx" ON "FreeAudit"("domain");

-- CreateIndex
CREATE INDEX "FreeAudit_expiresAt_idx" ON "FreeAudit"("expiresAt");

-- CreateIndex
CREATE INDEX "FreeAuditLead_email_idx" ON "FreeAuditLead"("email");

-- CreateIndex
CREATE INDEX "FreeAuditLead_auditId_idx" ON "FreeAuditLead"("auditId");

-- CreateIndex
CREATE INDEX "VoiceSession_siteId_startedAt_idx" ON "VoiceSession"("siteId", "startedAt");

-- CreateIndex
CREATE INDEX "VoiceSession_userId_idx" ON "VoiceSession"("userId");

-- AddForeignKey
ALTER TABLE "FreeAuditLead" ADD CONSTRAINT "FreeAuditLead_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "FreeAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceSession" ADD CONSTRAINT "VoiceSession_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceSession" ADD CONSTRAINT "VoiceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
