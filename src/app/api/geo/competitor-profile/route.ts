export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { profileCompetitorGeo, buildGeoComparisonReport } from "@/lib/geo/competitor-geo-profile";
import { redis } from "@/lib/redis";

const GEO_CACHE_TTL_S = 60 * 60 * 24; // 24 h — GEO signals change slowly

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId)
    return NextResponse.json({ error: "siteId required" }, { status: 400 });

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: { id: true, domain: true, competitors: { select: { domain: true } } },
  });
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cacheKey = `geo-comp:${siteId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), cached: true });
  } catch { /* fall through */ }

  // Profile client + all competitors in parallel
  const [clientProfile, ...competitorProfiles] = await Promise.all([
    profileCompetitorGeo(site.domain),
    ...site.competitors.map(c => profileCompetitorGeo(c.domain)),
  ]);

  if (!clientProfile)
    return NextResponse.json({ error: "Could not profile your site" }, { status: 500 });

  const validCompetitors = competitorProfiles.filter((p): p is NonNullable<typeof p> => p !== null);
  const report = buildGeoComparisonReport(clientProfile, validCompetitors);

  try {
    await redis.set(cacheKey, report, { ex: GEO_CACHE_TTL_S });
  } catch { /* non-fatal */ }

  return NextResponse.json({ ...report, cached: false });
}
