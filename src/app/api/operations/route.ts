import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/operations?siteId=xxx&status=EXECUTING&page=1&limit=20
 *
 * Returns paginated list of MutationOperations for a site.
 * Includes summary counts by status for the dashboard header.
 */
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const siteId = sp.get("siteId");
    if (!siteId) {
        return NextResponse.json({ error: "siteId is required" }, { status: 400 });
    }

    // Ownership check
    const site = await prisma.site.findFirst({
        where: {
            id: siteId,
            OR: [{ userId: session.user.id }, { viewerId: session.user.id }],
        },
        select: { id: true, domain: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 403 });
    }

    const status = sp.get("status") || undefined;
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { siteId };
    if (status) where.status = status;

    const [operations, total, statusCounts] = await Promise.all([
        (prisma as any).mutationOperation.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                siteId: true,
                mutationType: true,
                targetModel: true,
                targetId: true,
                actorId: true,
                actorType: true,
                riskLevel: true,
                riskScore: true,
                status: true,
                affectedFields: true,
                diffSizeBytes: true,
                createdAt: true,
                updatedAt: true,
                completedAt: true,
                approvedBy: true,
                approvedAt: true,
                _count: {
                    select: {
                        effects: true,
                        auditEvents: true,
                    },
                },
            },
        }),
        (prisma as any).mutationOperation.count({ where }),
        // Status counts for summary bar
        (prisma as any).mutationOperation.groupBy({
            by: ["status"],
            where: { siteId },
            _count: { _all: true },
        }),
    ]);

    // Transform status counts into a map
    const counts: Record<string, number> = {};
    for (const row of statusCounts) {
        counts[row.status] = row._count._all;
    }

    return NextResponse.json({
        operations,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
        statusCounts: counts,
    });
}
