import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RecommendationsDashboard } from "@/components/dashboard/RecommendationsDashboard";
import { buildRecommendations, type SiteContext } from "@/lib/recommendations/engine";

export const metadata: Metadata = {
  title: "Recommendations | OptiAISEO",
  description: "Prioritised, data-driven recommendations to grow your search and AI visibility.",
};

// Always fetch fresh — recommendations change as GSC data and site state change.
export const dynamic = "force-dynamic";

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { siteId } = await searchParams;

  // Validate siteId is a safe alphanumeric CUID (Prisma default) — rejects
  // empty strings, path-traversal attempts, and absurdly long inputs.
  const CUID_RE = /^[a-z0-9]{10,40}$/i;

  // Require a siteId — redirect to settings if the user has no sites yet.
  if (!siteId || !CUID_RE.test(siteId)) {
    const firstSite = await prisma.site.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (firstSite) {
      redirect(`/dashboard/recommendations?siteId=${firstSite.id}`);
    }
    redirect("/dashboard/settings");
  }

  // Parallelise site and user lookups — both are independent reads.
  const [site, user] = await Promise.all([
    prisma.site.findFirst({
      where: {
        id: siteId,
        OR: [
          { userId: session.user.id },
          { viewerId: session.user.id },
        ],
      },
      select: {
        id:                  true,
        domain:              true,
        githubRepoUrl:       true,
        aeoAutopilotEnabled: true,
        operatingMode:       true,
        indexNowConfig:      true,
        trackedKeywords:     { select: { id: true }, take: 1 },
        blogs:               { select: { id: true }, where: { status: "published" }, take: 1 },
      },
    }),
    prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { gscConnected: true },
    }),
  ]);

  // 403-style guard — user doesn't own or view this site.
  if (!site) redirect("/dashboard");

  const ctx: SiteContext = {
    siteId:              site.id,
    userId:              session.user.id,
    domain:              site.domain,
    hasGithub:           !!site.githubRepoUrl,
    hasGsc:              !!user?.gscConnected,
    hasAeo:              site.aeoAutopilotEnabled,
    hasIndexNow:         !!site.indexNowConfig,
    hasTrackedKeywords:  site.trackedKeywords.length > 0,
    hasBlogsPublished:   site.blogs.length > 0,
    operatingMode:       site.operatingMode,
  };

  const result = await buildRecommendations(ctx);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <RecommendationsDashboard
        domain={site.domain}
        result={result}
        gscConnected={result.gscConnected}
      />
    </div>
  );
}