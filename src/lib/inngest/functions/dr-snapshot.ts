import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { dataForSeoPost, isConfigured } from "@/lib/backlinks/client";
import { getDataForSeoFirstResult, parseDataForSeoSummary } from "@/lib/backlinks/provider";
import { logger } from "@/lib/logger";
import { CONCURRENCY } from "../concurrency";

async function fetchDomainRating(domain: string): Promise<{
  domainRating: number;
  backlinks: number;
  referringDomains: number;
} | null> {
  if (!isConfigured()) return null;
  try {
    const data = await dataForSeoPost<unknown>(
      "/backlinks/summary/live",
      [{ target: domain, include_subdomains: true, rank_scale: "one_hundred" }],
    );
    // Summary metrics are returned directly in result[0], not result[0].items.
    const result = getDataForSeoFirstResult(data);
    if (!result) return null;
    const metrics = parseDataForSeoSummary(result);
    return {
      domainRating: metrics.domainRating,
      backlinks: metrics.totalBacklinks,
      referringDomains: metrics.referringDomains,
    };
  } catch (err) {
    logger.warn("[DrSnapshot] fetch failed", { domain, error: String(err) });
    return null;
  }
}

export const drSnapshotJob = inngest.createFunction(
  {
    id: "dr-snapshot-weekly",
    name: "DR Snapshot: weekly",
    concurrency: { limit: CONCURRENCY.competitors },
    retries: 1,
    triggers: [
      { event: "dr-snapshot/requested" },
      { cron: "0 4 * * 3" },
    ],
  },
  async ({ step }) => {
    const sites = await step.run("load-sites", () =>
      prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: {
          id: true,
          domain: true,
          competitors: { select: { id: true, domain: true } },
        },
      }),
    );

    let sitesUpdated = 0;
    let competitorsUpdated = 0;

    for (const site of sites) {
      await step.run(`snapshot-site-${site.id}`, async () => {
        const metrics = await fetchDomainRating(site.domain);
        if (!metrics) return;

        await prisma.ahrefsSnapshot.create({
          data: {
            siteId: site.id,
            domainRating: metrics.domainRating,
            backlinks: metrics.backlinks,
            referringDomains: metrics.referringDomains,
          },
        });

        await prisma.ahrefsSnapshot.deleteMany({
          where: {
            siteId: site.id,
            fetchedAt: {
              lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
        });

        sitesUpdated++;

        for (const competitor of site.competitors) {
          const cMetrics = await fetchDomainRating(competitor.domain);
          if (!cMetrics) continue;

          await prisma.competitorAhrefsSnapshot.create({
            data: {
              competitorId: competitor.id,
              domainRating: cMetrics.domainRating,
              backlinks: cMetrics.backlinks,
              referringDomains: cMetrics.referringDomains,
            },
          });

          await prisma.competitorAhrefsSnapshot.deleteMany({
            where: {
              competitorId: competitor.id,
              createdAt: {
                lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              },
            },
          });

          competitorsUpdated++;
        }
      });
    }

    logger.info("[DrSnapshot] Weekly run complete", { sitesUpdated, competitorsUpdated });
    return { sitesUpdated, competitorsUpdated };
  },
);
