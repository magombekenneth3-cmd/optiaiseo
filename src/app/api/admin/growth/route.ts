import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000);

  const weeklySignups = await prisma.$queryRaw<{ week: Date; count: bigint }[]>`
    SELECT DATE_TRUNC('week', "createdAt") AS week, COUNT(*) AS count
    FROM "User"
    WHERE "createdAt" >= ${twelveWeeksAgo}
    GROUP BY week
    ORDER BY week ASC
  `;

  const cumulativeTotal = await prisma.user.count();

  const [proCount, agencyCount, freeCount] = await Promise.all([
    prisma.user.count({ where: { subscriptionTier: "PRO" } }),
    prisma.user.count({ where: { subscriptionTier: "AGENCY" } }),
    prisma.user.count({ where: { subscriptionTier: "FREE" } }),
  ]);

  return NextResponse.json({
    weeklySignups: weeklySignups.map((w) => ({
      week: w.week.toISOString().split("T")[0],
      count: Number(w.count),
    })),
    cumulativeTotal,
    funnel: { free: freeCount, pro: proCount, agency: agencyCount },
  });
}