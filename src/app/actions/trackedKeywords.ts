"use server";

import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import prisma               from "@/lib/prisma";
import { revalidatePath }   from "next/cache";
import { logger }           from "@/lib/logger";
import { limiters }         from "@/lib/rate-limit";
import { hasFeature }       from "@/lib/stripe/plans";
import { estimateKeywordRoi, opportunityGap } from "@/lib/keywords/roi";
import { requireFeature, requireWithinLimit, guardErrorToResult } from "@/lib/stripe/guards";

async function requireSiteOwner(siteId: string, userEmail: string) {
    return prisma.site.findFirst({
        where: {
            id: siteId,
            user: { email: userEmail },
        },
        select: {
            id: true,
            user: {
                select: {
                    id: true,
                    subscriptionTier: true,
                },
            },
        },
    });
}

export async function addTrackedKeyword(
    siteId: string,
    keyword: string,
    locationCode = 2840,
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const rl = await limiters.api.limit(`tracked-kw-add:${session.user.email}`);
    if (!rl.success) return { success: false, error: "Too many requests" };

    const site = await requireSiteOwner(siteId, session.user.email);
    if (!site) return { success: false, error: "Site not found or access denied" };

    const { user } = site;
    try {
        await requireFeature(user.id, "rankTracking");
    } catch (err) {
        return guardErrorToResult(err);
    }

    const clean = keyword.trim().replace(/[\x00-\x1F]/g, "").slice(0, 200);
    if (!clean) return { success: false, error: "Invalid keyword" };

    const count = await prisma.trackedKeyword.count({ where: { siteId } });
    try {
        await requireWithinLimit(user.id, "keywordsTracked", count);
    } catch (err) {
        return guardErrorToResult(err);
    }

    try {
        const tk = await prisma.trackedKeyword.create({
            data: { siteId, keyword: clean, locationCode, addedBy: user.id },
        });
        revalidatePath("/dashboard/keywords");
        return { success: true, tracked: tk };
    } catch (e: unknown) {
        if ((e as { code?: string }).code === "P2002")
            return { success: false, error: "Keyword already tracked" };
        logger.error("[TrackedKeywords] add failed", { error: (e as Error).message });
        return { success: false, error: "Server error" };
    }
}

export async function removeTrackedKeyword(siteId: string, trackedId: string) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const site = await requireSiteOwner(siteId, session.user.email);
    if (!site) return { success: false, error: "Access denied" };

    const tk = await prisma.trackedKeyword.findFirst({
        where: { id: trackedId, siteId },
        select: { id: true },
    });
    if (!tk) return { success: false, error: "Tracked keyword not found" };

    await prisma.trackedKeyword.delete({ where: { id: trackedId } });
    revalidatePath("/dashboard/keywords");
    return { success: true };
}

export async function getTrackedKeywords(siteId: string) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const site = await requireSiteOwner(siteId, session.user.email);
    if (!site) return { success: false, error: "Access denied" };

    const keywords = await prisma.trackedKeyword.findMany({
        where: { siteId },
        select: {
            id: true,
            keyword: true,
            locationCode: true,
            addedAt: true,
            snapshots: {
                where: {
                    recordedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
                },
                orderBy: { recordedAt: "asc" },
                select: { position: true, recordedAt: true, searchVolume: true, cpc: true },
            },
        },
        orderBy: { addedAt: "desc" },
    });

    const enriched = keywords.map((tk) => {
        const latest = tk.snapshots.at(-1);
        const roi = latest?.searchVolume && latest.position > 0
            ? estimateKeywordRoi({
                position:     latest.position,
                searchVolume: latest.searchVolume,
                cpc:          latest.cpc ?? 1,
            })
            : null;

        const gap = latest?.searchVolume && latest.position > 3
            ? opportunityGap({
                currentPosition: latest.position,
                searchVolume:    latest.searchVolume,
                cpc:             latest.cpc ?? 1,
            })
            : 0;

        return { ...tk, roi, opportunityGapUsd: gap };
    });

    return { success: true, keywords: enriched };
}

export { opportunityGap };
