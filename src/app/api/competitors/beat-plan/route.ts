export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { generateBeatCompetitorPlan } from "@/lib/competitors/beat-plan";
import type { CompetitorContentProfile } from "@/lib/aeo/competitor-content-profile";
import type { GeoFitnessSignals } from "@/lib/geo/competitor-geo-profile";
import type { EntityProfile } from "@/lib/aio/competitor-entity-profile";

/**
 * GET /api/competitors/beat-plan?siteId=xxx&competitorDomain=yyy
 *
 * Generates a prioritised "Beat This Competitor" action plan by aggregating
 * all available intelligence from Redis (content profile, GEO signals, entity
 * signals, authority gap) and synthesising with one Gemini call.
 *
 * Pass ?bust=1 to force regeneration (clears the 3-day cache).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const siteId = searchParams.get("siteId");
  const competitorDomain = searchParams.get("competitorDomain");

  if (!siteId || !competitorDomain)
    return NextResponse.json(
      { error: "siteId and competitorDomain are required" },
      { status: 400 },
    );

  // Ownership check + collect context in one round-trip
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: {
      id: true,
      domain: true,
      ahrefsSnapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: { domainRating: true },
      },
      competitors: {
        where: { domain: competitorDomain },
        select: {
          id: true,
          domain: true,
          competitorAhrefsSnapshots: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { domainRating: true },
          },
        },
        take: 1,
      },
    },
  });

  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const competitor = site.competitors[0];
  if (!competitor)
    return NextResponse.json(
      { error: `${competitorDomain} is not a tracked competitor for this site` },
      { status: 404 },
    );

  // Bust cache if requested
  const bust = searchParams.get("bust") === "1";
  if (bust) {
    try {
      await redis.del(`beat-plan:${siteId}:${competitorDomain}`);
    } catch {
      // Non-fatal
    }
  }

  // None of these are blocking — if Redis is down we degrade gracefully.
  const [
    geoReport,
    entityReport,
    sovGaps,
  ] = await Promise.allSettled([
    redis.get<{ competitors: Array<GeoFitnessSignals & { gaps: string[] }>; clientScore: number } & { client?: GeoFitnessSignals }>(`geo-comp:${siteId}`),
    redis.get<{ client: EntityProfile; competitors: EntityProfile[] }>(`entity-comp:${siteId}`),
    redis.get<Array<{ keyword: string; competitorsMentioned: string[] }>>(`sov:${siteId}`),
  ]);

  // Extract competitor-specific GEO profile
  const geoData = geoReport.status === "fulfilled" ? geoReport.value : null;
  const competitorGeoProfile = geoData?.competitors?.find(
    c => c.domain === competitorDomain,
  ) ?? null;
  const clientGeoProfile = (geoData as unknown as { clientProfile?: GeoFitnessSignals })?.clientProfile ?? null;

  // Extract competitor entity profile
  const entityData = entityReport.status === "fulfilled" ? entityReport.value : null;
  const competitorEntityProfile = entityData?.competitors?.find(
    c => c.domain === competitorDomain,
  ) ?? null;
  const clientEntityProfile = entityData?.client ?? null;

  // Extract gap keywords from SOV data
  const sovData = sovGaps.status === "fulfilled" ? sovGaps.value : null;
  const gapKeywords: string[] = [];
  if (Array.isArray(sovData)) {
    for (const record of sovData) {
      if (
        Array.isArray(record.competitorsMentioned) &&
        record.competitorsMentioned.some((d: string) => d.includes(competitorDomain))
      ) {
        gapKeywords.push(record.keyword);
      }
    }
  }

  // Also try to pull gap keywords from AiShareOfVoice DB for richer context
  if (gapKeywords.length < 5) {
    try {
      const dbGaps = await prisma.aiShareOfVoice.findMany({
        where: {
          siteId,
          brandMentioned: false,
          competitorsMentioned: { has: competitorDomain },
        },
        select: { keyword: true },
        distinct: ["keyword"],
        orderBy: { recordedAt: "desc" },
        take: 10,
      });
      for (const r of dbGaps) {
        if (!gapKeywords.includes(r.keyword)) gapKeywords.push(r.keyword);
      }
    } catch {
      // Non-fatal
    }
  }

  // Load content profile from the most relevant gap keyword
  let contentProfile: CompetitorContentProfile | null = null;
  if (gapKeywords.length > 0) {
    try {
      const profileKey = `comp-profile:${siteId}:${gapKeywords[0].toLowerCase().replace(/\s+/g, "-")}`;
      contentProfile = await redis.get<CompetitorContentProfile>(profileKey);
    } catch {
      // Non-fatal
    }
  }

  // Compute DR gap
  const clientDr = site.ahrefsSnapshots[0]?.domainRating ?? null;
  const competitorDr = competitor.competitorAhrefsSnapshots[0]?.domainRating ?? null;
  const drGap = clientDr !== null && competitorDr !== null
    ? competitorDr - clientDr
    : null;

  const plan = await generateBeatCompetitorPlan({
    siteId,
    clientDomain: site.domain,
    competitorDomain,
    gapKeywords,
    contentProfile,
    geoProfile: competitorGeoProfile as GeoFitnessSignals | null,
    clientGeoProfile,
    entityProfile: competitorEntityProfile as EntityProfile | null,
    clientEntityProfile,
    drGap,
  });

  if (!plan)
    return NextResponse.json(
      { error: "Plan generation unavailable — check GEMINI_API_KEY" },
      { status: 503 },
    );

  return NextResponse.json(plan);
}
