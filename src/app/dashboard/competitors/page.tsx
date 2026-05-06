import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getEffectiveTier } from "@/lib/stripe/guards";
import { CompetitorsDashboard } from "./CompetitorsDashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Competitors",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ siteId?: string }>;
}

export default async function CompetitorsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const { siteId: qSiteId } = await searchParams;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      sites: {
        orderBy: { createdAt: "desc" },
        select: { id: true, domain: true },
      },
    },
  });

  if (!user) redirect("/login");

  const sites = user.sites;
  const activeSiteId = qSiteId ?? sites[0]?.id ?? null;
  type SiteEntry = { id: string; domain: string };
  const activeSite = (sites as SiteEntry[]).find((s: SiteEntry) => s.id === activeSiteId) ?? sites[0] ?? null;

  const tier = await getEffectiveTier(user.id);
  const isPaid = tier !== "FREE";

  const rawCompetitors = activeSiteId
    ? await prisma.competitor.findMany({
        where: { siteId: activeSiteId },
        include: {
          keywords: { orderBy: { searchVolume: "desc" }, take: 50 },
          snapshots: { orderBy: { month: "desc" }, take: 6 },
        },
        orderBy: { addedAt: "desc" },
      })
    : [];

  // Serialise Prisma result to a plain JSON-safe shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const competitors = rawCompetitors.map((c: any) => ({
    id: c.id as string,
    domain: c.domain as string,
    addedAt: c.addedAt instanceof Date ? c.addedAt.toISOString() : String(c.addedAt),
    metadata: (c.metadata ?? null) as Record<string, unknown> | null,
    keywords: (c.keywords ?? []).map((k: any) => ({
      id: k.id as string,
      keyword: k.keyword as string,
      position: (k.position ?? 0) as number,
      searchVolume: (k.searchVolume ?? 0) as number,
      difficulty: (k.difficulty ?? null) as number | null,
      clicks: (k.clicks ?? null) as number | null,
      dataSource: (k.dataSource ?? null) as string | null,
    })),
    snapshots: (c.snapshots ?? []).map((s: any) => ({
      month: s.month instanceof Date ? s.month.toISOString() : String(s.month),
      traffic: (s.traffic ?? 0) as number,
      organicKeywords: (s.organicKeywords ?? null) as number | null,
    })),
  }));

  return (
    <CompetitorsDashboard
      sites={sites}
      activeSiteId={activeSiteId}
      activeSiteDomain={activeSite?.domain ?? null}
      competitors={competitors}
      isPaid={isPaid}
      tier={tier}
    />
  );
}
