import { prisma } from "@/lib/prisma";

export interface CompetitorAuthorityComparison {
  yourDomain: string;
  yourDr: number | null;
  yourBacklinks: number | null;
  yourReferringDomains: number | null;
  competitors: Array<{
    domain: string;
    dr: number | null;
    backlinks: number | null;
    referringDomains: number | null;
    /** Positive = competitor leads, negative = you lead */
    drGap: number | null;
  }>;
}

/**
 * Returns a side-by-side authority comparison between the client's site
 * and their tracked competitors. Reads from stored snapshots — no live
 * Ahrefs API calls.
 */
export async function getCompetitorAuthorityComparison(
  siteId: string,
): Promise<CompetitorAuthorityComparison | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      domain: true,
      ahrefsSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { domainRating: true, backlinks: true, referringDomains: true },
      },
      competitors: {
        select: {
          domain: true,
          competitorAhrefsSnapshots: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { domainRating: true, backlinks: true, referringDomains: true },
          },
        },
        take: 10,
      },
    },
  });

  if (!site) return null;

  const mySnapshot = site.ahrefsSnapshots[0] ?? null;
  const myDr = mySnapshot?.domainRating ?? null;

  return {
    yourDomain: site.domain,
    yourDr: myDr,
    yourBacklinks: mySnapshot?.backlinks ?? null,
    yourReferringDomains: mySnapshot?.referringDomains ?? null,
    competitors: site.competitors.map((c) => {
      const snap = c.competitorAhrefsSnapshots[0] ?? null;
      const compDr = snap?.domainRating ?? null;
      return {
        domain: c.domain,
        dr: compDr,
        backlinks: snap?.backlinks ?? null,
        referringDomains: snap?.referringDomains ?? null,
        drGap: myDr !== null && compDr !== null ? compDr - myDr : null,
      };
    }),
  };
}
