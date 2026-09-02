/**
 * Phase D.1 — Autonomous Discovery (Inngest Functions)
 *
 * Source-specific triggering — NOT a daily batch.
 *
 * Event chain:
 *   gsc.sync.completed → discovery.run-source { source: "GSC" }
 *   audit.completed     → discovery.run-source { source: "AUDIT" }
 *                        → discovery.run-source { source: "CONTENT" }
 *
 * Weekly reconciliation checks for stale sources whose refresh is overdue.
 *
 * INVARIANT: Discovery creates CANDIDATE opportunities, never OPEN.
 */

import { inngest } from "../client";
import { logger } from "@/lib/logger";
import { runDiscovery } from "@/lib/discovery/discovery-runner";
import { isReportOnly } from "@/lib/autonomy/operating-modes";
import { shouldRefreshSource } from "@/lib/discovery/freshness";
import type { DiscoverySource } from "@/lib/discovery/types";

// ── 1. Per-Source Discovery (Event-Triggered) ───────────────────────────────

export const autonomousDiscoverySource = inngest.createFunction(
  {
    id: "autonomous-discovery-source",
    name: "Autonomous Discovery: Per-Source",
    retries: 2,
    concurrency: { limit: 3 },
    triggers: [{ event: "discovery.run-source" }],
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        siteId: string;
        source: DiscoverySource;
        triggeredBy?: "CRON" | "EVENT" | "MANUAL";
      };
    };
    step: any;
  }) => {
    const { siteId, source, triggeredBy = "EVENT" } = event.data;

    // Validate site exists and is eligible
    const site = await step.run("load-site", async () => {
      const { prisma } = await import("@/lib/prisma");
      return (prisma as any).site.findUnique({
        where: { id: siteId },
        select: { id: true, operatingMode: true, automationsPaused: true },
      });
    });

    if (!site) {
      logger.warn("[AutonomousDiscovery] Site not found", { siteId });
      return { status: "SITE_NOT_FOUND", siteId };
    }

    // Discovery runs for all modes except when automations are paused
    // (even REPORT_ONLY sites benefit from discovery — it's observation only)
    if (site.automationsPaused) {
      return { status: "PAUSED", siteId };
    }

    // Run discovery
    const result = await step.run(`discover-${source}`, async () => {
      return runDiscovery(siteId, source, { triggeredBy });
    });

    logger.info("[AutonomousDiscovery] Source discovery complete", {
      siteId,
      source,
      ...result,
    });

    return {
      status: "COMPLETED",
      ...result,
    };
  }
);

// ── 2. Event Bridges ────────────────────────────────────────────────────────

/**
 * Bridges GSC sync completion to discovery.
 * When GSC data is refreshed, re-discover GSC-based opportunities.
 */
export const discoveryOnGscSync = inngest.createFunction(
  {
    id: "discovery-on-gsc-sync",
    name: "Discovery: Trigger on GSC Sync",
    retries: 1,
    triggers: [{ event: "gsc.sync.completed" }],
  },
  async ({ event, step }: { event: { data: { siteId: string } }; step: any }) => {
    await step.sendEvent("trigger-gsc-discovery", {
      name: "discovery.run-source",
      data: {
        siteId: event.data.siteId,
        source: "GSC" as DiscoverySource,
        triggeredBy: "EVENT" as const,
      },
    });

    return { status: "TRIGGERED", source: "GSC", siteId: event.data.siteId };
  }
);

/**
 * Bridges audit completion to discovery.
 * When an audit completes, re-discover both audit and content opportunities.
 */
export const discoveryOnAuditComplete = inngest.createFunction(
  {
    id: "discovery-on-audit-complete",
    name: "Discovery: Trigger on Audit Complete",
    retries: 1,
    triggers: [{ event: "audit.completed" }],
  },
  async ({ event, step }: { event: { data: { siteId: string } }; step: any }) => {
    await step.sendEvent("trigger-audit-discovery", [
      {
        name: "discovery.run-source",
        data: {
          siteId: event.data.siteId,
          source: "AUDIT" as DiscoverySource,
          triggeredBy: "EVENT" as const,
        },
      },
      {
        name: "discovery.run-source",
        data: {
          siteId: event.data.siteId,
          source: "CONTENT" as DiscoverySource,
          triggeredBy: "EVENT" as const,
        },
      },
    ]);

    return {
      status: "TRIGGERED",
      sources: ["AUDIT", "CONTENT"],
      siteId: event.data.siteId,
    };
  }
);

// ── 3. Weekly Reconciliation ────────────────────────────────────────────────

/**
 * Catches missed events by checking all autonomous sites for stale sources.
 * Runs weekly — NOT daily — since event triggers handle the normal cadence.
 */
export const autonomousDiscoveryReconcile = inngest.createFunction(
  {
    id: "autonomous-discovery-reconcile",
    name: "Autonomous Discovery: Weekly Reconcile",
    retries: 1,
    triggers: [{ cron: "0 4 * * 3" }], // Wednesday 04:00 UTC
  },
  async ({ step }: { step: any }) => {
    // Find all autonomous sites
    const sites = await step.run("find-autonomous-sites", async () => {
      const { prisma } = await import("@/lib/prisma");
      return (prisma as any).site.findMany({
        where: {
          automationsPaused: false,
          user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } },
        },
        select: { id: true },
      }) as Promise<{ id: string }[]>;
    });

    if (sites.length === 0) {
      logger.info("[DiscoveryReconcile] No autonomous sites");
      return { queued: 0 };
    }

    // For each site, check which sources need refresh
    const SOURCES_TO_CHECK: DiscoverySource[] = ["GSC", "AUDIT", "CONTENT"];
    const events: Array<{ name: string; data: any }> = [];

    // Get last refresh times per site
    for (const site of sites) {
      const lastRefreshed = await step.run(`check-freshness-${site.id}`, async () => {
        const { prisma } = await import("@/lib/prisma");

        // Get the most recent discovery run for each source
        const runs = await (prisma as any).agentRun.findMany({
          where: {
            siteId: site.id,
            agentType: "DISCOVERY",
            status: "COMPLETED",
          },
          orderBy: { completedAt: "desc" },
          take: 10,
          select: { metadata: true, completedAt: true },
        });

        const lastBySource: Record<string, Date | null> = {};
        for (const source of SOURCES_TO_CHECK) {
          const run = runs.find((r: any) => r.metadata?.source === source);
          lastBySource[source] = run?.completedAt ?? null;
        }

        return lastBySource;
      });

      for (const source of SOURCES_TO_CHECK) {
        if (shouldRefreshSource(source, lastRefreshed[source])) {
          events.push({
            name: "discovery.run-source",
            data: {
              siteId: site.id,
              source,
              triggeredBy: "CRON" as const,
            },
          });
        }
      }
    }

    if (events.length > 0) {
      await step.sendEvent("reconcile-discovery-events", events);
    }

    logger.info("[DiscoveryReconcile] Reconciliation complete", {
      sitesChecked: sites.length,
      discoveryEventsQueued: events.length,
    });

    return { sitesChecked: sites.length, queued: events.length };
  }
);
