import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdminApi();
  if (guard instanceof NextResponse) return guard;

  const [totalBlogs, statusBreakdown, topProducers] = await Promise.all([
    prisma.blog.count(),

    prisma.blog.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),

    prisma.site.findMany({
      select: {
        id: true,
        domain: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { blogs: true } },
        blogs: {
          select: { status: true },
        },
      },
      orderBy: { blogs: { _count: "desc" } },
      take: 20,
    }),
  ]);

  const producers = topProducers.map((s) => ({
    siteId: s.id,
    domain: s.domain,
    userId: s.user.id,
    userName: s.user.name,
    userEmail: s.user.email,
    totalBlogs: s._count.blogs,
    published: s.blogs.filter((b) => b.status === "PUBLISHED").length,
    draft: s.blogs.filter((b) => b.status === "DRAFT").length,
  }));

  return NextResponse.json({
    totalBlogs,
    statusBreakdown: statusBreakdown.map((s) => ({
      status: s.status,
      count: s._count._all,
    })),
    topProducers: producers,
  });
}
