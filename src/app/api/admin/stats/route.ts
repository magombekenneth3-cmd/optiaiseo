import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalUsers, proCount, agencyCount, totalBlogs, totalAudits] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { subscriptionTier: "PRO" } }),
      prisma.user.count({ where: { subscriptionTier: "AGENCY" } }),
      prisma.blog.count(),
      prisma.audit.count({ where: { runTimestamp: { gte: thirtyDaysAgo } } }),
    ]);

  const newThisMonth = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM "User" WHERE "createdAt" >= ${startOfMonth}
  `;

  const freeCount = totalUsers - proCount - agencyCount;
  const mrr = proCount * 39 + agencyCount * 99;
  const activeSubscribers = proCount + agencyCount;

  const dailySignups = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
    FROM "User"
    WHERE "createdAt" >= ${thirtyDaysAgo}
    GROUP BY day
    ORDER BY day ASC
  `;

  return NextResponse.json({
    totalUsers,
    newThisMonth: Number(newThisMonth[0]?.count ?? 0),
    proCount,
    agencyCount,
    freeCount,
    mrr,
    activeSubscribers,
    totalBlogs,
    totalAudits,
    dailySignups: dailySignups.map((d) => ({
      day: d.day.toISOString().split("T")[0],
      count: Number(d.count),
    })),
  });
}