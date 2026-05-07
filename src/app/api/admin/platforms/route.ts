import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  // Average AEO scores per platform across all snapshots
  const platformAvg = await prisma.$queryRaw<
    {
      avgPerplexity: number;
      avgChatgpt: number;
      avgClaude: number;
      avgGoogleAio: number;
      avgGrok: number;
      avgCopilot: number;
      avgOverall: number;
    }[]
  >`
    SELECT
      AVG("perplexityScore")::float AS "avgPerplexity",
      AVG("chatgptScore")::float AS "avgChatgpt",
      AVG("claudeScore")::float AS "avgClaude",
      AVG("googleAioScore")::float AS "avgGoogleAio",
      AVG("grokScore")::float AS "avgGrok",
      AVG("copilotScore")::float AS "avgCopilot",
      AVG("score")::float AS "avgOverall"
    FROM "AeoSnapshot"
  `;

  // Top 10 and bottom 10 sites by latest AEO score
  const latestSnapshots = await prisma.$queryRaw<
    { siteId: string; domain: string; score: number; grade: string; createdAt: Date }[]
  >`
    SELECT DISTINCT ON (s."siteId") 
      s."siteId",
      si."domain",
      s."score",
      s."grade",
      s."createdAt"
    FROM "AeoSnapshot" s
    JOIN "Site" si ON si.id = s."siteId"
    ORDER BY s."siteId", s."createdAt" DESC
  `;

  const sorted = [...latestSnapshots].sort((a, b) => b.score - a.score);
  const topSites = sorted.slice(0, 10);
  const bottomSites = sorted.slice(-10).reverse();

  const avg = platformAvg[0] ?? {};

  return NextResponse.json({
    platformAverages: {
      perplexity: Math.round(avg.avgPerplexity ?? 0),
      chatgpt: Math.round(avg.avgChatgpt ?? 0),
      claude: Math.round(avg.avgClaude ?? 0),
      googleAio: Math.round(avg.avgGoogleAio ?? 0),
      grok: Math.round(avg.avgGrok ?? 0),
      copilot: Math.round(avg.avgCopilot ?? 0),
      overall: Math.round(avg.avgOverall ?? 0),
    },
    topSites: topSites.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    bottomSites: bottomSites.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  });
}
