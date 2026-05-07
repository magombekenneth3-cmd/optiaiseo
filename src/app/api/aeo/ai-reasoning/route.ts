export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { getAiReasoningForGap } from "@/lib/aeo/ai-reasoning";
import { redis } from "@/lib/redis";
import type { CompetitorContentProfile } from "@/lib/aeo/competitor-content-profile";

/**
 * GET /api/aeo/ai-reasoning?siteId=xxx&competitorDomain=yyy&keyword=zzz
 *
 * Returns Gemini's structured reasoning for why a competitor is cited
 * by AI engines instead of the client for a specific keyword.
 *
 * Enriches the prompt with any existing comp-profile Redis data for the
 * same (siteId, keyword) pair — no extra API calls needed.
 *
 * Cached in Redis for 7 days. Pass ?bust=1 to force a refresh.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const siteId = searchParams.get("siteId");
  const competitorDomain = searchParams.get("competitorDomain");
  const keyword = searchParams.get("keyword");

  if (!siteId || !competitorDomain || !keyword)
    return NextResponse.json(
      { error: "siteId, competitorDomain and keyword are required" },
      { status: 400 },
    );

  // Ownership + domain fetch in one query
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: { id: true, domain: true },
  });
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Load any existing comp-profile for richer Gemini context (best-effort)
  let competitorProfile: CompetitorContentProfile | null = null;
  try {
    const profileKey = `comp-profile:${siteId}:${keyword.toLowerCase().replace(/\s+/g, "-")}`;
    competitorProfile = await redis.get<CompetitorContentProfile>(profileKey);
  } catch {
    // Non-fatal
  }

  const bust = searchParams.get("bust") === "1";
  if (bust) {
    // Clear the cached reasoning so getAiReasoningForGap will regenerate
    try {
      const slug = keyword.toLowerCase().replace(/\s+/g, "-").slice(0, 80);
      await redis.del(`ai-reasoning:${siteId}:${competitorDomain}:${slug}`);
    } catch {
      // Non-fatal
    }
  }

  const result = await getAiReasoningForGap(
    siteId,
    site.domain,
    competitorDomain,
    keyword,
    competitorProfile,
  );

  if (!result)
    return NextResponse.json(
      { error: "Reasoning unavailable — check GEMINI_API_KEY" },
      { status: 503 },
    );

  return NextResponse.json(result);
}
