import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { createHash } from "crypto";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AeoScorePayload = {
  siteId: string;
  domain: string;
  score: number;
  grade: string;
  citationScore: number;
  generativeShareOfVoice: number;
  lastCheckedAt: string;
};

async function resolveApiKey(authHeader: string | null): Promise<{ userId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw  = authHeader.slice(7);
  const hash = createHash("sha256").update(raw).digest("hex");

  const cacheKey = `apikey:${hash}`;
  try {
    const cached = await redis.get<string>(cacheKey);
    if (cached) return { userId: cached };
  } catch { /* Redis unavailable — fall through */ }

  const key = await prisma.apiKey.findFirst({
    where: {
      keyHash: hash,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, userId: true },
  });

  if (!key) return null;

  try { await redis.set(cacheKey, key.userId, { ex: 300 }); } catch { /* ignore */ }

  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { userId: key.userId };
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await resolveApiKey(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized. Pass a valid Bearer token." }, { status: 401 });
  }

  // SECURITY: rate limit public API — 60 req/min per API key (hashed)
  const keyHash = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest("hex")
    .substring(0, 16);
  const rl = await checkRateLimit(`v1-aeo-score:${keyHash}`, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 60 requests/minute per API key." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId");

  if (!siteId) {
    return NextResponse.json({ error: "Missing siteId query parameter." }, { status: 400 });
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: auth.userId },
    select: {
      id: true,
      domain: true,
      aeoReports: {
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          score: true,
          grade: true,
          citationScore: true,
          generativeShareOfVoice: true,
          createdAt: true,
        },
      },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found or access denied." }, { status: 404 });
  }

  const report = site.aeoReports[0];
  if (!report) {
    return NextResponse.json({ error: "No completed AEO report found for this site." }, { status: 404 });
  }

  const payload: AeoScorePayload = {
    siteId: site.id,
    domain: site.domain,
    score: report.score,
    grade: report.grade,
    citationScore: report.citationScore,
    generativeShareOfVoice: report.generativeShareOfVoice,
    lastCheckedAt: report.createdAt.toISOString(),
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, s-maxage=900, stale-while-revalidate=60" },
  });
}
