import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  subscriptionTier: string;
  role: string;
  createdAt: Date;
  sites_count: bigint;
  blogs_count: bigint;
  audits_count: bigint;
};

type CountRow = {
  count: bigint;
};

export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = 20;
  const skip = (page - 1) * limit;
  const search = (searchParams.get("search") ?? "").toLowerCase();
  const tier = searchParams.get("tier") ?? "";

  // Only allow known enum values — prevents any injection through tier param
  const allowedTiers = ["FREE", "PRO", "AGENCY"] as const;
  const safeTier = allowedTiers.includes(tier as typeof allowedTiers[number])
    ? (tier as typeof allowedTiers[number])
    : null;

  const searchPattern = search ? `%${search}%` : null;

  // Prisma.sql is a tagged template — every ${} value is a bind parameter,
  // never concatenated into the query string. Injection-proof.
  const users = await prisma.$queryRaw<UserRow[]>(Prisma.sql`
    SELECT
      u.id,
      u.name,
      u.email,
      u."subscriptionTier",
      u.role::text AS role,
      u."createdAt",
      COUNT(DISTINCT s.id) AS sites_count,
      COUNT(DISTINCT b.id) AS blogs_count,
      COUNT(DISTINCT a.id) AS audits_count
    FROM "User" u
    LEFT JOIN "Site" s ON s."userId" = u.id
    LEFT JOIN "Blog" b ON b."siteId" = s.id
    LEFT JOIN "Audit" a ON a."siteId" = s.id
    WHERE 1=1
      ${safeTier !== null ? Prisma.sql`AND u."subscriptionTier" = ${safeTier}` : Prisma.empty}
      ${searchPattern !== null ? Prisma.sql`AND (
        LOWER(u.email) LIKE ${searchPattern}
        OR LOWER(u.name)  LIKE ${searchPattern}
      )` : Prisma.empty}
    GROUP BY u.id
    ORDER BY u."createdAt" DESC
    LIMIT ${limit} OFFSET ${skip}
  `);

  const total = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM "User" u
    WHERE 1=1
      ${safeTier !== null ? Prisma.sql`AND u."subscriptionTier" = ${safeTier}` : Prisma.empty}
      ${searchPattern !== null ? Prisma.sql`AND (
        LOWER(u.email) LIKE ${searchPattern}
        OR LOWER(u.name)  LIKE ${searchPattern}
      )` : Prisma.empty}
  `);

  const formatted = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    tier: u.subscriptionTier,
    role: u.role,
    joinDate: u.createdAt,
    sitesCount: Number(u.sites_count),
    blogsCount: Number(u.blogs_count),
    auditsCount: Number(u.audits_count),
  }));

  const totalCount = Number(total[0]?.count ?? 0);

  return NextResponse.json({
    users: formatted,
    total: totalCount,
    page,
    pages: Math.ceil(totalCount / limit),
  });
}