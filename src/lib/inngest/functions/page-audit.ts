/**
 * src/lib/inngest/functions/page-audit.ts
 *
 * Multi-page audit — paid users only.
 *
 * Event: "audit.pages.run"
 * Payload: { siteId: string; auditId: string; domain: string }
 *
 * Flow:
 *  1. runAudit() (server action) fires "audit.pages.run" immediately after saving
 *     the homepage Audit record — no blocking HTTP requests in the server action.
 *  2. runPageAuditJob picks this up and runs DB-first page discovery in a step:
 *       a. IndexingLog URLs (already submitted by the owner)
 *       b. Published Blog URLs + slugs + sourceUrls
 *       c. Previous PageAudit records (great seed for incremental runs)
 *       d. GSC — real traffic pages sorted by impressions (highest value first)
 *       e. External: sitemap.xml / sitemap_index / robots.txt Sitemap directive
 *       f. External: homepage <a href> crawl (last resort)
 *  3. It fans out one "audit.page.single" event per discovered page (homepage skipped —
 *     the main Audit record already covers it).
 *  4. processPageAuditJob runs AuditEngine on each page and saves a PageAudit row,
 *     concurrency-capped at CONCURRENCY.pageAuditChild per siteId.
 *
 * Tier-based page limits:
 *   PRO        → 25 pages
 *   AGENCY     → 50 pages
 *   ENTERPRISE → 100 pages
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { CONCURRENCY } from "../concurrency";
import { getAuditEngine } from "@/lib/seo-audit";
import { discoverPages } from "@/lib/seo-audit/crawler";
import { logger } from "@/lib/logger";


const PAGE_LIMIT: Record<string, number> = {
  FREE: 5,
  STARTER: 10,
  PRO: 25,
  AGENCY: 50,
};

async function getTierPageLimit(siteId: string): Promise<number> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { user: { select: { subscriptionTier: true } } },
  });
  const tier = (site?.user?.subscriptionTier ?? "FREE").toUpperCase();
  return PAGE_LIMIT[tier] ?? 5;
}

async function getUserIdForSite(siteId: string): Promise<string | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { userId: true },
  });
  return site?.userId ?? null;
}


export const runPageAuditJob = inngest.createFunction(
  {
    id: "run-page-audit",
    name: "Run Multi-Page Audit (Fan-Out)",
    retries: 2,

    triggers: [{ event: "audit.pages.run" }],
  },
  async ({ event, step }) => {
    const { siteId, auditId, domain, tier, auditMode } = event.data as {
      siteId: string;
      auditId: string;
      domain: string;
      tier: string;
      auditMode?: "homepage" | "full";
    };

    await step.run("verify-parent", async () => {
      const audit = await prisma.audit.findUnique({ where: { id: auditId } });
      if (!audit) throw new NonRetriableError(`Parent audit ${auditId} not found`);
    });

    // discoverPages() now runs in three tiers:
    //   1. DB  — IndexingLog, Blog URLs, past PageAudit records (fast, no HTTP)
    //   2. GSC — real traffic pages from Search Console, sorted by impressions
    //            so the highest-value pages are audited first within the budget
    //   3. External — sitemap / homepage crawl (only when DB+GSC underperform)
    const pageUrls = await step.run("discover-pages", async () => {
      const [limit, userId] = await Promise.all([
        getTierPageLimit(siteId),
        getUserIdForSite(siteId),
      ]);
      const urls = await discoverPages(domain, limit, siteId, userId ?? undefined);
      logger.info(
        `[PageAudit] Discovered ${urls.length} pages for site ${siteId} ` +
        `(domain: ${domain}, limit: ${limit}, gsc: ${userId ? "yes" : "no"})`
      );
      return urls;
    });

    // Skip page fan-out when:
    //  a) homepage-only mode was explicitly requested, OR
    //  b) no sub-pages were discovered
    if (auditMode === "homepage") {
      logger.info(`[PageAudit] Homepage-only mode — skipping page fan-out for ${domain}`);
      await prisma.audit.update({
        where: { id: auditId },
        data: { fixStatus: "COMPLETED" },
      });
      return { skipped: true, reason: "Homepage-only audit requested" };
    }

    const pagesToAudit = pageUrls.slice(1);

    if (pagesToAudit.length === 0) {
      logger.info(`[PageAudit] No sub-pages discovered for ${domain} — skipping fan-out`);
      await prisma.audit.update({
        where: { id: auditId },
        data: { fixStatus: "COMPLETED" },
      });
      return { skipped: true, reason: "No sub-pages discovered" };
    }

    await step.sendEvent(
      "fan-out-page-audits",
      pagesToAudit.map((pageUrl) => ({
        name: "audit.page.single" as const,
        data: { siteId, auditId, pageUrl },
      }))
    );

    logger.info(
      `[PageAudit] Fanned out ${pagesToAudit.length} page audits for audit ${auditId}`
    );

    await prisma.audit.update({
      where: { id: auditId },
      data: { fixStatus: "COMPLETED" },
    });

    return { fanned: pagesToAudit.length, domain };
  }
);


export const processPageAuditJob = inngest.createFunction(
  {
    id: "process-page-audit",
    name: "Audit Single Page",
    retries: 2,
    concurrency: {
      limit: CONCURRENCY.pageAuditChild,
      key: "event.data.siteId", // one concurrent worker per site — never hammer target servers
    },

    triggers: [{ event: "audit.page.single" }],
  },
  async ({ event, step }) => {
    const { siteId, auditId, pageUrl } = event.data as {
      siteId: string;
      auditId: string;
      pageUrl: string;
    };

    const result = await step.run("run-page-audit", async () => {
      // Sprint 1 fix 1: use 'page' profile (9 modules) not full (15 modules).
      // Eliminates OffPageModule, LocalModule, SocialModule, PerformanceModule,
      // BasicsAnalyticsModule, KeywordsModule per-page — ~40% less compute.
      const engine = getAuditEngine("page");

      // Sprint 1 fix 3: pass targetKeyword so KeywordOptimisationModule and
      // ImageSeoModule produce accurate per-page findings, not title-extracted fallbacks.
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { targetKeyword: true },
      });

      return await engine.runAudit(pageUrl, {
        targetKeyword: site?.targetKeyword ?? undefined,
      });
    });

    await step.run("save-page-audit", async () => {
      // Sprint 1 fix 4: upsert on compound unique key (auditId + pageUrl) instead
      // of createMany + skipDuplicates. skipDuplicates silently preserves bad data
      // on retries if the first attempt partially wrote a corrupted issueList.
      await prisma.pageAudit.upsert({
        where: { auditId_pageUrl: { auditId, pageUrl } },
        create: {
          auditId,
          siteId,
          pageUrl,
          overallScore: result.overallScore,
          categoryScores: result.categories.reduce(
            (acc: Record<string, number>, c: { id: string; score: number }) => ({
              ...acc,
              [c.id]: c.score,
            }),
            {}
          ),
          // Sprint 1 fix 2: store the full FullAuditReport (includes recommendations[],
          // aeoScore, aeoBreakdown, moduleTelemetry) — not just categories[].
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          issueList: result as any,
        },
        update: {
          overallScore: result.overallScore,
          categoryScores: result.categories.reduce(
            (acc: Record<string, number>, c: { id: string; score: number }) => ({
              ...acc,
              [c.id]: c.score,
            }),
            {}
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          issueList: result as any,
          runTimestamp: new Date(),
        },
      });
    });

    logger.info(`[PageAudit] Saved page audit for ${pageUrl} (score: ${result.overallScore})`);
    return { pageUrl, score: result.overallScore };
  }
);
