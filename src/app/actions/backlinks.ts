"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
    getBacklinkSummary,
    getBacklinkDetails,
    getCompetitorBacklinkGap,
} from "@/lib/backlinks";
import { getBacklinkQualitySummary } from "@/lib/backlinks/quality-analysis";

// ─── Auth guard helper ────────────────────────────────────────────────────────
async function assertSiteOwner(siteId: string): Promise<string> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new Error("Unauthenticated");
    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });
    if (!user) throw new Error("User not found");
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true, domain: true },
    });
    if (!site) throw new Error("Site not found or not owned by user");
    return site.domain;
}

// ─── Summary + quality in one call ───────────────────────────────────────────
export async function getBacklinkOverview(siteId: string) {
    try {
        const domain = await assertSiteOwner(siteId);
        const [summary, quality, alerts] = await Promise.allSettled([
            getBacklinkSummary(domain, siteId),
            getBacklinkQualitySummary(siteId),
            prisma.backlinkAlert.findMany({
                where: { siteId },
                orderBy: { detectedAt: "desc" },
                take: 10,
                select: { id: true, type: true, domain: true, dr: true, detectedAt: true },
            }),
        ]);

        return {
            success: true as const,
            domain,
            summary:  summary.status  === "fulfilled" ? summary.value   : null,
            quality:  quality.status  === "fulfilled" ? quality.value    : null,
            alerts:   alerts.status   === "fulfilled" ? alerts.value     : [],
        };
    } catch (err) {
        return { success: false as const, error: (err as Error).message };
    }
}

// ─── Recent backlink list ─────────────────────────────────────────────────────
export async function getBacklinkList(siteId: string, limit = 50) {
    try {
        const domain = await assertSiteOwner(siteId);
        const details = await getBacklinkDetails(domain, limit);
        return { success: true as const, details };
    } catch (err) {
        return { success: false as const, error: (err as Error).message, details: [] };
    }
}

// ─── Competitor gap report ────────────────────────────────────────────────────
export async function getBacklinkGap(siteId: string, competitorDomain: string) {
    try {
        const domain = await assertSiteOwner(siteId);
        const report = await getCompetitorBacklinkGap(domain, competitorDomain);
        return { success: true as const, report };
    } catch (err) {
        return { success: false as const, error: (err as Error).message };
    }
}
