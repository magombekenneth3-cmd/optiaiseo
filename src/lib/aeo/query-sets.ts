/**
 * aeo/query-sets.ts — Persistent query set management.
 *
 * A "query set" is a versioned, fingerprinted group of TrackedQueries that
 * were used together in an audit. By persisting the exact set, we guarantee:
 *
 * 1. **Reproducibility** — Re-running an audit uses the same queries,
 *    so score changes reflect real visibility shifts, not query drift.
 *
 * 2. **Fair comparison** — Weekly trend charts compare apples-to-apples
 *    because every data point used the same query universe.
 *
 * 3. **Tiered depth** — Quick audits use fewer queries (fast, cheap),
 *    deep audits use many (comprehensive, expensive).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import type { GeneratedQuery } from "./query-library";

// ── Audit tiers ─────────────────────────────────────────────────────────────

export type AuditTier = "quick" | "standard" | "deep";

export interface AuditTierConfig {
    tier: AuditTier;
    queryCount: number;
    modelsToCheck: string[];
    description: string;
}

export const AUDIT_TIERS: Record<AuditTier, AuditTierConfig> = {
    quick: {
        tier: "quick",
        queryCount: 8,
        modelsToCheck: ["gemini", "perplexity"],
        description: "Fast check — 8 queries across 2 models (~30s)",
    },
    standard: {
        tier: "standard",
        queryCount: 20,
        modelsToCheck: ["gemini", "perplexity", "chatgpt", "claude"],
        description: "Standard audit — 20 queries across 4 models (~2 min)",
    },
    deep: {
        tier: "deep",
        queryCount: 40,
        modelsToCheck: ["gemini", "perplexity", "chatgpt", "claude", "grok", "copilot", "deepseek"],
        description: "Deep audit — 40 queries across 7 models (~5 min)",
    },
} as const;

/**
 * Returns the tier config for a subscription tier.
 * Free users get quick, Pro gets standard, Agency gets deep.
 */
export function tierForSubscription(subscriptionTier: string): AuditTier {
    switch (subscriptionTier.toUpperCase()) {
        case "AGENCY":
        case "ENTERPRISE":
            return "deep";
        case "PRO":
            return "standard";
        default:
            return "quick";
    }
}

// ── Query set fingerprinting ────────────────────────────────────────────────

/**
 * Creates a deterministic fingerprint for a set of query texts.
 * Two sets with the same queries (regardless of order) produce the same hash.
 */
export function fingerprintQueries(queries: string[]): string {
    const sorted = [...queries].sort();
    return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 32);
}

// ── Query set lifecycle ─────────────────────────────────────────────────────

/**
 * Gets or creates a query set for a site.
 *
 * Strategy:
 * 1. Look for an active set with the same fingerprint → reuse it
 * 2. If no matching set exists, create a new one and link the queries
 * 3. Deactivate previous sets for the same tier (only one active per tier)
 *
 * @returns The query set ID and whether it was newly created
 */
export async function getOrCreateQuerySet(
    siteId: string,
    queries: GeneratedQuery[],
    tier: AuditTier = "standard"
): Promise<{ querySetId: string; created: boolean; version: number }> {
    const queryTexts = queries.map((q) => q.query);
    const fp = fingerprintQueries(queryTexts);

    // 1. Check for existing active set with same fingerprint
    const existing = await prisma.aeoQuerySet.findUnique({
        where: { siteId_fingerprint: { siteId, fingerprint: fp } },
        select: { id: true, version: true, isActive: true },
    });

    if (existing?.isActive) {
        logger.debug("[QuerySet] Reusing existing set", {
            siteId,
            querySetId: existing.id,
            version: existing.version,
        });
        return { querySetId: existing.id, created: false, version: existing.version };
    }

    // 2. Get next version number
    const latestVersion = await prisma.aeoQuerySet.findFirst({
        where: { siteId },
        orderBy: { version: "desc" },
        select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // 3. Deactivate previous sets for this tier
    await prisma.aeoQuerySet.updateMany({
        where: { siteId, tier, isActive: true },
        data: { isActive: false },
    });

    // 4. Create the new set
    const querySet = await prisma.aeoQuerySet.create({
        data: {
            siteId,
            version: nextVersion,
            tier,
            queryCount: queries.length,
            generatedBy: "auto",
            fingerprint: fp,
            isActive: true,
        },
    });

    // 5. Upsert queries and link them to the set
    for (const q of queries) {
        await prisma.trackedQuery.upsert({
            where: { siteId_queryText: { siteId, queryText: q.query } },
            create: {
                siteId,
                queryText: q.query,
                intent: q.intent,
                reason: q.reason,
                source: "auto",
                isActive: true,
                querySetId: querySet.id,
            },
            update: {
                querySetId: querySet.id,
                isActive: true,
                intent: q.intent,
            },
        });
    }

    logger.info("[QuerySet] Created new query set", {
        siteId,
        querySetId: querySet.id,
        version: nextVersion,
        tier,
        queryCount: queries.length,
        fingerprint: fp,
    });

    return { querySetId: querySet.id, created: true, version: nextVersion };
}

/**
 * Retrieves the active query set for a site and tier.
 * Returns null if no active set exists (first-time audit).
 */
export async function getActiveQuerySet(
    siteId: string,
    tier?: AuditTier
): Promise<{
    id: string;
    version: number;
    tier: string;
    queryCount: number;
    queries: { queryText: string; intent: string }[];
} | null> {
    const where: Parameters<typeof prisma.aeoQuerySet.findFirst>[0] = {
        where: {
            siteId,
            isActive: true,
            ...(tier ? { tier } : {}),
        },
        orderBy: { version: "desc" as const },
        include: {
            queries: {
                where: { isActive: true },
                select: { queryText: true, intent: true },
                orderBy: { createdAt: "asc" as const },
            },
        },
    };

    const set = await prisma.aeoQuerySet.findFirst(where as any);
    if (!set) return null;

    return {
        id: set.id,
        version: set.version,
        tier: set.tier,
        queryCount: set.queryCount,
        queries: (set as any).queries ?? [],
    };
}

/**
 * Returns the query set history for a site (for the "Query Sets" admin UI).
 */
export async function getQuerySetHistory(
    siteId: string,
    limit = 10
): Promise<
    {
        id: string;
        version: number;
        tier: string;
        queryCount: number;
        isActive: boolean;
        createdAt: Date;
    }[]
> {
    return prisma.aeoQuerySet.findMany({
        where: { siteId },
        orderBy: { version: "desc" },
        take: limit,
        select: {
            id: true,
            version: true,
            tier: true,
            queryCount: true,
            isActive: true,
            createdAt: true,
        },
    });
}
