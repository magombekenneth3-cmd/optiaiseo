// =============================================================================
// SITE ANALYSIS ORCHESTRATOR — Inngest event-driven fan-out
//
// Event: "site-analysis/requested"
// Flow:
//   1. Acquire Redis analysis lock
//   2. Create parent AgentRun (ORCHESTRATOR) — only after lock acquired
//   3. Start background lease heartbeat (auto-renew every 60s)
//   4. Fan-out: Discovery → Crawl → [TechSEO, Indexation, Sitemap, Robots, Links] parallel
//   5. Fan-out: [GSC Intel, GA4 Intel, Keywords, Cannibalization] parallel
//   6. Generate opportunities from findings
//   7. Stop heartbeat + release lock
// =============================================================================

import { inngest } from "@/lib/inngest/client";
import { CONCURRENCY } from "@/lib/inngest/concurrency";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

import { runAgent } from "@/lib/agents/runner";
import {
  acquireAnalysisLock,
  releaseAnalysisLock,
  startLeaseHeartbeat,
  type LeaseHeartbeat,
} from "@/lib/agents/analysis-lock";
import { generateOpportunitiesFromFindings } from "@/lib/opportunity-engine/findings-to-opportunities";

// Agent functions
import { analyzeDiscovery } from "@/lib/agents/discovery";
import { analyzeCrawl } from "@/lib/agents/crawl-agent";
import { analyzeTechnicalSeo } from "@/lib/agents/technical-seo-agent";
import { analyzeIndexation } from "@/lib/agents/indexation-agent";
import { analyzeSitemap } from "@/lib/agents/sitemap-agent";
import { analyzeRobots } from "@/lib/agents/robots-agent";
import { analyzeInternalLinks } from "@/lib/agents/internal-link-agent";
import { analyzeGscIntelligence } from "@/lib/agents/gsc-intelligence-agent";
import { analyzeGa4Intelligence } from "@/lib/agents/ga4-intelligence-agent";
import { analyzeKeywordIntelligence } from "@/lib/agents/keyword-intelligence-agent";
import { analyzeCannibalization } from "@/lib/agents/cannibalization-agent";

import type { CrawlSnapshot } from "@/lib/agents/snapshots";
import type { GscPerformanceRow } from "@/lib/agents/gsc-intelligence-agent";
import type { Ga4PerformanceRow } from "@/lib/agents/ga4-intelligence-agent";

// =============================================================================
// Lease-lost guard — throws if the heartbeat detected a lease loss
// =============================================================================

class LeaseLostError extends Error {
  constructor(siteId: string) {
    super(`Analysis lease lost for site ${siteId} — another run took over`);
    this.name = "LeaseLostError";
  }
}

function guardLease(heartbeat: LeaseHeartbeat | null, siteId: string): void {
  if (heartbeat?.isLost()) {
    throw new LeaseLostError(siteId);
  }
}

// =============================================================================
// Main orchestrator function
// =============================================================================

