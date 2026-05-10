import { inngest }                      from "../client";
import { prisma } from "@/lib/prisma";
import { logger }                        from "@/lib/logger";
import { redis }                         from "@/lib/redis";
import { TTL }                           from "@/lib/constants/ttl";
import {
  generateQueryLibrary,
  checkQueryAcrossModels,
  upsertTrackedQueries,
  saveQueryResults,
  type QueryCheckResult,
} from "@/lib/aeo/query-library";

// Triggered once per site when the user enables the query library.
// Generates queries and saves them; does NOT check models (that's the weekly run).

export const initQueryLibraryJob = inngest.createFunction(
  {
    id:          "query-library-init",
    name:        "Query Library — Generate Queries",
    retries:     2,
    concurrency: { limit: 3, key: "event.data.siteId" },
    timeouts:    { finish: "2m" },
  
      triggers: [{ event: "aeo/query-library.init" }],
  },
  async ({ event, step }) => {
    const { siteId } = event.data as { siteId: string };

    const site = await step.run("load-site", async () => {
      return prisma.site.findUnique({
        where:  { id: siteId },
        select: {
          domain:       true,
          coreServices: true,
          _count: { select: { trackedQueries: true } },
        },
      });
    });

    if (!site) {
      logger.warn("[QueryLibrary/Init] Site not found", { siteId });
      return { skipped: true };
    }

    const pageContent = await step.run("fetch-homepage", async () => {
      try {
        const res = await fetch(`https://${site.domain}`, {
          headers: { "User-Agent": "OptiAISEO/1.0 Query Library Builder" },
          signal:  AbortSignal.timeout(10000),
        });
        if (!res.ok) return null;
        return res.text();
      } catch {
        return null;
      }
    });

    const queries = await step.run("generate-queries", async () => {
      return generateQueryLibrary(
        site.domain,
        site.coreServices,
        pageContent,
        site._count.trackedQueries
      );
    });

    const created = await step.run("save-queries", async () => {
      return upsertTrackedQueries(siteId, queries);
    });

    logger.info("[QueryLibrary/Init] Complete", { siteId, created });
    return { siteId, queriesCreated: created };
  }
);

// Cron: every Thursday at 07:00 UTC.
// Fans out one `aeo/query-library.run-site` event per eligible site.
// Each site's run is isolated — one slow site cannot block others.

export const runQueryLibraryWeekly = inngest.createFunction(
  {
    id:          "query-library-weekly",
    name:        "Query Library — Weekly Execution",
    retries:     1,
    concurrency: { limit: 2 },
    timeouts:    { finish: "10m" },
  
      triggers: [{ cron: "0 7 * * 4" }],
  },
  // Every Thursday at 07:00 UTC
  async ({ step }) => {
    const sites = await step.run("load-eligible-sites", async () => {
      return prisma.site.findMany({
        where: {
          user:           { subscriptionTier: { in: ["PRO", "AGENCY"] } },
          trackedQueries: { some: { isActive: true } },
        },
        select: { id: true, domain: true },
        take:   30,
      });
    });

    logger.info("[QueryLibrary/Weekly] Starting batch", { siteCount: sites.length });

    await step.run("fan-out", async () => {
      await inngest.send(
        sites.map((site) => ({
          name: "aeo/query-library.run-site" as const,
          data: { siteId: site.id },
        }))
      );
    });

    return { dispatched: sites.length };
  }
);

// Gap 3 fix: instead of a blocking for-loop with await step.sleep() between
// batches (8–15 min for 50 queries), we fan-out one event per query.
// Inngest's per-site concurrency limit (10) ensures we don't hammer the AI
// APIs, and the global rate-limit on checkOneQueryJob adds a safety cap.
//
// Total execution time drops from ~10 min → ~2 min under normal load.

