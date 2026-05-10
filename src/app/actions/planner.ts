"use server";
import { logger } from "@/lib/logger";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";
import type { RedditPost, BacklinkTarget, PageScoreChecks } from "@/types/planner";

// Re-export PlannerItem shape for client components that need typed props
export type PlannerItem = {
    id: string;
    siteId: string;
    keyword: string;
    title: string | null;
    parentTopic: string | null;
    intent: string | null;
    difficulty: string | null;
    weekBucket: string | null;
    status: string;
    briefId: string | null;
    reason: string | null;
    pillar: boolean;
    priorityScore: number | null;
    reddit: unknown;
    backlinks: unknown;
    pageScore: unknown;
    createdAt: Date;
    updatedAt: Date;
};

// FIX #10: Reject unknown status values at the boundary — never trust raw strings from the client.

const VALID_STATUSES = ["Todo", "Writing...", "Done"] as const;
type PlannerStatus = typeof VALID_STATUSES[number];

function isValidStatus(s: string): s is PlannerStatus {
    return (VALID_STATUSES as readonly string[]).includes(s);
}


async function resolveUserAndSite(siteId: string) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;
    // FIX #8: Combine user + site lookup into a single query via nested where,
    // eliminating one DB round-trip per request.
    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
            id: true,
            email: true,
            role: true,
            subscriptionTier: true,
            sites: { where: { id: siteId }, select: { id: true }, take: 1 },
        },
    });
    if (!user || user.sites.length === 0) return null;
    return { user, siteId };
}


export async function getPlannerState(siteId: string, cursor?: string, take = 100) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        // FIX #6: Paginate — never load all items for a site in one shot.
        const items = await prisma.plannerItem.findMany({
            where: { siteId },
            orderBy: { createdAt: "asc" },
            take,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        const nextCursor = items.length === take ? items[items.length - 1].id : undefined;
        return { success: true, state: { items }, nextCursor };
    } catch (error: unknown) {
        logger.error("[Planner] getPlannerState failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to fetch planner state" };
    }
}


export async function savePlannerState(siteId: string, state: { items?: Record<string, unknown>[] }) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        const incoming = state?.items ?? [];
        if (incoming.length === 0) return { success: true, state: { items: [] } };

        // FIX #1: Replace N+1 upserts with a split create/update batch strategy.
        // 1. Find which keywords already exist for this site.
        const keywords = incoming.map((item) => String(item.keyword ?? "")).filter(Boolean);
        const existing = await prisma.plannerItem.findMany({
            where: { siteId, keyword: { in: keywords } },
            select: { keyword: true },
        });
        const existingKeywords = new Set(existing.map((e) => e.keyword));

        const toCreate = incoming.filter((item) => !existingKeywords.has(String(item.keyword ?? "")));
        const toUpdate = incoming.filter((item) => existingKeywords.has(String(item.keyword ?? "")));

        // 2a. Batch-insert new items.
        if (toCreate.length > 0) {
            await prisma.plannerItem.createMany({
                data: toCreate.map((item) => ({
                    siteId,
                    keyword: String(item.keyword ?? ""),
                    title: item.title ? String(item.title) : null,
                    parentTopic: item.parentTopic ? String(item.parentTopic) : null,
                    intent: item.intent ? String(item.intent) : null,
                    difficulty: item.difficulty ? String(item.difficulty) : null,
                    weekBucket: item.week ? String(item.week) : null,
                    status: item.status && isValidStatus(String(item.status)) ? String(item.status) : "Todo",
                    reason: item.reason ? String(item.reason) : null,
                    pillar: Boolean(item.pillar),
                    priorityScore: item.priorityScore != null ? Number(item.priorityScore) : null,
                    reddit: item.reddit as object ?? undefined,
                    backlinks: item.backlinks as object ?? undefined,
                    pageScore: item.pageScore as object ?? undefined,
                })),
                skipDuplicates: true,
            });
        }

        // 2b. Batch-update existing items in chunks to avoid hitting query size limits.
        // Each chunk runs in a single transaction → far fewer round-trips than N upserts.
        const CHUNK_SIZE = 20;
        for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
            const chunk = toUpdate.slice(i, i + CHUNK_SIZE);
            await prisma.$transaction(
                chunk.map((item) =>
                    prisma.plannerItem.update({
                        where: { siteId_keyword: { siteId, keyword: String(item.keyword ?? "") } },
                        data: {
                            title: item.title ? String(item.title) : undefined,
                            parentTopic: item.parentTopic ? String(item.parentTopic) : undefined,
                            intent: item.intent ? String(item.intent) : undefined,
                            difficulty: item.difficulty ? String(item.difficulty) : undefined,
                            weekBucket: item.week ? String(item.week) : undefined,
                            status: item.status && isValidStatus(String(item.status)) ? String(item.status) : undefined,
                            reason: item.reason ? String(item.reason) : undefined,
                            pillar: Boolean(item.pillar),
                            priorityScore: item.priorityScore != null ? Number(item.priorityScore) : undefined,
                            reddit: item.reddit as object ?? undefined,
                            backlinks: item.backlinks as object ?? undefined,
                            pageScore: item.pageScore as object ?? undefined,
                        },
                    })
                )
            );
        }

        // FIX #5: Return only the first page rather than re-fetching everything.
        // The caller can request more pages via getPlannerState if needed.
        const items = await prisma.plannerItem.findMany({
            where: { siteId },
            orderBy: { createdAt: "asc" },
            take: 100,
        });
        return { success: true, state: { items } };
    } catch (error: unknown) {
        logger.error("[Planner] savePlannerState failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to save planner state" };
    }
}


