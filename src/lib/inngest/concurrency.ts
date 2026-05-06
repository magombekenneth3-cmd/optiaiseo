import { logger } from "@/lib/logger";

/**
 * Single source of truth for Inngest concurrency budgets.
 * All function definitions must reference these constants rather than
 * hard-coding numbers so the total budget is visible and auditable here.
 *
 * Total must remain under INNGEST_CONCURRENCY_CAP (default: 200).
 */
export const CONCURRENCY = {
    auditFull: 5,       // run-weekly-audit
    auditFree: 5,       // run-free-audit          (was 10 — plan cap is 5)
    uptimeMonitor: 5,   // uptime-check-site        (was 10 — plan cap is 5)
    leadWebhook: 5,     // fire-lead-webhook        (was 20 — plan cap is 5)
    competitors: 5,     // analyse-competitor-page
    strategy: 5,        // run-full-strategy
    blog: 5,            // generate-blog
    freshness: 1,       // blog-freshness-decay
    aeo: 5,             // aeo functions (shared: run-aeo-audit, run-aeo-rank, aeo-score-drop-alert)
    freeReportEmail: 5, // send-free-report-email  (new — 2026-04)
    leadDrip: 5,        // lead-drip-sequence      (new — 2026-04)
    magicFirstAudit: 5, // magic-first-audit       (new — 2026-04)
    // Fan-out children — keyed by siteId, share the plan's global slot pool:
    gsovChild: 5,       // process-gsov-site
    gscChild: 5,        // process-gsc-site
    pageAuditChild: 5,  // process-page-audit
    blogCitationChild: 5, // blog-citation-monitor
    competitorVelocity: 5, // competitor-velocity-tracker (weekly cron)
} as const;

// ── Startup budget guard ──────────────────────────────────────────────────────
// Evaluated once at module import time. Catches over-budget configs before
// they cause silent queuing failures in production.
// Default is 200 (generous) — set INNGEST_CONCURRENCY_CAP in your hosting env
// to match your actual Inngest plan limit (e.g. 5 for free, 25 for Pro, etc.)
const CAP = Number(process.env.INNGEST_CONCURRENCY_CAP ?? 200);

// Fan-out children (gsovChild, gscChild, pageAuditChild, blogCitationChild) are excluded —
// they are keyed by siteId/event and share the plan's global slot pool rather
// than consuming a dedicated top-level concurrency budget.
const GLOBAL_POOLS = [
    CONCURRENCY.auditFull,
    CONCURRENCY.auditFree,
    CONCURRENCY.uptimeMonitor,
    CONCURRENCY.leadWebhook,
    CONCURRENCY.competitors,
    CONCURRENCY.strategy,
    CONCURRENCY.blog,
    CONCURRENCY.freshness,
    CONCURRENCY.aeo,
    CONCURRENCY.freeReportEmail,
    CONCURRENCY.leadDrip,
    CONCURRENCY.magicFirstAudit,
];

const total = GLOBAL_POOLS.reduce((a, b) => a + b, 0);

if (total > CAP) {
    logger.warn("[inngest] Concurrency budget exceeded", {
        total,
        cap: CAP,
        overage: total - CAP,
    });
}