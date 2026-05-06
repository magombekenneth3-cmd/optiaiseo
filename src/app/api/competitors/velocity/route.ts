export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import type { VelocityDiff } from "@/lib/competitors/content-velocity";

/**
 * GET /api/competitors/velocity?siteId=xxx
 *
 * Returns the latest content velocity diff for all tracked competitors.
 * Data is written by the weekly Inngest cron (competitor-velocity-tracker).
 *
 * Response:
 * {
 *   diffs: VelocityDiff[],   // sorted by newPages desc
 *   lastUpdated: string | null,
 *   cached: boolean
 * }
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId)
    return NextResponse.json({ error: "siteId required" }, { status: 400 });

  // Ownership check
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: user.id },
    select: { id: true },
  });
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const diffs = await redis.get<VelocityDiff[]>(`vel-diff:${siteId}`);
    if (!diffs || diffs.length === 0) {
      return NextResponse.json({
        diffs: [],
        lastUpdated: null,
        message: "No velocity data yet — data is collected weekly. Check back after the next Monday cron run.",
      });
    }

    const sorted = [...diffs].sort((a, b) => b.newPages.length - a.newPages.length);
    const lastUpdated = sorted[0]?.diffedAt ?? null;

    return NextResponse.json({ diffs: sorted, lastUpdated, cached: true }, {
        headers: { "Cache-Control": "private, s-maxage=21600, stale-while-revalidate=600" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Redis unavailable", detail: (err as Error)?.message },
      { status: 503 },
    );
  }
}