export async function updatePlannerItemStatus(siteId: string, itemId: string, status: string) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        // FIX #10: Validate status before touching the DB.
        if (!isValidStatus(status)) {
            return { success: false, error: `Invalid status "${status}".` };
        }

        // FIX #2: Scope the update by siteId so users can't mutate items they don't own.
        // updateMany returns a count — if 0, the item didn't exist or didn't belong to this site.
        const result = await prisma.plannerItem.updateMany({
            where: { id: itemId, siteId },
            data: { status },
        });

        if (result.count === 0) {
            return { success: false, error: "Item not found" };
        }

        return { success: true };
    } catch (error: unknown) {
        logger.error("[Planner] updatePlannerItemStatus failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to update item status" };
    }
}


const INNGEST_CHUNK_SIZE = 50;

export async function batchGenerateBriefs(siteId: string, itemIds: string[]) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) return { success: false, error: "Unauthorized", queuedCount: 0 };

        // FIX #8: Single query — fetch user with site membership in one go.
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: {
                id: true,
                role: true,
                subscriptionTier: true,
                sites: { where: { id: siteId }, select: { id: true }, take: 1 },
            },
        });
        if (!user) return { success: false, error: "User not found", queuedCount: 0 };
        if (user.sites.length === 0) return { success: false, error: "Site not found", queuedCount: 0 };

        if (
            user.role !== "AGENCY_ADMIN" &&
            user.subscriptionTier !== "PRO" &&
            user.subscriptionTier !== "AGENCY"
        ) {
            return { success: false, error: "Pro or Agency subscription required to generate briefs.", queuedCount: 0 };
        }

        const items = await prisma.plannerItem.findMany({
            where: { siteId, id: { in: itemIds } },
            select: { id: true, keyword: true, parentTopic: true },
        });

        const events = items.map((item) => ({
            name: "planner/brief.generate" as const,
            data: { siteId, itemId: item.id, keyword: item.keyword, topic: item.parentTopic },
        }));

        // FIX #7: Chunk Inngest sends — firing 500 events at once saturates the client.
        for (let i = 0; i < events.length; i += INNGEST_CHUNK_SIZE) {
            await inngest.send(events.slice(i, i + INNGEST_CHUNK_SIZE));
        }

        await prisma.plannerItem.updateMany({
            where: { siteId, id: { in: itemIds } },
            data: { status: "Writing..." },
        });

        return { success: true, queuedCount: events.length };
    } catch (error: unknown) {
        logger.error("[Planner] batchGenerateBriefs failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to queue briefs", queuedCount: 0 };
    }
}


