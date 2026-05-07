import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type MonthlyTrendRow = {
  month: Date;
  pro: bigint;
  agency: bigint;
};

type TopUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  subscriptionTier: string;
};

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const [proCount, agencyCount] = await Promise.all([
    prisma.user.count({ where: { subscriptionTier: "PRO" } }),
    prisma.user.count({ where: { subscriptionTier: "AGENCY" } }),
  ]);

  const mrr = proCount * 39 + agencyCount * 99;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyTrend = await prisma.$queryRaw<MonthlyTrendRow[]>`
    SELECT
      DATE_TRUNC('month', "createdAt") AS month,
      COUNT(*) FILTER (WHERE "subscriptionTier" = 'PRO') AS pro,
      COUNT(*) FILTER (WHERE "subscriptionTier" = 'AGENCY') AS agency
    FROM "User"
    WHERE "subscriptionTier" IN ('PRO', 'AGENCY')
      AND "createdAt" >= ${sixMonthsAgo}
    GROUP BY month
    ORDER BY month ASC
  `;

  const topUsers = await prisma.$queryRaw<TopUserRow[]>`
    SELECT id, name, email, "subscriptionTier"
    FROM "User"
    WHERE "subscriptionTier" IN ('PRO', 'AGENCY')
    ORDER BY
      CASE "subscriptionTier" WHEN 'AGENCY' THEN 0 ELSE 1 END ASC
    LIMIT 10
  `;

  return NextResponse.json({
    mrr,
    proCount,
    agencyCount,
    monthlyTrend: monthlyTrend.map((m) => ({
      month: m.month.toISOString().split("T")[0],
      pro: Number(m.pro),
      agency: Number(m.agency),
      revenue: Number(m.pro) * 39 + Number(m.agency) * 99,
    })),
    topUsers: topUsers.map((u) => ({
      ...u,
      mrr: u.subscriptionTier === "AGENCY" ? 99 : 39,
    })),
  });
}