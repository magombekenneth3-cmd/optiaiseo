export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/stripe/plans";

export interface DrTrendPoint {
  date: string;
  dr: number;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { subscriptionTier: true },
  });

  if (!hasFeature(dbUser?.subscriptionTier ?? "FREE", "backlinks")) {
    return NextResponse.json(
      { error: "Backlink monitoring requires a Pro plan." },
      { status: 403 },
    );
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId, userId: user.id },
    select: { id: true },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const snapshots = await prisma.ahrefsSnapshot.findMany({
    where: {
      siteId,
      fetchedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { fetchedAt: "asc" },
    select: { domainRating: true, fetchedAt: true },
  });

  const trend: DrTrendPoint[] = snapshots
    .filter((s) => s.domainRating !== null)
    .map((s) => ({
      date: s.fetchedAt.toISOString().slice(0, 10),
      dr: Math.round(s.domainRating as number),
    }));

  return NextResponse.json({ trend });
}