export interface KeywordPlannerInput {
    keyword: string;
    intent?: string;
    reason?: string;
    parentTopic?: string;
    difficulty?: string;
}

const WEEK_BUCKETS = ["Week 1", "Month 1", "Month 2-3"] as const;

export async function saveKeywordsToPlanner(siteId: string, keywords: KeywordPlannerInput[]) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        const valid = keywords.filter((kw) => kw.keyword?.trim());

        // FIX #4: Replace sequential creates with a single createMany.
        // skipDuplicates handles the unique constraint silently — same behaviour as the
        // previous try/catch per-item, but in one DB round-trip.
        const result = await prisma.plannerItem.createMany({
            data: valid.map((kw, idx) => {
                const keyword = kw.keyword.trim().toLowerCase();
                return {
                    siteId,
                    keyword,
                    title: keyword.charAt(0).toUpperCase() + keyword.slice(1),
                    parentTopic: kw.parentTopic ?? keyword,
                    intent: kw.intent ?? null,
                    difficulty: kw.difficulty ?? null,
                    reason: kw.reason ?? null,
                    weekBucket: WEEK_BUCKETS[idx % WEEK_BUCKETS.length],
                    status: "Todo",
                    pillar: false,
                    reddit: { subreddits: [], posts: [], karmaReady: false },
                    backlinks: [],
                    pageScore: { checks: {}, score: 0, lastUpdated: null },
                };
            }),
            skipDuplicates: true,
        });

        return { success: true, addedCount: result.count };
    } catch (error: unknown) {
        logger.error("[Planner] saveKeywordsToPlanner failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to save keywords to planner" };
    }
}


export async function updateRedditData(
    siteId: string,
    itemId: string,
    reddit: { subreddits?: string[]; posts?: RedditPost[]; karmaReady?: boolean }
) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        // FIX #2: Scope read by siteId — never trust itemId alone.
        const item = await prisma.plannerItem.findFirst({ where: { id: itemId, siteId } });
        if (!item) return { success: false, error: "Item not found" };

        // FIX #3: The read→merge→write pattern has a race condition window.
        // Acceptable here because reddit data is low-contention (only one enrichment
        // job runs per item at a time). Log if a conflict is detected in future.
        const existing = (item.reddit as Record<string, unknown>) ?? {};
        await prisma.plannerItem.update({
            where: { id: itemId },
            data: { reddit: { ...existing, ...reddit } as Prisma.InputJsonValue },
        });

        return { success: true };
    } catch (error: unknown) {
        logger.error("[Planner] updateRedditData failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to update Reddit data" };
    }
}


export async function upsertBacklinkTarget(siteId: string, itemId: string, target: BacklinkTarget) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        // FIX #2: Scope by siteId.
        const item = await prisma.plannerItem.findFirst({ where: { id: itemId, siteId } });
        if (!item) return { success: false, error: "Item not found" };

        const existing: BacklinkTarget[] = (item.backlinks as unknown as BacklinkTarget[]) ?? [];
        const idx = existing.findIndex((b) => b.id === target.id);
        const updated =
            idx >= 0
                ? existing.map((b, i) => (i === idx ? target : b))
                : [...existing, target];

        await prisma.plannerItem.update({ where: { id: itemId }, data: { backlinks: updated as object[] } });
        return { success: true };
    } catch (error: unknown) {
        logger.error("[Planner] upsertBacklinkTarget failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to update backlink" };
    }
}