export const runSiteAnalysis = inngest.createFunction(
  {
    id: "run-site-analysis",
    concurrency: { limit: CONCURRENCY.siteAnalysis },
    retries: 1,
    triggers: [{ event: "site-analysis/requested" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { siteId } = event.data as { siteId: string };

    // 1. Acquire lock FIRST — no DB record created until we own the lock
    //    This eliminates orphan QUEUED/RUNNING records on lock contention.
    const locked = await step.run("acquire-lock", async () => {
      // Generate a temporary token for acquisition; will be replaced by the real runId
      return acquireAnalysisLock(siteId, event.id ?? `temp-${Date.now()}`);
    });

    if (!locked) {
      logger.warn("[SiteAnalysis] Analysis already running, skipping", { siteId });
      return { status: "SKIPPED", reason: "analysis_already_running" };
    }

    // 2. Create orchestrator run AFTER lock acquired (no orphan records possible)
    const orchestratorRunId = await step.run("create-orchestrator-run", async () => {
      const run = await prisma.agentRun.create({
        data: {
          siteId,
          agentType: "ORCHESTRATOR",
          status: "RUNNING",
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      });

      // Re-acquire lock with the real runId as token
      // (replaces the temp token so release/renewal works correctly)
      await releaseAnalysisLock(siteId, event.id ?? `temp-${Date.now()}`);
      await acquireAnalysisLock(siteId, run.id);

      return run.id;
    });

    // 3. Start background heartbeat — auto-renews lease every 60s
    let heartbeat: LeaseHeartbeat | null = null;

    try {
      heartbeat = startLeaseHeartbeat(
        siteId,
        orchestratorRunId,
        orchestratorRunId,
        () => {
          logger.error("[SiteAnalysis] Lease lost callback triggered", { siteId, orchestratorRunId });
        },
      );

      // 4. Load site
      const site = await step.run("load-site", async () => {
        return prisma.site.findUniqueOrThrow({
          where: { id: siteId },
          select: { id: true, domain: true },
        });
      });

      // ─── PHASE 1: Discovery ───────────────────────────────────────────

      guardLease(heartbeat, siteId);

      const discoveryResult = await step.run("agent-discovery", async () => {
        return runAgent("DISCOVERY", siteId, () => analyzeDiscovery(siteId, site.domain), {
          parentRunId: orchestratorRunId,
          triggerEvent: "site-analysis/requested",
        });
      });

      // ─── PHASE 2: Crawl ──────────────────────────────────────────────

      guardLease(heartbeat, siteId);

      const crawlResult = await step.run("agent-crawl", async () => {
        return runAgent("CRAWL", siteId, () => analyzeCrawl(siteId, site.domain, discoveryResult.data), {
          parentRunId: orchestratorRunId,
        });
      });

      // Build CrawlSnapshot for downstream agents
      const crawlSnapshot: CrawlSnapshot = {
        crawlRunId: crawlResult.runId,
        domain: site.domain,
        crawlResult: crawlResult.data.crawlResult,
        linkGraph: crawlResult.data.linkGraph,
        discoveryData: discoveryResult.data,
        capturedAt: new Date().toISOString(),
      };

      // ─── PHASE 3: Crawl-derived analysis (parallel) ──────────────────

      guardLease(heartbeat, siteId);

      const [techSeoResult, indexationResult, sitemapResult, robotsResult, linksResult] =
        await Promise.all([
          step.run("agent-technical-seo", async () => {
            return runAgent("TECHNICAL_SEO", siteId, async () => analyzeTechnicalSeo(siteId, crawlSnapshot), {
              parentRunId: orchestratorRunId,
            });
          }),
          step.run("agent-indexation", async () => {
            return runAgent("INDEXATION", siteId, async () => analyzeIndexation(siteId, crawlSnapshot), {
              parentRunId: orchestratorRunId,
            });
          }),
          step.run("agent-sitemap", async () => {
            return runAgent("SITEMAP", siteId, async () => analyzeSitemap(siteId, crawlSnapshot), {
              parentRunId: orchestratorRunId,
            });
          }),
          step.run("agent-robots", async () => {
            return runAgent("ROBOTS", siteId, async () => analyzeRobots(siteId, crawlSnapshot), {
              parentRunId: orchestratorRunId,
            });
          }),
          step.run("agent-internal-links", async () => {
            return runAgent("INTERNAL_LINKS", siteId, async () => analyzeInternalLinks(siteId, crawlSnapshot), {
              parentRunId: orchestratorRunId,
            });
          }),
        ]);

      // ─── PHASE 4: Search intelligence (parallel, requires GSC/GA4) ───

      guardLease(heartbeat, siteId);

      // Load GSC data for the last 56 days (current 28d + previous 28d)
      const gscData = await step.run("load-gsc-data", async () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 56);

        const rows = await prisma.gscDailyPerformance.findMany({
          where: {
            siteId,
            date: {
              gte: startDate.toISOString().slice(0, 10),
              lte: endDate.toISOString().slice(0, 10),
            },
          },
          select: {
            keyword: true,
            url: true,
            clicks: true,
            impressions: true,
            ctr: true,
            position: true,
            date: true,
          },
        });

        // Map Prisma field names to agent interface names
        return rows.map((r) => ({
          query: r.keyword,
          page: r.url,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
          date: r.date,
        })) as GscPerformanceRow[];
      });

      // Load GA4 data
      const ga4Data = await step.run("load-ga4-data", async () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 28);

        const rows = await prisma.ga4DailyPerformance.findMany({
          where: {
            siteId,
            date: {
              gte: startDate.toISOString().slice(0, 10),
              lte: endDate.toISOString().slice(0, 10),
            },
          },
          select: {
            landingPage: true,
            sessions: true,
            users: true,
            engagedSessions: true,
            conversions: true,
            engagementRate: true,
            pageviews: true,
          },
        });

        return rows as Ga4PerformanceRow[];
      });

      // Split GSC data into current/previous periods
      const midpoint = new Date();
      midpoint.setDate(midpoint.getDate() - 28);
      const midpointStr = midpoint.toISOString().slice(0, 10);

      const currentGsc = gscData.filter((r: GscPerformanceRow) => r.date >= midpointStr);
      const previousGsc = gscData.filter((r: GscPerformanceRow) => r.date < midpointStr);

      const searchResults = await Promise.all([
        step.run("agent-gsc-intelligence", async () => {
          if (currentGsc.length === 0) return null;
          return runAgent("GSC_INTELLIGENCE", siteId, async () =>
            analyzeGscIntelligence(siteId, currentGsc, previousGsc), {
            parentRunId: orchestratorRunId,
          });
        }),
        step.run("agent-ga4-intelligence", async () => {
          if (ga4Data.length === 0) return null;
          return runAgent("GA4_INTELLIGENCE", siteId, async () =>
            analyzeGa4Intelligence(siteId, ga4Data), {
            parentRunId: orchestratorRunId,
          });
        }),
        step.run("agent-keyword-intelligence", async () => {
          if (gscData.length === 0) return null;
          return runAgent("KEYWORD_INTELLIGENCE", siteId, async () =>
            analyzeKeywordIntelligence(siteId, gscData), {
            parentRunId: orchestratorRunId,
          });
        }),
        step.run("agent-cannibalization", async () => {
          if (gscData.length === 0) return null;
          return runAgent("CANNIBALIZATION", siteId, async () =>
            analyzeCannibalization(siteId, gscData), {
            parentRunId: orchestratorRunId,
          });
        }),
      ]);

      // ─── PHASE 5: Generate Opportunities ────────────────────────────

      guardLease(heartbeat, siteId);

      // Collect all findings from all agents
      const allResults = [
        discoveryResult, crawlResult,
        techSeoResult, indexationResult, sitemapResult, robotsResult, linksResult,
        ...searchResults.filter(Boolean),
      ];
      const allFindings = allResults.flatMap((r) => r?.findings ?? []);
      const totalFindings = allFindings.length;

      await step.run("generate-opportunities", async () => {
        await generateOpportunitiesFromFindings(siteId, allFindings);
      });

      // ─── PHASE 6: Finalize ───────────────────────────────────────────

      await step.run("finalize-orchestrator", async () => {
        await prisma.agentRun.update({
          where: { id: orchestratorRunId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            findingCount: totalFindings,
          },
        });
      });

      logger.info("[SiteAnalysis] Analysis completed", {
        siteId,
        orchestratorRunId,
        totalFindings,
      });

      return {
        status: "COMPLETED",
        orchestratorRunId,
        totalFindings,
      };

    } catch (err: unknown) {
      // Mark run as FAILED if it was created
      if (orchestratorRunId) {
        const errorMessage = (err as Error)?.message ?? String(err);
        const isSilentLeaseLoss = err instanceof LeaseLostError;

        await prisma.agentRun.update({
          where: { id: orchestratorRunId },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            metadata: {
              fatalError: errorMessage,
              leaseLost: isSilentLeaseLoss,
            } as object,
          },
        }).catch((e: unknown) => {
          logger.error("[SiteAnalysis] Failed to mark run as FAILED", {
            runId: orchestratorRunId,
            error: (e as Error).message,
          });
        });
      }

      throw err; // Re-throw for Inngest retry handling
    } finally {
      // Stop heartbeat first, then release lock
      heartbeat?.stop();
      await releaseAnalysisLock(siteId, orchestratorRunId);
    }
  },
);
