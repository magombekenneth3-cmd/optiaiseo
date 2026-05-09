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
    checkOneQueryJob,
} from "@/lib/inngest/functions/query-library";
import { runSerpGapAnalysisJob } from "@/lib/inngest/functions/serp-gap-analysis";
import { runKeywordSerpAnalysisJob } from "@/lib/inngest/functions/keyword-serp-analysis";

// ── Cron schedule functions (NEW fan-out architecture) ──────────────────────
// These were exported but never registered → their schedules never fired.
import {
    cronMonthlyRateLimitCleanup,
    cronWeeklyAudit,
    cronWeeklyBacklinks,
    cronDailyRankTracker,
    cronWeeklyAeo,
    cronDailyBlog,
    cronWeeklyCompetitorAlerts,
    cronWeeklySerpAnalysis,
} from "@/lib/inngest/functions/cron-schedule";

// ── Cron-workers: event-listeners + weekly cron ─────────────────────────────
import {
    competitorAlertsSiteJob,
    indexingSiteJob,
    weeklyAutoReauditJob,
} from "@/lib/inngest/functions/cron-workers";

// ── Rank tracking (cron + event fan-out child) ──────────────────────────────
import { rankTrackerSiteJob } from "@/lib/inngest/functions/rank-tracker";
import {
    trackedRankCheckerSiteJob,
    trackedRankCheckerCronJob,
} from "@/lib/inngest/functions/tracked-rank-checker";

// ── Citation gap (on-demand event + weekly cron) ────────────────────────────
import {
    runCitationGapOnDemand,
    runCitationGapWeekly,
} from "@/lib/inngest/functions/citation-gap";

// ── Blog post-publish hooks ──────────────────────────────────────────────────
import { internalLinksOnPublishJob } from "@/lib/inngest/functions/internal-links-on-publish";
import { blogCitationMonitorJob } from "@/lib/inngest/functions/blog-citation-monitor";

// ── Backlink checking (event-triggered) ─────────────────────────────────────
import { backlinkCheckSite } from "@/lib/inngest/functions/backlinks";

// ── Competitor refresh + velocity (cron + event fan-out child) ───────────────
import {
    weeklyCompetitorRefreshJob,
    singleCompetitorRefreshJob,
    weeklyCompetitorAlertsJob,
} from "@/lib/inngest/functions/competitor-refresh-cron";
import { competitorVelocityJob } from "@/lib/inngest/functions/competitor-velocity";

// ── Query discovery (cron orchestrator + per-site child) ────────────────────
import {
    queryDiscoveryOrchestrator,
    queryDiscoverySiteJob,
} from "@/lib/inngest/functions/query-discovery";

