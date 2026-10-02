/**
 * GET /api/diagnostics?siteId=xxx&status=FAIL,WARNING&severity=critical,high&page=1&limit=20
 *
 * Returns diagnostic findings with their evidence trail for the diagnostics dashboard.
 * Supports filtering by status, severity, and pagination.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const siteId = url.searchParams.get("siteId");
    const statusFilter = url.searchParams.get("status")?.split(",").filter(Boolean) ?? [];
    const severityFilter = url.searchParams.get("severity")?.split(",").filter(Boolean) ?? [];
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const skip = (page - 1) * limit;

    // Verify the user owns this site
    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });
    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If no siteId, pick the user's first site
    let resolvedSiteId = siteId;
    if (!resolvedSiteId) {
        const firstSite = await prisma.site.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        resolvedSiteId = firstSite?.id ?? null;
    }

    if (!resolvedSiteId) {
        return NextResponse.json({
            findings: [],
            summary: { total: 0, byStatus: {}, bySeverity: {} },
            pagination: { page: 1, limit, total: 0, totalPages: 0 },
            siteId: null,
        });
    }

    // Verify ownership
    const site = await prisma.site.findUnique({
        where: { id: resolvedSiteId },
        select: { id: true, domain: true, userId: true },
    });
    if (!site || site.userId !== user.id) {
        return NextResponse.json({ error: "Site not found or access denied" }, { status: 403 });
    }

    try {
        const where: any = { siteId: resolvedSiteId };
        if (statusFilter.length > 0) where.status = { in: statusFilter };
        if (severityFilter.length > 0) where.severity = { in: severityFilter };

        const [findings, total, summary] = await Promise.all([
            prisma.diagnosticFindingRecord.findMany({
                where,
                orderBy: [
                    { priorityScore: "desc" },
                    { createdAt: "desc" },
                ],
                skip,
                take: limit,
                include: {
                    evidence: {
                        orderBy: { observedAt: "desc" },
                        take: 10,
                        select: {
                            id: true,
                            source: true,
                            url: true,
                            observedAt: true,
                            observedValue: true,
                            confidence: true,
                        },
                    },
                },
            }),
            prisma.diagnosticFindingRecord.count({ where }),
            Promise.all([
                prisma.diagnosticFindingRecord.groupBy({
                    by: ["status"],
                    where: { siteId: resolvedSiteId },
                    _count: { status: true },
                }),
                prisma.diagnosticFindingRecord.groupBy({
                    by: ["severity"],
                    where: { siteId: resolvedSiteId },
                    _count: { severity: true },
                }),
                prisma.diagnosticFindingRecord.count({
                    where: { siteId: resolvedSiteId },
                }),
            ]),
        ]);

        const [statusGroups, severityGroups, totalAll] = summary;

        const byStatus: Record<string, number> = {};
        for (const g of statusGroups) byStatus[g.status] = g._count.status;

        const bySeverity: Record<string, number> = {};
        for (const g of severityGroups) bySeverity[g.severity] = g._count.severity;

        return NextResponse.json({
            findings,
            summary: { total: totalAll, byStatus, bySeverity },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            siteId: resolvedSiteId,
            domain: site.domain,
        });
    } catch (err) {
        return NextResponse.json({
            error: "Diagnostics query failed",
            detail: (err as Error)?.message,
        }, { status: 500 });
    }
}
