export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

// Cache aggregated SOV results for 1 hour — the underlying data only changes
// when the cron job runs (typically once per day), so 1 h is safe and cheap.
const SOV_CACHE_TTL_S = 60 * 60; // 1 hour

function sovCacheKey(siteId: string): string {
  return `sov:${siteId}`;
}

interface SovCachedPayload {
  byModel: Array<{
    model: string;
    mentionRate: number;
    total: number;
    mentions: number;
  }>;
  overallRate: number;
  trend: Array<{ date: string; rate: number }>;
}

/**
 * GET /api/aeo/sov?siteId=xxx
 *
 * Returns brand mention rate per AI model from AiShareOfVoice data,
 * plus a 30-day trend series for the GenerativeSOVPanel component.
 *
 * Results are cached in Redis for 1 hour. Pass ?bust=1 to force a refresh
 * (useful after a manual AEO run).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user!.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });

  // Ownership check — always run, never skip for security
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user!.id },
    select: { id: true },
  });
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bust = req.nextUrl.searchParams.get("bust") === "1";
  const cacheKey = sovCacheKey(siteId);

  if (!bust) {
    try {
      const cached = await redis.get<SovCachedPayload>(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, cached: true });
      }
    } catch {
      // Redis unavailable — fall through to DB query
    }
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const records = await prisma.aiShareOfVoice.findMany({
    where: { siteId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: {
      keyword: true,
      modelName: true,
      brandMentioned: true,
      recordedAt: true,
    },
  });

  const modelMap = new Map<string, { mentions: number; total: number }>();

  for (const r of records) {
    const existing = modelMap.get(r.modelName) ?? { mentions: 0, total: 0 };
    existing.total++;
    if (r.brandMentioned) existing.mentions++;
    modelMap.set(r.modelName, existing);
  }

  const byModel = Array.from(modelMap.entries())
    .map(([model, stat]) => ({
      model,
      mentionRate: stat.total > 0 ? Math.round((stat.mentions / stat.total) * 100) : 0,
      total: stat.total,
      mentions: stat.mentions,
    }))
    .sort((a, b) => b.mentionRate - a.mentionRate);

  const totalAll = records.length;
  const mentionsAll = records.filter((r) => r.brandMentioned).length;
  const overallRate = totalAll > 0 ? Math.round((mentionsAll / totalAll) * 100) : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recent = records.filter((r) => r.recordedAt >= thirtyDaysAgo);

  const dayBuckets = new Map<string, { m: number; t: number }>();
  for (const r of recent) {
    const day = r.recordedAt.toISOString().slice(0, 10);
    const b = dayBuckets.get(day) ?? { m: 0, t: 0 };
    b.t++;
    if (r.brandMentioned) b.m++;
    dayBuckets.set(day, b);
  }

  const trend = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      rate: b.t > 0 ? Math.round((b.m / b.t) * 100) : 0,
    }));

  const payload: SovCachedPayload = { byModel, overallRate, trend };

  try {
    await redis.set(cacheKey, payload, { ex: SOV_CACHE_TTL_S });
  } catch {
    // Non-fatal — return uncached result
  }

  return NextResponse.json({ ...payload, cached: false });
}