// IMPORTANT: every function that handles a fan-out child event MUST be
// registered here or Inngest will silently drop those events.
export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        // ── Blog pipeline ─────────────────────────────────────────────────
        generateBlogJob,
        publishBlogToCmsJob,
        // Daily blog auto-generation cron (06:00 UTC)
        cronDailyBlog,
        // Post-publish hooks (blog.published event)
        internalLinksOnPublishJob,
        blogCitationMonitorJob,

        // ── AEO ──────────────────────────────────────────────────────────
        runAeoAuditJob,
        runAeoRankJob,
        weeklyAeoTracker,
        processAeoSiteJob,
        aeoScoreDropAlert,
        cronWeeklyAeo,              // weekly AEO fan-out cron (Mon 05:00 UTC)

        // ── Site audit ───────────────────────────────────────────────────
        runWeeklyAuditJob,
        auditPostFixJob,
        weeklyAutoReauditJob,       // weekly re-audit cron (Mon 06:00 UTC)
        cronWeeklyAudit,            // weekly audit fan-out cron (Mon 02:00 UTC)

        // ── Manual audit (dashboard "Run Audit" button — non-blocking) ───
        processManualAuditJob,

        // ── Multi-page audit fan-out ─────────────────────────────────────
        // IMPORTANT: must be registered or events are silently dropped
        runPageAuditJob,
        processPageAuditJob,

        // ── Rank tracking ────────────────────────────────────────────────
        rankTrackerSiteJob,         // event: rank.tracker.site + cron 04:00 UTC
        trackedRankCheckerSiteJob,  // fan-out child: tracked.rank.check.site
        trackedRankCheckerCronJob,  // daily cron trigger (06:00 UTC)
        cronDailyRankTracker,       // fan-out cron (04:00 UTC)

        // ── Backlinks ────────────────────────────────────────────────────
        backlinkCheckSite,          // event: backlinks.check.site + Mon 03:00 UTC cron
        cronWeeklyBacklinks,        // weekly backlinks fan-out cron (Mon 03:00 UTC)

        // ── Competitor analysis ──────────────────────────────────────────
        analyseCompetitorPageJob,
        competitorAlertsSiteJob,    // event: competitor.alerts.site
        singleCompetitorRefreshJob, // event: competitor.refresh.single
        weeklyCompetitorRefreshJob, // weekly cron (Tue 05:00 UTC)
        weeklyCompetitorAlertsJob,  // weekly cron (Tue 06:00 UTC)
        competitorVelocityJob,      // weekly cron (Mon 04:30 UTC)
        cronWeeklyCompetitorAlerts, // fan-out cron (Mon 07:00 UTC)

        // ── Citation gap ─────────────────────────────────────────────────
        runCitationGapOnDemand,     // event: aeo/citation-gap.requested
        runCitationGapWeekly,       // weekly cron (Wed 06:00 UTC)

        // ── Indexing ─────────────────────────────────────────────────────
        indexingSiteJob,            // event: indexing.submit.site

        // ── GSoV self-healing ────────────────────────────────────────────
        monitorGsovJob,
        processGsovSiteJob,

        // ── GSC anomaly detection ────────────────────────────────────────
        monitorGscAnomaliesJob,
        processGscSiteJob,

        // ── Email & planner ──────────────────────────────────────────────
        sendWeeklyDigestJob,
        generatePlannerBriefJob,

        // ── Query discovery (cron + fan-out child) ───────────────────────
        queryDiscoveryOrchestrator, // daily cron (02:00 UTC)
        queryDiscoverySiteJob,      // fan-out child: query.discovery.site

        // ── Content freshness ────────────────────────────────────────────
        freshnessDecayCron,

        // ── Benchmarks (Monday 03:00 UTC) ────────────────────────────────
        computeBenchmarksJob,

        // ── Healing outcome measurement (daily 4am UTC) ──────────────────
        measureHealingOutcomesJob,

        // ── Multi-agent strategy orchestration ───────────────────────────
        runFullStrategyJob,

        // ── Uptime monitoring ────────────────────────────────────────────
        uptimeMonitorJob,
        uptimeSiteCheckerJob,       // fan-out child: must be registered

        // ── Monthly credits reset (1st of month 00:00 UTC) ───────────────
        // IMPORTANT: Scheduled via Inngest cron ONLY. Do NOT add a matching
        // entry in vercel.json — double-scheduling resets credits twice per month.
        creditsResetJob,

        // ── Monthly rate-limit key cleanup (1st of month 00:30 UTC) ──────
        cronMonthlyRateLimitCleanup,

        // ── Free SEO Check ───────────────────────────────────────────────
        runFreeAuditJob,
        sendFreeReportEmailJob,     // triggered by email/free-report.send event

        // ── Lead & onboarding ────────────────────────────────────────────
        fireLeadWebhookJob,
        leadDripSequenceJob,
        magicFirstAuditJob,         // triggered by user.registered event

        // ── Query library (fan-out architecture) ─────────────────────────
        // IMPORTANT: checkOneQueryJob is a fan-out child — must be registered
        // or aeo/query-library.check-one events are silently dropped.
        initQueryLibraryJob,
        runQueryLibraryWeekly,
        runQueryLibrarySite,
        checkOneQueryJob,

        // ── SERP Gap Analysis ────────────────────────────────────────────
        // IMPORTANT: must be registered or serp-gap/requested events are dropped
        runSerpGapAnalysisJob,

        runKeywordSerpAnalysisJob,      // event: serp-analysis/requested
        cronWeeklySerpAnalysis,         // weekly re-run cron (Sat 08:00 UTC)
    ],
});