import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Per-user audit + blog counts using raw SQL for correctness
  const usageRaw = await prisma.$queryRaw<
    {
      id: string;
      name: string | null;
      email: string | null;
      subscriptionTier: string;
      audits_month: bigint;
      blogs_month: bigint;
      audits_total: bigint;
      blogs_total: bigint;
      aeo_total: bigint;
    }[]
  >`
    SELECT
      u.id,
      u.name,
      u.email,
      u."subscriptionTier",
      COALESCE(SUM(CASE WHEN a."runTimestamp" >= ${startOfMonth} THEN 1 ELSE 0 END), 0) AS audits_month,
      COALESCE(SUM(CASE WHEN b."createdAt" >= ${startOfMonth} AND b.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS blogs_month,
      COUNT(DISTINCT a.id) AS audits_total,
      COUNT(DISTINCT b.id) AS blogs_total,
      COUNT(DISTINCT ae.id) AS aeo_total
    FROM "User" u
    LEFT JOIN "Site" s ON s."userId" = u.id
    LEFT JOIN "Audit" a ON a."siteId" = s.id
    LEFT JOIN "Blog" b ON b."siteId" = s.id
    LEFT JOIN "AeoSnapshot" ae ON ae."siteId" = s.id
    GROUP BY u.id, u.name, u.email, u."subscriptionTier"
    ORDER BY (COALESCE(SUM(CASE WHEN a."runTimestamp" >= ${startOfMonth} THEN 1 ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN b."createdAt" >= ${startOfMonth} AND b.id IS NOT NULL THEN 1 ELSE 0 END), 0)) DESC
    LIMIT 50
  `;

  const usage = usageRaw.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    tier: u.subscriptionTier,
    auditsThisMonth: Number(u.audits_month),
    blogsThisMonth: Number(u.blogs_month),
    auditsTotal: Number(u.audits_total),
    blogsTotal: Number(u.blogs_total),
    aeoChecksTotal: Number(u.aeo_total),
  }));

  // Usage heatmap: audits by day-of-week and hour
  const heatmapRaw = await prisma.$queryRaw<
    { dow: number; hour: number; count: bigint }[]
  >`
    SELECT
      EXTRACT(DOW FROM "runTimestamp")::int AS dow,
      EXTRACT(HOUR FROM "runTimestamp")::int AS hour,
      COUNT(*) AS count
    FROM "Audit"
    WHERE "runTimestamp" >= NOW() - INTERVAL '90 days'
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;

  return NextResponse.json({
    users: usage,
    heatmap: heatmapRaw.map((h) => ({
      dow: h.dow,
      hour: h.hour,
      count: Number(h.count),
    })),
  });
}
