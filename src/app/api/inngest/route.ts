import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
    generateBlogJob,
    runAeoAuditJob,
    runAeoRankJob,
    runWeeklyAuditJob,
    sendWeeklyDigestJob,
    monitorGsovJob,
    processGsovSiteJob,
    monitorGscAnomaliesJob,
    processGscSiteJob,
    generatePlannerBriefJob,
    weeklyAeoTracker,
    processAeoSiteJob,
    aeoScoreDropAlert,
    auditPostFixJob,
    publishBlogToCmsJob,
    analyseCompetitorPageJob,
} from "@/lib/inngest/functions";
import { freshnessDecayCron } from "@/lib/inngest/freshness-decay";
import { computeBenchmarksJob } from "@/lib/inngest/functions/benchmarks";
import { measureHealingOutcomesJob } from "@/lib/inngest/functions/healing-outcomes";
import { runFullStrategyJob } from "@/lib/inngest/functions/full-strategy";
import { uptimeMonitorJob, uptimeSiteCheckerJob } from "@/lib/inngest/functions/uptime-monitor";
import { creditsResetJob } from "@/lib/inngest/functions/credits-reset";
import { runFreeAuditJob } from "@/lib/inngest/functions/free-audit";
import { sendFreeReportEmailJob } from "@/lib/inngest/functions/free-report-email";
import { fireLeadWebhookJob } from "@/lib/inngest/functions/lead-webhook";
import { leadDripSequenceJob } from "@/lib/inngest/functions/lead-drip";
import { magicFirstAuditJob } from "@/lib/inngest/functions/magic-first-audit";
import { processManualAuditJob } from "@/lib/inngest/functions/audit";
import { runPageAuditJob, processPageAuditJob } from "@/lib/inngest/functions/page-audit";
import {
    initQueryLibraryJob,
    runQueryLibraryWeekly,
    runQueryLibrarySite,
    checkOneQueryJob,   // Gap 3: fan-out child — must be registered or events are silently dropped
} from "@/lib/inngest/functions/query-library";
import { runSerpGapAnalysisJob } from "@/lib/inngest/functions/serp-gap-analysis";
import { cronMonthlyRateLimitCleanup } from "@/lib/inngest/functions/cron-schedule";

// IMPORTANT: every function that handles a fan-out child event MUST be
// registered here or Inngest will silently drop those events.
export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        // Blog pipeline
        generateBlogJob,
        publishBlogToCmsJob,
        // AEO
        runAeoAuditJob,
        runAeoRankJob,
        weeklyAeoTracker,
        processAeoSiteJob,
        aeoScoreDropAlert,
        // Site audit
        runWeeklyAuditJob,
        auditPostFixJob,
        // Manual audit (dashboard "Run Audit" button — non-blocking)
        processManualAuditJob,
        // Multi-page audit fan-out (IMPORTANT: must be registered or events are silently dropped)
        runPageAuditJob,
        processPageAuditJob,
        // GSoV self-healing
        monitorGsovJob,
        processGsovSiteJob,
        // GSC anomaly detection
        monitorGscAnomaliesJob,
        processGscSiteJob,
        // Email & planner
        sendWeeklyDigestJob,
        generatePlannerBriefJob,
        // Competitor analysis
        analyseCompetitorPageJob,
        // Content freshness
        freshnessDecayCron,
        // Benchmarks (Monday 03:00 UTC)
        computeBenchmarksJob,
        // Healing outcome measurement (daily 4am UTC)
        measureHealingOutcomesJob,
        // Multi-agent parallel strategy orchestration
        runFullStrategyJob,
        // Uptime monitoring — orchestrator fans out to child per site
        uptimeMonitorJob,
        uptimeSiteCheckerJob,   // fan-out child: must be registered or events are dropped
        // Monthly credits reset (1st of month 00:00 UTC)
        // IMPORTANT: Scheduled via Inngest cron only. Do NOT add a matching
        // entry in vercel.json — double-scheduling would reset credits twice per month.
        creditsResetJob,
        // Monthly rate-limit key cleanup (1st of month 00:30 UTC)
        // Runs 30 min after credits reset to avoid Redis contention.
        // Scans all rl:* keys and deletes any whose prefix is no longer active.
        cronMonthlyRateLimitCleanup,
        // Free SEO Check — background audit runner
        runFreeAuditJob,
        // Free SEO Check — report email delivery (capped at 5, 3 retries)
        // IMPORTANT: must be registered — triggered by email/free-report.send event
        sendFreeReportEmailJob,
        // Embed lead webhook delivery (3 retries)
        fireLeadWebhookJob,
        // Lead nurture drip sequence (Days 2, 5, 10 post-signup)
        leadDripSequenceJob,
        // Magic first audit — new user activation email + first audit run
        // IMPORTANT: must be registered — triggered by user.registered event
        magicFirstAuditJob,
        // Query library — Gap 3: fan-out architecture for fast per-query checks
        // IMPORTANT: checkOneQueryJob is a fan-out child — must be registered
        // or aeo/query-library.check-one events are silently dropped by Inngest.
        initQueryLibraryJob,
        runQueryLibraryWeekly,
        runQueryLibrarySite,
        checkOneQueryJob,
        // SERP Gap Analysis — must be registered or serp-gap/requested events are silently dropped
        runSerpGapAnalysisJob,
    ],
});