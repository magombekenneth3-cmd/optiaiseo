/**
 * GET /api/diagnostics?siteId=xxx&status=FAIL,WARNING&severity=critical,high&lifecycleState=OPEN&remediationType=DETERMINISTIC,AI_PATCH&q=...&page=1&limit=20
 *
 * Returns diagnostic findings with their evidence trail, latest fix proposal, and site capabilities for the diagnostics dashboard.
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
    const lifecycleFilter = url.searchParams.get("lifecycleState")?.split(",").filter(Boolean) ?? [];
    const remediationFilter = url.searchParams.get("remediationType")?.split(",").filter(Boolean) ?? [];
    const query = url.searchParams.get("q")?.trim() ?? "";
    const parsedPage = parseInt(url.searchParams.get("page") ?? "1", 10);
    const parsedLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 20;
    const skip = (page - 1) * limit;

    // Verify the user owns this site
    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, gscConnected: true },
    });
    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userSitesRaw = typeof prisma.site.findMany === "function"
        ? await prisma.site.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, domain: true, githubRepoUrl: true },
        })
        : [];
    const sites = Array.isArray(userSitesRaw)
        ? userSitesRaw.map((s) => ({
            id: s.id,
            domain: s.domain,
            hasGithub: Boolean(s.githubRepoUrl),
        }))
        : [];

    // If no siteId, pick the user's first site
    let resolvedSiteId = siteId || sites[0]?.id || null;
    if (!resolvedSiteId && typeof prisma.site.findFirst === "function") {
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
            summary: { total: 0, byStatus: {}, bySeverity: {}, byLifecycleState: {} },
            pagination: { page: 1, limit, total: 0, totalPages: 0 },
            siteId: null,
            sites,
            siteCapabilities: { hasGithub: false, gscConnected: Boolean(user.gscConnected) },
        });
    }

    // Verify ownership
    const site = await prisma.site.findUnique({
        where: { id: resolvedSiteId },
        select: { id: true, domain: true, userId: true, githubRepoUrl: true },
    });
    if (!site || site.userId !== user.id) {
        return NextResponse.json({ error: "Site not found or access denied" }, { status: 403 });
    }

    try {
        const where: Record<string, unknown> = { siteId: resolvedSiteId };
        if (statusFilter.length > 0) where.status = { in: statusFilter };
        if (severityFilter.length > 0) where.severity = { in: severityFilter };
        if (lifecycleFilter.length > 0) where.lifecycleState = { in: lifecycleFilter };
        if (remediationFilter.length > 0) where.remediationType = { in: remediationFilter };
        if (query) {
            where.OR = [
                { issueType: { contains: query, mode: "insensitive" } },
                { rootCause: { contains: query, mode: "insensitive" } },
                { expectedOutcome: { contains: query, mode: "insensitive" } },
                { fingerprint: { contains: query, mode: "insensitive" } },
            ];
        }

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
                prisma.diagnosticFindingRecord.groupBy({
                    by: ["lifecycleState"],
                    where: { siteId: resolvedSiteId },
                    _count: { lifecycleState: true },
                }),
            ]),
        ]);

        const [statusGroups, severityGroups, totalAll, lifecycleGroups] = summary;

        const byStatus: Record<string, number> = {};
        for (const g of statusGroups) byStatus[g.status] = g._count.status;

        const bySeverity: Record<string, number> = {};
        for (const g of severityGroups) bySeverity[g.severity] = g._count.severity;

        const byLifecycleState: Record<string, number> = {};
        for (const g of lifecycleGroups ?? []) byLifecycleState[g.lifecycleState] = g._count.lifecycleState;

        // Attach latest linked SeoFixProposal (if any) per finding
        const proposalMap = new Map<string, {
            id: string;
            status: string;
            prUrl: string | null;
            prNumber: number | null;
            filePath: string;
            deploymentStatus: string;
            createdAt: Date;
        }>();

        const findingIds = findings.map((f) => f.id);
        const proposalDelegate = (prisma as unknown as {
            seoFixProposal?: { findMany: (args: Record<string, unknown>) => Promise<Array<{
                id: string;
                diagnosticFindingId: string | null;
                status: string;
                prUrl: string | null;
                prNumber: number | null;
                filePath: string;
                deploymentStatus: string;
                createdAt: Date;
            }>> };
        }).seoFixProposal;

        if (findingIds.length > 0 && typeof proposalDelegate?.findMany === "function") {
            const proposals = await proposalDelegate.findMany({
                where: {
                    siteId: resolvedSiteId,
                    diagnosticFindingId: { in: findingIds },
                },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    diagnosticFindingId: true,
                    status: true,
                    prUrl: true,
                    prNumber: true,
                    filePath: true,
                    deploymentStatus: true,
                    createdAt: true,
                },
            });

            if (Array.isArray(proposals)) {
                for (const p of proposals) {
                    if (p.diagnosticFindingId && !proposalMap.has(p.diagnosticFindingId)) {
                        proposalMap.set(p.diagnosticFindingId, {
                            id: p.id,
                            status: p.status,
                            prUrl: p.prUrl,
                            prNumber: p.prNumber,
                            filePath: p.filePath,
                            deploymentStatus: p.deploymentStatus,
                            createdAt: p.createdAt,
                        });
                    }
                }
            }
        }

        const enrichedFindings = findings.map((f) => ({
            ...f,
            latestProposal: proposalMap.get(f.id) ?? null,
        }));

        return NextResponse.json({
            findings: enrichedFindings,
            summary: { total: totalAll, byStatus, bySeverity, byLifecycleState },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            siteId: resolvedSiteId,
            domain: site.domain,
            sites,
            siteCapabilities: {
                hasGithub: Boolean(site.githubRepoUrl),
                gscConnected: Boolean(user.gscConnected),
            },
        });
    } catch (err) {
        return NextResponse.json({
            error: "Diagnostics query failed",
            detail: (err as Error)?.message,
        }, { status: 500 });
    }
}