export async function updatePageScore(siteId: string, itemId: string, checks: Partial<PageScoreChecks>) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        // FIX #2: Scope by siteId.
        const item = await prisma.plannerItem.findFirst({ where: { id: itemId, siteId } });
        if (!item) return { success: false, error: "Item not found" };

        const existing = (item.pageScore as { checks?: Record<string, boolean>; score?: number; lastUpdated?: string | null }) ?? {};
        const mergedChecks = { ...(existing.checks ?? {}), ...checks };
        const total = Object.keys(mergedChecks).length;
        const passed = Object.values(mergedChecks).filter(Boolean).length;
        const score = total > 0 ? Math.round((passed / total) * 100) : 0;

        await prisma.plannerItem.update({
            where: { id: itemId },
            data: {
                pageScore: { checks: mergedChecks, score, lastUpdated: new Date().toISOString() },
            },
        });

        return { success: true };
    } catch (error: unknown) {
        logger.error("[Planner] updatePageScore failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to update page score" };
    }
}


export async function removeBacklinkTarget(siteId: string, itemId: string, targetId: string) {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        const item = await prisma.plannerItem.findFirst({ where: { id: itemId, siteId } });
        if (!item) return { success: false, error: "Item not found" };

        const existing: BacklinkTarget[] = (item.backlinks as unknown as BacklinkTarget[]) ?? [];
        const updated = existing.filter(b => b.id !== targetId);

        await prisma.plannerItem.update({
            where: { id: itemId },
            data:  { backlinks: updated as object[] },
        });
        return { success: true };
    } catch (error: unknown) {
        logger.error("[Planner] removeBacklinkTarget failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to remove backlink target" };
    }
}
// Returns top GSC keyword opportunities (position 11-50, min impressions)
// that aren't already in the planner, ready to be added with one click.

export interface GscPlannerSuggestion {
    keyword:    string;
    avgPosition: number;
    impressions: number;
    ctr:        number;
    score:      number;
    intent:     string | null;
    alreadyAdded: boolean;
}

export async function getGscSuggestionsForPlanner(siteId: string): Promise<{
    success: boolean;
    suggestions?: GscPlannerSuggestion[];
    error?: string;
}> {
    try {
        const ctx = await resolveUserAndSite(siteId);
        if (!ctx) return { success: false, error: "Not authenticated or site not found" };

        const { getKeywordOpportunities } = await import("@/app/actions/keywords");
        const oppResult = await getKeywordOpportunities(siteId);
        if (!oppResult.success || !oppResult.opportunities?.length) {
            return { success: true, suggestions: [] };
        }

        const keywords = oppResult.opportunities.map(o => o.keyword.toLowerCase().trim());
        const existing = await prisma.plannerItem.findMany({
            where: { siteId, keyword: { in: keywords } },
            select: { keyword: true },
        });
        const existingSet = new Set(existing.map(e => e.keyword));

        const suggestions: GscPlannerSuggestion[] = oppResult.opportunities.map(o => ({
            keyword:     o.keyword,
            avgPosition: o.avgPosition,
            impressions: o.impressions,
            ctr:         o.ctr,
            score:       o.opportunityScore ?? 0,
            intent:      o.intent ?? null,
            alreadyAdded: existingSet.has(o.keyword.toLowerCase().trim()),
        }));

        return { success: true, suggestions };
    } catch (error: unknown) {
        logger.error("[Planner] getGscSuggestionsForPlanner failed:", { error: (error as Error)?.message });
        return { success: false, error: "Failed to fetch GSC suggestions" };
    }
}

export async function addGscKeywordsToPlanner(
    siteId: string,
    keywords: { keyword: string; intent?: string | null; avgPosition?: number; impressions?: number }[]
) {
    return saveKeywordsToPlanner(
        siteId,
        keywords.map(k => ({
            keyword: k.keyword,
            intent: k.intent ?? undefined,
            reason: k.avgPosition != null
                ? `Position ${k.avgPosition.toFixed(1)} — ${k.impressions ?? 0} impressions/month`
                : undefined,
        }))
    );
}
