-- AddUniqueConstraint: PageAudit(auditId, pageUrl)
-- This ensures createMany skipDuplicates works correctly on Inngest job retries.
CREATE UNIQUE INDEX IF NOT EXISTS "PageAudit_auditId_pageUrl_key"
ON "PageAudit"("auditId", "pageUrl");
