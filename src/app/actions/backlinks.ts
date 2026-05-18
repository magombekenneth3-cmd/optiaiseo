"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

// ─── Infer outreach type from domain heuristics ───────────────────────────────
function inferOutreachType(domain: string): "guest_post" | "resource_page" | "broken_link" | "quora" | "medium" | "podcast" | "haro" | "other" {
    if (/quora\.com/.test(domain)) return "quora";
    if (/medium\.com/.test(domain)) return "medium";
    if (/podcast|anchor\.fm|buzzsprout|simplecast/.test(domain)) return "podcast";
    return "resource_page"; // safe default for high-DR referring domains
}

// ─── Add gap opportunity → planner item ──────────────────────────────────────
/**
 * Moves a competitor gap opportunity into an existing PlannerItem's backlink
 * target list. Called from the BacklinksClient "+ Planner" button.
 *
 * Ownership check:
 *   • assertSiteOwner validates siteId belongs to the session user.
 *   • The upsertBacklinkTarget call also verifies itemId ∈ siteId.
 */
export async function addBacklinkTargetFromGap(
    siteId: string,
    itemId: string,
    domain: string,
    dr: number | null,
): Promise<{ success: boolean; error?: string }> {
    try {
        await assertSiteOwner(siteId);

        const { upsertBacklinkTarget } = await import("@/app/actions/planner");

        const type = inferOutreachType(domain);
        const tier = (dr != null && dr > 50) ? 2 : 1;

        const target = {
            id:     `gap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            domain,
            type,
            tier:   tier as 1 | 2 | 3,
            status: "Idea" as const,
            dr:     dr ?? undefined,
            note:   "Added from competitor gap analysis",
        };

        return await upsertBacklinkTarget(siteId, itemId, target);
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}

// ─── List planner items (for the gap → planner modal picker) ─────────────────
export async function getPlannerItemsForSite(siteId: string): Promise<{
    success: boolean;
    items?: { id: string; keyword: string; title: string | null }[];
    error?: string;
}> {
    try {
        await assertSiteOwner(siteId);
        const items = await prisma.plannerItem.findMany({
            where:   { siteId },
            select:  { id: true, keyword: true, title: true },
            orderBy: { createdAt: "desc" },
            take:    50,
        });
        return { success: true, items };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}
