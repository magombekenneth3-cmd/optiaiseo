/**
 * @deprecated Import from "@/lib/inngest/functions" or individual domain files instead.
 * This file is a backward-compat shim pointing to the split functions/ directory.
 *
 * The monolithic functions.ts (46KB, 9 functions) has been split into:
 *   functions/blog.ts        — generateBlogJob
 *   functions/aeo.ts         — runAeoAuditJob, runAeoRankJob, weeklyAeoTracker,
 *                              processAeoSiteJob, aeoScoreDropAlert
 *   functions/audit.ts       — runWeeklyAuditJob, auditPostFixJob, sendWeeklyDigestJob,
 *                              monitorGsovJob, processGsovSiteJob,
 *                              monitorGscAnomaliesJob, processGscSiteJob
 *   functions/planner-cms.ts — generatePlannerBriefJob, publishBlogToCmsJob
 */
export * from "./functions/index";