export const runQueryLibrarySite = inngest.createFunction(
  {
    id:          "query-library-run-site",
    name:        "Query Library — Run Site",
    retries:     2,
    concurrency: { limit: 3, key: "event.data.siteId" },
    timeouts:    { finish: "5m" },
  
      triggers: [{ event: "aeo/query-library.run-site" }],
  },
  async ({ event, step }) => {
    const { siteId } = event.data as { siteId: string };

    const site = await step.run("load-site", async () => {
      return prisma.site.findUnique({
        where:  { id: siteId },
        select: { domain: true, coreServices: true },
      });
    });

    if (!site) return { skipped: true };

    const activeQueries = await step.run("load-queries", async () => {
      return prisma.trackedQuery.findMany({
        where:   { siteId, isActive: true },
        select:  { id: true, queryText: true, intent: true },
        orderBy: { createdAt: "asc" },
        take:    50,
      });
    });

    if (activeQueries.length === 0) {
      logger.info("[QueryLibrary/RunSite] No active queries", { siteId });
      return { skipped: true, reason: "no active queries" };
    }

    logger.info("[QueryLibrary/RunSite] Fanning out per-query checks", {
      siteId,
      queryCount: activeQueries.length,
    });

    // Fan-out: one event per query so each runs independently under concurrency
    // control rather than blocking sequentially in this function's timeout window.
    await step.run("fan-out-queries", async () => {
      await inngest.send(
        activeQueries.map((q) => ({
          name: "aeo/query-library.check-one" as const,
          data: {
            siteId,
            queryId:   q.id,
            queryText: q.queryText,
            domain:    site.domain,
            coreServices: site.coreServices ?? null,
          },
        }))
      );
    });

    return { siteId, dispatched: activeQueries.length };
  }
);

// Gap 3 fix: fan-out child — one invocation per tracked query.
//
// Concurrency:
//   - per-site: limit 10 (prevents a single site from monopolising workers)
//   - global rateLimit: 5 per second across all sites (AI API safety cap)
//
// Redis TTL guard: if this query was checked < 6 h ago, skip the AI call
// and return the cached result. Uses the same SPOT_CHECK_TTL = TTL.PERPLEXITY_S
// constant used by query-discovery.ts spot checks.
//
// IMPORTANT: must be registered in src/app/api/inngest/route.ts or events
// are silently dropped (see comment block in that file).

export const checkOneQueryJob = inngest.createFunction(
  {
    id:          "query-library-check-one",
    name:        "Query Library — Check One Query",
    retries:     2,
    concurrency: { limit: 5, key: "event.data.siteId" },
    rateLimit:   { limit: 5, period: "1s", key: "\"global\"" },
    timeouts:    { finish: "3m" },
  
      triggers: [{ event: "aeo/query-library.check-one" }],
  },
  async ({ event, step }) => {
    const { siteId, queryId, queryText, domain, coreServices } =
      event.data as {
        siteId:       string;
        queryId:      string;
        queryText:    string;
        domain:       string;
        coreServices: string | null;
      };

    // Redis TTL guard — skip if recently checked
    const cacheKey = `ql:check:${queryId}`;
    const cached = await step.run("ttl-check", async () => {
      try {
        const hit = await redis.get(cacheKey);
        return hit ? true : false;
      } catch {
        return false;
      }
    });

    if (cached) {
      logger.debug("[QueryLibrary/CheckOne] Cache hit — skipping", { queryId, queryText: queryText.slice(0, 40) });
      return { skipped: true, reason: "cached" };
    }

    const results = await step.run("check-models", async () => {
      return checkQueryAcrossModels(queryText, domain, coreServices);
    }) as unknown as QueryCheckResult[];

    await step.run("save-results", async () => {
      await saveQueryResults(queryId, results);

      // Mark as recently checked so the next fan-out skips it
      try {
        await redis.set(cacheKey, "1", { ex: TTL.PERPLEXITY_S });
      } catch { /* non-fatal */ }
    });

    logger.debug("[QueryLibrary/CheckOne] Done", {
      queryId,
      modelCount: results.length,
      mentioned:  results.filter(r => r.mentioned).length,
    });

    return { queryId, modelCount: results.length };
  }
);
