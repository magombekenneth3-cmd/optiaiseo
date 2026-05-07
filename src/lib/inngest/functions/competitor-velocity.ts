/**
 * src/lib/inngest/functions/competitor-velocity.ts
 *
 * Weekly cron: crawls each tracked competitor's sitemap, diffs against last
 * week's snapshot, stores delta in Redis, and fires Slack/Zapier alerts when
 * a competitor's publish rate spikes or significant new pages appear.
 *
 * Redis schema:
 *   vel-snap:{competitorId}:current  → VelocitySnapshot (latest)
 *   vel-snap:{competitorId}:prev     → VelocitySnapshot (previous week)
 *   vel-snap:{competitorId}:history  → Array<{totalPages, snapshotAt}> (last 4)
 *   vel-diff:{siteId}                → VelocityDiff[] (read by API route)
 *
 * Cron: every Monday at 04:30 UTC (staggered from benchmark cron at 03:00 Tue)
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { CONCURRENCY } from "../concurrency";
import {
  fetchCompetitorSitemap,
  extractTopTopics,
  computePublishRate,
  type VelocitySnapshot,
  type VelocityDiff,
} from "@/lib/competitors/content-velocity";
import { dispatchWebhooks } from "@/lib/alerts/webhook-dispatcher";

const APP_URL = (process.env.NEXTAUTH_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
const SNAP_TTL_S  = 60 * 60 * 24 * 14; // 14 days — keep two snapshots warm
const DIFF_TTL_S  = 60 * 60 * 24 * 7;  // 7 days — dashboard reads the diff

/** Minimum new pages to trigger an alert */
const ALERT_NEW_PAGE_THRESHOLD = 3;

export const competitorVelocityJob = inngest.createFunction(
  {
    id: "competitor-velocity-tracker",
    name: "Weekly Competitor Content Velocity Tracker",
    retries: 1,
    concurrency: { limit: CONCURRENCY.competitors },
  
      triggers: [{ cron: "30 4 * * 1" }],
  },
  // Every Monday 04:30 UTC
  async ({ step }) => {
    // ── Step 1: load all sites that have competitors ──────────────────────────
    const sites = await step.run("load-sites", async () => {
      return prisma.site.findMany({
        select: {
          id: true,
          domain: true,
          slackWebhookUrl: true,
          zapierWebhookUrl: true,
          competitors: {
            where: { deletedAt: null },
            select: { id: true, domain: true },
          },
        },
        where: {
          competitors: { some: {} },
        },
      });
    });

    let totalNewPages = 0;
    let alertsFired = 0;

    for (const site of sites) {
      if (site.competitors.length === 0) continue;

      // ── Step 2: crawl each competitor in parallel (capped) ────────────────
      const diffs = await step.run(`crawl-${site.id}`, async () => {
        const results = await Promise.allSettled(
          site.competitors.map(comp => crawlAndDiff(site.id, comp))
        );

        const successfulDiffs: VelocityDiff[] = [];
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            successfulDiffs.push(r.value);
            totalNewPages += r.value.newPages.length;
          }
        }

        // Store the full diff array for the API route
        if (successfulDiffs.length > 0) {
          try {
            await redis.set(`vel-diff:${site.id}`, successfulDiffs, { ex: DIFF_TTL_S });
          } catch {
            // Non-fatal
          }
        }

        return successfulDiffs;
      });

      // ── Step 3: alert if any competitor had a publishing spike ────────────
      const spikedCompetitors = diffs.filter(
        d => d.newPages.length >= ALERT_NEW_PAGE_THRESHOLD,
      );

      if (
        spikedCompetitors.length > 0 &&
        (site.slackWebhookUrl || site.zapierWebhookUrl)
      ) {
        await step.run(`alert-velocity-${site.id}`, async () => {
          const top = spikedCompetitors[0];
          await dispatchWebhooks(
            {
              id: site.id,
              domain: site.domain,
              slackWebhookUrl: site.slackWebhookUrl,
              zapierWebhookUrl: site.zapierWebhookUrl,
            },
            {
              event: "rank_drop", // closest semantic match in existing event types
              summary: `📈 ${site.domain}: ${top.domain} published ${top.newPages.length} new pages this week`,
              details: {
                "Competitor": top.domain,
                "New pages": top.newPages.length,
                "Publish rate (pages/wk)": top.publishRate,
                "Top topics": top.topTopics.join(", ") || "—",
                "Sample new URLs": top.newPages.slice(0, 3).join("\n") || "—",
                "Total competitor pages": top.totalPages,
                "Other active competitors": spikedCompetitors.length - 1,
              },
              dashboardUrl: `${APP_URL}/dashboard/competitors?siteId=${site.id}`,
            },
          );
          alertsFired++;
          logger.info("[Velocity] Alert sent", {
            siteId: site.id,
            domain: site.domain,
            competitor: top.domain,
            newPages: top.newPages.length,
          });
        });
      }
    }

    return { sitesProcessed: sites.length, totalNewPages, alertsFired };
  },
);

