import { prisma } from "@/lib/prisma";
import { JobStatusResponse, JobStatus, JobType } from "./types";
import "@/lib/server-only";

/**
 * Returns all active (queued or running) jobs belonging to the specified userId.
 */
export async function getUserActiveJobs(userId: string): Promise<JobStatusResponse[]> {
    const userSites = await prisma.site.findMany({
        where: { userId },
        select: { id: true, domain: true },
    });

    if (userSites.length === 0) return [];
    const siteIds = userSites.map(s => s.id);
    const domainMap = new Map(userSites.map(s => [s.id, s.domain]));

    const jobs: JobStatusResponse[] = [];

    // 1. AEO Scan Jobs (AeoReport where status in PENDING / RUNNING)
    const aeoReports = await prisma.aeoReport.findMany({
        where: {
            siteId: { in: siteIds },
            status: { in: ["PENDING", "RUNNING"] },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
    });

    for (const report of aeoReports) {
        const domain = domainMap.get(report.siteId) ?? "site";
        const status: JobStatus = report.status === "RUNNING" ? "running" : "queued";
        const progressPct = status === "running" ? 65 : 20;

        jobs.push({
            id: `aeo-${report.id}`,
            type: "AEO_SCAN",
            status,
            title: `AEO Audit — ${domain}`,
            progressPct,
            startedAt: report.createdAt.toISOString(),
            targetHref: `/dashboard/aeo?siteId=${report.siteId}`,
        });
    }

    // 2. SEO Audits (Audit with fixStatus === "PENDING" created in last 15 min)
    const recentAudits = await prisma.audit.findMany({
        where: {
            siteId: { in: siteIds },
            fixStatus: "PENDING",
            runTimestamp: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
        orderBy: { runTimestamp: "desc" },
        take: 3,
    });

    for (const audit of recentAudits) {
        const domain = domainMap.get(audit.siteId) ?? "site";
        jobs.push({
            id: `audit-${audit.id}`,
            type: "SEO_AUDIT",
            status: "running",
            title: `SEO Audit — ${domain}`,
            progressPct: 45,
            startedAt: audit.runTimestamp.toISOString(),
            targetHref: `/dashboard/audits/${audit.id}`,
        });
    }

    // 3. Competitor Page Analysis
    const competitorAnalyses = await prisma.competitorPageAnalysis.findMany({
        where: {
            userId,
            status: { in: ["pending", "running"] },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
    });

    for (const cpa of competitorAnalyses) {
        jobs.push({
            id: `comp-${cpa.id}`,
            type: "CONTENT_GEN",
            status: cpa.status === "running" ? "running" : "queued",
            title: `Competitor Analysis — ${cpa.keyword}`,
            progressPct: 50,
            startedAt: cpa.createdAt.toISOString(),
            targetHref: `/dashboard/keywords?siteId=${cpa.siteId}`,
        });
    }

    return jobs;
}

/**
 * Returns authoritative job status for a single job ID, enforcing user ownership.
 */
export async function getJobByIdForUser(userId: string, rawJobId: string): Promise<JobStatusResponse | null> {
    const userSites = await prisma.site.findMany({
        where: { userId },
        select: { id: true, domain: true },
    });
    const siteIds = new Set(userSites.map(s => s.id));
    const domainMap = new Map(userSites.map(s => [s.id, s.domain]));

    // Handle prefixed job IDs: e.g. "aeo-cuid123", "audit-cuid123", "comp-cuid123"
    let prefix = "";
    let realId = rawJobId;

    if (rawJobId.startsWith("aeo-")) {
        prefix = "aeo";
        realId = rawJobId.slice(4);
    } else if (rawJobId.startsWith("audit-")) {
        prefix = "audit";
        realId = rawJobId.slice(6);
    } else if (rawJobId.startsWith("comp-")) {
        prefix = "comp";
        realId = rawJobId.slice(5);
    }

    // 1. AEO Report Job
    if (prefix === "aeo" || !prefix) {
        const report = await prisma.aeoReport.findUnique({
            where: { id: realId },
            include: { site: { select: { userId: true, domain: true } } },
        });

        if (report && siteIds.has(report.siteId)) {
            const status: JobStatus =
                report.status === "COMPLETED" ? "completed" :
                report.status === "FAILED" ? "failed" :
                report.status === "RUNNING" ? "running" : "queued";

            return {
                id: `aeo-${report.id}`,
                type: "AEO_SCAN",
                status,
                title: `AEO Audit — ${report.site.domain}`,
                progressPct: status === "completed" ? 100 : status === "running" ? 65 : status === "failed" ? 100 : 20,
                startedAt: report.createdAt.toISOString(),
                completedAt: status === "completed" || status === "failed" ? new Date().toISOString() : undefined,
                targetHref: `/dashboard/aeo?siteId=${report.siteId}`,
                result: status === "completed" ? { score: report.score, grade: report.grade, reportId: report.id } : undefined,
                error: status === "failed" ? "AEO audit failed to complete" : undefined,
            };
        }
    }

    // 2. Technical SEO Audit
    if (prefix === "audit" || !prefix) {
        const audit = await prisma.audit.findUnique({
            where: { id: realId },
            include: { site: { select: { userId: true, domain: true } } },
        });

        if (audit && siteIds.has(audit.siteId)) {
            const status: JobStatus = audit.fixStatus === "COMPLETED" ? "completed" : audit.fixStatus === "FAILED" ? "failed" : "running";

            return {
                id: `audit-${audit.id}`,
                type: "SEO_AUDIT",
                status,
                title: `SEO Audit — ${audit.site.domain}`,
                progressPct: status === "completed" ? 100 : 50,
                startedAt: audit.runTimestamp.toISOString(),
                targetHref: `/dashboard/audits/${audit.id}`,
                result: status === "completed" ? { reportId: audit.id } : undefined,
            };
        }
    }

    // 3. Competitor Analysis
    if (prefix === "comp" || !prefix) {
        const cpa = await prisma.competitorPageAnalysis.findUnique({
            where: { id: realId },
        });

        if (cpa && cpa.userId === userId) {
            const status: JobStatus =
                cpa.status === "completed" ? "completed" :
                cpa.status === "failed" ? "failed" :
                cpa.status === "running" ? "running" : "queued";

            return {
                id: `comp-${cpa.id}`,
                type: "CONTENT_GEN",
                status,
                title: `Competitor Analysis — ${cpa.keyword}`,
                progressPct: status === "completed" ? 100 : 50,
                startedAt: cpa.createdAt.toISOString(),
                targetHref: `/dashboard/keywords?siteId=${cpa.siteId}`,
                error: cpa.error ?? undefined,
            };
        }
    }

    return null;
}
