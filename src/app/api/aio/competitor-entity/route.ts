export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { profileCompetitorEntity, buildEntityGaps } from "@/lib/aio/competitor-entity-profile";
import { redis } from "@/lib/redis";

const ENTITY_CACHE_TTL_S = 60 * 60 * 24 * 3; // 3 days — entity signals are stable

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId)
    return NextResponse.json({ error: "siteId required" }, { status: 400 });

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: {
      id: true,
      domain: true,
      brandName: true,
      competitors: { select: { domain: true } },
    },
  });
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cacheKey = `entity-comp:${siteId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ ...(cached as object), cached: true });
  } catch { /* fall through */ }

  // Profile client + all competitors in parallel
  const allDomains = [site.domain, ...site.competitors.map(c => c.domain)];
  const profiles = await Promise.all(allDomains.map(d => profileCompetitorEntity(d)));

  const [clientProfile, ...competitorProfiles] = profiles;
  const validCompetitors = competitorProfiles.filter((p): p is NonNullable<typeof p> => p !== null);

  const result = {
    client: clientProfile,
    competitors: validCompetitors.sort((a, b) => b.entityScore - a.entityScore),
    gaps: clientProfile ? buildEntityGaps(clientProfile, validCompetitors) : [],
  };

  try {
    await redis.set(cacheKey, result, { ex: ENTITY_CACHE_TTL_S });
  } catch { /* non-fatal */ }

  return NextResponse.json({ ...result, cached: false });
}
