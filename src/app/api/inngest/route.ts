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

import {
    competitorAlertsSiteJob,
    indexingSiteJob,
    weeklyAutoReauditJob,
    backlinksSiteJob,
} from "@/lib/inngest/functions/cron-workers";

import { rankTrackerSiteJob } from "@/lib/inngest/functions/rank-tracker";
import {
    trackedRankCheckerSiteJob,
    trackedRankCheckerCronJob,
} from "@/lib/inngest/functions/tracked-rank-checker";

import {
    runCitationGapOnDemand,
    runCitationGapWeekly,
} from "@/lib/inngest/functions/citation-gap";

import { internalLinksOnPublishJob } from "@/lib/inngest/functions/internal-links-on-publish";
import { blogCitationMonitorJob } from "@/lib/inngest/functions/blog-citation-monitor";

import { backlinkCheckSite } from "@/lib/inngest/functions/backlinks";
import { rankAlertCheckerJob } from "@/lib/inngest/functions/rank-alert-checker";
import { weeklyDigestJob } from "@/lib/inngest/functions/weekly-digest";
import { githubAutofixSiteJob } from "@/lib/inngest/functions/github-autofix";
import { detectCategoryJob, discoverMarketJob } from "@/lib/inngest/functions/intelligence-jobs";

import {
    weeklyCompetitorRefreshJob,
    singleCompetitorRefreshJob,
    weeklyCompetitorAlertsJob,
} from "@/lib/inngest/functions/competitor-refresh-cron";
import { competitorVelocityJob } from "@/lib/inngest/functions/competitor-velocity";

import {
    queryDiscoveryOrchestrator,
    queryDiscoverySiteJob,
} from "@/lib/inngest/functions/query-discovery";

// IMPORTANT: every function that handles a fan-out child event MUST be
// registered here or Inngest will silently drop those events.
export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        generateBlogJob,
        publishBlogToCmsJob,
        // Daily blog auto-generation cron (06:00 UTC)
        cronDailyBlog,
        // Post-publish hooks (blog.published event)
        internalLinksOnPublishJob,
        blogCitationMonitorJob,

        runAeoAuditJob,
        runAeoRankJob,
        weeklyAeoTracker,
        processAeoSiteJob,
        aeoScoreDropAlert,
        cronWeeklyAeo,              // weekly AEO fan-out cron (Mon 05:00 UTC)

        runWeeklyAuditJob,
        auditPostFixJob,
        weeklyAutoReauditJob,       // weekly re-audit cron (Mon 06:00 UTC)
        cronWeeklyAudit,            // weekly audit fan-out cron (Mon 02:00 UTC)

        processManualAuditJob,

        // IMPORTANT: must be registered or events are silently dropped
        runPageAuditJob,
        processPageAuditJob,

        rankTrackerSiteJob,         // event: rank.tracker.site + cron 04:00 UTC
        rankAlertCheckerJob,        // listens rank.tracker.site — rank drop/win alerts
        trackedRankCheckerSiteJob,  // fan-out child: tracked.rank.check.site
        trackedRankCheckerCronJob,  // daily cron trigger (06:00 UTC)
        cronDailyRankTracker,       // fan-out cron (04:00 UTC)

        backlinkCheckSite,          // event: backlinks.check.site + Mon 03:00 UTC cron
        backlinksSiteJob,           // fan-out child: backlinks.check.site — must be registered
        cronWeeklyBacklinks,        // weekly backlinks fan-out cron (Mon 03:00 UTC)

        analyseCompetitorPageJob,
        competitorAlertsSiteJob,    // event: competitor.alerts.site
        singleCompetitorRefreshJob, // event: competitor.refresh.single
        weeklyCompetitorRefreshJob, // weekly cron (Tue 05:00 UTC)
        weeklyCompetitorAlertsJob,  // weekly cron (Tue 06:00 UTC)
        competitorVelocityJob,      // weekly cron (Mon 04:30 UTC)
        cronWeeklyCompetitorAlerts, // fan-out cron (Mon 07:00 UTC)

        runCitationGapOnDemand,     // event: aeo/citation-gap.requested
        runCitationGapWeekly,       // weekly cron (Wed 06:00 UTC)

        indexingSiteJob,            // event: indexing.submit.site

        monitorGsovJob,
        processGsovSiteJob,

        monitorGscAnomaliesJob,
        processGscSiteJob,

        sendWeeklyDigestJob,
        weeklyDigestJob,            // cron Mon 07:00 UTC
        generatePlannerBriefJob,

        queryDiscoveryOrchestrator, // daily cron (02:00 UTC)
        queryDiscoverySiteJob,      // fan-out child: query.discovery.site

        freshnessDecayCron,

        computeBenchmarksJob,

        measureHealingOutcomesJob,

        runFullStrategyJob,

        uptimeMonitorJob,
        uptimeSiteCheckerJob,       // fan-out child: must be registered

        // IMPORTANT: Scheduled via Inngest cron ONLY. Do NOT add a matching
        // entry in vercel.json — double-scheduling resets credits twice per month.
        creditsResetJob,

        cronMonthlyRateLimitCleanup,

        runFreeAuditJob,
        sendFreeReportEmailJob,     // triggered by email/free-report.send event

        fireLeadWebhookJob,
        leadDripSequenceJob,
        magicFirstAuditJob,         // triggered by user.registered event

        // IMPORTANT: checkOneQueryJob is a fan-out child — must be registered
        // or aeo/query-library.check-one events are silently dropped.
        initQueryLibraryJob,
        runQueryLibraryWeekly,
        runQueryLibrarySite,
        checkOneQueryJob,

        // IMPORTANT: must be registered or serp-gap/requested events are dropped
        runSerpGapAnalysisJob,

        runKeywordSerpAnalysisJob,      // event: serp-analysis/requested
        cronWeeklySerpAnalysis,         // weekly re-run cron (Sat 08:00 UTC)

        githubAutofixSiteJob,       // event: github.autofix.site

        detectCategoryJob,          // event: intelligence/detect.category
        discoverMarketJob,          // event: intelligence/discover.market
    ],
});