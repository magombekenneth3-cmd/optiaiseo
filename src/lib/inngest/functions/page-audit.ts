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
      const engine = getAuditEngine("page");

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { targetKeyword: true },
      });

      return await engine.runAudit(pageUrl, {
        targetKeyword: site?.targetKeyword ?? undefined,
      });
    });

    await step.run("save-page-audit", async () => {
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