// ─── Internal helper ──────────────────────────────────────────────────────────

async function crawlAndDiff(
  siteId: string,
  comp: { id: string; domain: string },
): Promise<VelocityDiff | null> {
  const currentKey  = `vel-snap:${comp.id}:current`;
  const prevKey     = `vel-snap:${comp.id}:prev`;
  const historyKey  = `vel-snap:${comp.id}:history`;

  // Fetch current sitemap
  const pages = await fetchCompetitorSitemap(comp.domain);
  if (pages.length === 0) return null;

  const pageUrls = pages.map(p => p.url);
  const snapshot: VelocitySnapshot = {
    competitorId: comp.id,
    domain: comp.domain,
    totalPages: pageUrls.length,
    pageUrls,
    snapshotAt: new Date().toISOString(),
  };

  // Load previous snapshot for diffing
  let prev: VelocitySnapshot | null = null;
  try {
    prev = await redis.get<VelocitySnapshot>(currentKey);
  } catch {
    // Redis unavailable
  }

  // Rotate snapshots: current → prev, new → current
  try {
    if (prev) {
      await redis.set(prevKey, prev, { ex: SNAP_TTL_S });
    }
    await redis.set(currentKey, snapshot, { ex: SNAP_TTL_S });
  } catch {
    // Non-fatal
  }

  // Update rolling history (last 4 data points)
  try {
    const history = (await redis.get<Array<{ totalPages: number; snapshotAt: string }>>(historyKey)) ?? [];
    history.push({ totalPages: snapshot.totalPages, snapshotAt: snapshot.snapshotAt });
    const trimmed = history.slice(-4);
    await redis.set(historyKey, trimmed, { ex: SNAP_TTL_S });
  } catch {
    // Non-fatal
  }

  // Compute diff
  let newPages: string[] = [];
  let removedPages: string[] = [];

  if (prev) {
    const prevSet = new Set(prev.pageUrls);
    const currSet = new Set(pageUrls);
    newPages     = pageUrls.filter(u => !prevSet.has(u)).slice(0, 50);
    removedPages = prev.pageUrls.filter(u => !currSet.has(u)).slice(0, 20);
  }

  // Compute publish rate from history
  let publishRate = 0;
  try {
    const history = (await redis.get<Array<{ totalPages: number; snapshotAt: string }>>(historyKey)) ?? [];
    publishRate = computePublishRate(history);
  } catch {
    // Non-fatal
  }

  const topTopics = extractTopTopics(newPages.length > 0 ? newPages : pageUrls.slice(0, 200));

  return {
    competitorId: comp.id,
    domain: comp.domain,
    newPages,
    removedPages,
    publishRate,
    totalPages: snapshot.totalPages,
    topTopics,
    diffedAt: new Date().toISOString(),
  };
}
