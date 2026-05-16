"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withinLimit, getPlan } from "@/lib/stripe/plans";
import { requireFeature, guardErrorToResult } from "@/lib/stripe/guards";
import { consumeCredits } from "@/lib/credits";
import { fetchCompetitorKeywordGaps } from "@/lib/competitors";

// Types

type ActionResult<T = undefined> =
    | { success: true; data?: T }
    | { success: false; error: string };

type Competitor = Awaited<ReturnType<typeof prisma.competitor.findMany>>[number];

type KeywordGap = {
    keyword: string;
    searchVolume: number;
    difficulty: number;
    position: number;
    url?: string;
    estimatedMonthlyVisits: number;
    intent?: "informational" | "commercial" | "transactional" | "navigational";
    serpFeatures?: Partial<Record<string, boolean>>;
    competitorDomain: string;
};

// Auth helper — single DB call, used by every action

async function getAuthedUser() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;

    return prisma.user.findUnique({
        where: { email: session.user.email },
    });
}

// Domain normalization

function normalizeDomain(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .split("?")[0]
        .trim();
}

// Actions

export async function getCompetitors(
    siteId: string
): Promise<ActionResult<Competitor[]>> {
    try {
        const user = await getAuthedUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const site = await prisma.site.findUnique({
            where: { id: siteId, userId: user.id },
        });
        if (!site) return { success: false, error: "Site not found or unauthorized" };

        const competitors = await prisma.competitor.findMany({
            where: { siteId },
            include: { _count: { select: { keywords: true } } },
            orderBy: { addedAt: "desc" },
        });

        return { success: true, data: competitors };
    } catch (error: unknown) {
        logger.error("Failed to fetch competitors", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Internal server error" };
    }
}

export async function addCompetitor(
    siteId: string,
    domain: string
): Promise<ActionResult> {
    try {
        const user = await getAuthedUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const cleanDomain = normalizeDomain(domain);
        if (!cleanDomain || !cleanDomain.includes(".")) {
            return { success: false, error: "Invalid domain format" };
        }

        try {
        await requireFeature(user.id, "competitor");
    } catch (err) {
        return guardErrorToResult(err);
    }

        const plan = getPlan(user.subscriptionTier ?? "FREE");
        const maxAllowed = plan.limits.competitorsPerSite as number;

        // Atomic transaction — prevents race condition where two concurrent
        // requests both pass the limit check before either inserts.
        try {
            await prisma.$transaction(async (tx) => {
                const site = await tx.site.findUnique({
                    where: { id: siteId, userId: user.id },
                    include: { competitors: true },
                });

                if (!site) throw new Error("UNAUTHORIZED");

                if (!withinLimit(user.subscriptionTier ?? "FREE", "competitorsPerSite", site.competitors.length)) {
                    throw new Error("LIMIT_EXCEEDED");
                }

                const existing = site.competitors.find(
                    (c) => c.domain === cleanDomain
                );
                if (existing) throw new Error("ALREADY_EXISTS");

                await tx.competitor.create({
                    data: { siteId, domain: cleanDomain },
                });
            });
        } catch (txError: unknown) {
            const msg =
                txError instanceof Error ? txError.message : String(txError);

            if (msg === "UNAUTHORIZED")
                return { success: false, error: "Site not found or unauthorized" };
            if (msg === "LIMIT_EXCEEDED")
                return {
                    success: false,
                    error: `You can track up to ${maxAllowed} competitor${maxAllowed !== 1 ? "s" : ""} per site on your plan. Upgrade to track more.`,
                };
            if (msg === "ALREADY_EXISTS")
                return { success: false, error: "Competitor already added." };

            throw txError; // unexpected — let outer catch handle it
        }

        revalidatePath(`/dashboard/sites/${siteId}/competitors`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to add competitor", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Internal server error" };
    }
}

export async function removeCompetitor(
    competitorId: string
): Promise<ActionResult> {
    try {
        const user = await getAuthedUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const comp = await prisma.competitor.findUnique({
            where: { id: competitorId },
            include: { site: true },
        });

        if (!comp || !comp.site || comp.site.userId !== user.id) {
            return { success: false, error: "Unauthorized or not found" };
        }

        await prisma.competitor.delete({ where: { id: competitorId } });

        revalidatePath(`/dashboard/sites/${comp.siteId}/competitors`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to remove competitor", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Internal server error" };
    }
}

export async function getKeywordGaps(siteId: string): Promise<ActionResult<KeywordGap[]>> {
    try {
        const user = await getAuthedUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const site = await prisma.site.findUnique({
            where: { id: siteId, userId: user.id },
            include: { competitors: true },
        });

        if (!site) return { success: false, error: "Site not found" };
        if (!site.competitors.length) return { success: true, data: [] as KeywordGap[] };

        const creditResult = await consumeCredits(user.id, "competitor_analysis");
        if (!creditResult.allowed) {
            return {
                success: false,
                error: creditResult.reason === "credits_locked"
                    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                    : `Not enough credits (${creditResult.remaining} remaining, need 8). Buy a credit pack or upgrade your plan.`,
                code: creditResult.reason ?? "insufficient_credits",
            };
        }

        const { default: pLimit } = await import("p-limit");
        const limit = pLimit(3);

        const allGaps = await Promise.all(
            site.competitors.map((comp) =>
                limit(async () => {
                    const gaps = await fetchCompetitorKeywordGaps(
                        site.domain,
                        comp.domain
                    );
                    return gaps.map((g): KeywordGap => ({
                        ...g,
                        competitorDomain: comp.domain,
                    }));
                })
            )
        );

        const flatGaps = allGaps
            .flat()
            .sort((a, b) => (b.searchVolume || 0) - (a.searchVolume || 0));

        return { success: true, data: flatGaps };
    } catch (error: unknown) {
        logger.error("Failed to fetch keyword gaps", {
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Internal server error" };
    }
}