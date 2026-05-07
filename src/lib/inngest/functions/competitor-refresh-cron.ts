/**
 * src/lib/inngest/functions/competitor-refresh-cron.ts
 *
 * Weekly cron: auto-refreshes competitor keyword gaps for all paid sites
 * and fans out competitor alert checks.
 *
 * Schedule:
 *   - Keyword refresh: every Tuesday 05:00 UTC
 *   - Alert fan-out:   every Tuesday 06:00 UTC (after refresh)
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { CONCURRENCY } from "../concurrency";

// ── Local types ───────────────────────────────────────────────────────────────

type SiteRow = { id: string; domain: string; competitors: { id: string; domain: string }[] };
type AlertSiteRow = { id: string; domain: string };

// ── 1. Weekly keyword gap auto-refresh ───────────────────────────────────────

export const weeklyCompetitorRefreshJob = inngest.createFunction(
  {
    id: "weekly-competitor-keyword-refresh",
    name: "Weekly Competitor Keyword Gap Refresh",
    concurrency: { limit: CONCURRENCY.competitors },
    retries: 1,
    triggers: [{ cron: "0 5 * * 2" }], // Every Tuesday 05:00 UTC
  },
  async ({ step }) => {
    // Only refresh paid sites — free tier gets manual-only refresh
    const sites = await step.run("load-paid-sites-with-competitors", async () => {
      return prisma.site.findMany({
        where: {
          user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
          competitors: { some: {} },
        },
        select: {
          id: true,
          domain: true,
          competitors: {
            where: { deletedAt: null },
            select: { id: true, domain: true },
          },
        },
      });
    });

    if (sites.length === 0) {
      logger.info("[CompetitorRefreshCron] No paid sites with competitors — skipping");
      return { refreshed: 0 };
    }

    logger.info("[CompetitorRefreshCron] Starting weekly refresh", {
      sites: sites.length,
      totalCompetitors: (sites as SiteRow[]).reduce((s: number, site: SiteRow) => s + site.competitors.length, 0),
    });

    // Fan-out one event per competitor — each handled by the existing
    // refreshCompetitorKeywords action via a new per-competitor Inngest job
    await step.sendEvent(
      "fan-out-competitor-refreshes",
      sites.flatMap((site) =>
        site.competitors.map((comp) => ({
          name: "competitor.refresh.single" as const,
          data: {
            siteId: site.id,
            competitorId: comp.id,
            domain: comp.domain,
            siteDomain: site.domain,
          },
        }))
      )
    );

    return {
      sites: sites.length,
      queued: (sites as SiteRow[]).reduce((s: number, site: SiteRow) => s + site.competitors.length, 0),
    };
  }
);

// ── 2. Per-competitor refresh handler ────────────────────────────────────────

export const singleCompetitorRefreshJob = inngest.createFunction(
  {
    id: "competitor-refresh-single",
    name: "Competitor Keyword Refresh — Single",
    concurrency: [
      { scope: "fn", limit: CONCURRENCY.competitors },
      // Max 1 refresh per site at a time to avoid DataForSEO rate limits
      { scope: "fn", limit: 1, key: "event.data.siteId" },
    ],
    retries: 2,
    triggers: [{ event: "competitor.refresh.single" as const }],
  },
  async ({ event, step }) => {
    const { siteId, competitorId, domain, siteDomain } = event.data as {
      siteId: string;
      competitorId: string;
      domain: string;
      siteDomain: string;
    };

    const result = await step.run("refresh-keywords", async () => {
      // Import here to avoid circular deps at module load
      const { refreshCompetitorKeywords } = await import("@/app/actions/competitors");
      return refreshCompetitorKeywords(siteId, competitorId);
    });

    logger.info("[CompetitorRefreshCron] Single refresh done", {
      siteId,
      competitorId,
      domain,
      siteDomain,
      success: result.success,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: result.success ? (result as any).count ?? 0 : 0,
    });

    return { competitorId, domain, success: result.success };
  }
);

// ── 3. Weekly alert fan-out cron ─────────────────────────────────────────────

export const weeklyCompetitorAlertsJob = inngest.createFunction(
  {
    id: "weekly-competitor-alerts-fanout",
    name: "Weekly Competitor Alerts Fan-out",
    retries: 1,
    triggers: [{ cron: "0 6 * * 2" }], // Every Tuesday 06:00 UTC (1h after refresh)
  },
  async ({ step }) => {
    const sites = await step.run("load-sites-with-competitors", async () => {
      return prisma.site.findMany({
        where: {
          competitors: { some: {} },
          user: { email: { not: null } },
        },
        select: { id: true, domain: true },
      });
    });

    if (sites.length === 0) return { queued: 0 };

    await step.sendEvent(
      "fan-out-competitor-alerts",
      sites.map((site: AlertSiteRow) => ({
        name: "competitor.alerts.site" as const,
        data: { siteId: site.id, domain: site.domain },
      }))
    );

    logger.info("[CompetitorAlerts] Fanned out alert checks", { sites: sites.length });
    return { queued: sites.length };
  }
);
