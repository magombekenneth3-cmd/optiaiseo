"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveTier } from "@/lib/stripe/guards";
import { string, z } from "zod";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuditWithSite = NonNullable<Awaited<ReturnType<typeof fetchAudit>>>;

// Score delta for a single category: positive = improved, negative = regressed
export interface CategoryScoreDelta {
    category: string;
    current: number;
    previous: number;
    delta: number; // current - previous
}

type GetAuditResult =
    | {
          success: true;
          audit: AuditWithSite;
          isPaidUser: boolean;
          userTier: string;
          /** Per-category score deltas vs the immediately preceding audit for this site. */
          scoreDeltas: CategoryScoreDelta[];
          /** ISO timestamp of the previous audit, or null if this is the first. */
          previousAuditTimestamp: string | null;
      }
    | { success: false; error: string };

// ---------------------------------------------------------------------------
// Query — narrow select avoids pulling full Audit payload unnecessarily
// ---------------------------------------------------------------------------

function fetchAudit(auditId: string, userId: string) {
    return prisma.audit.findFirst({
        where: { id: auditId, site: { userId } },
        include: {
            site: {
                select: {
                    id: true,
                    domain: true,
                    userId: true,
                },
            },
        },
    });
}


/** Fetches the most recent completed audit for the same site that ran BEFORE auditId. */
function fetchPreviousAudit(siteId: string, beforeTimestamp: Date) {
    return prisma.audit.findFirst({
        where: {
            siteId,
            fixStatus: "COMPLETED",
            runTimestamp: { lt: beforeTimestamp },
        },
        orderBy: { runTimestamp: "desc" },
        select: { categoryScores: true, runTimestamp: true },
    });
}

/**
 * Computes per-category score deltas between two categoryScores maps.
 * Returns an empty array when either snapshot is missing or malformed.
 */
function computeScoreDeltas(
    current: Record<string, number>,
    previous: Record<string, unknown> | null
): CategoryScoreDelta[] {
    if (!previous || typeof previous !== "object") return [];
    return Object.entries(current).flatMap(([category, currentScore]) => {
        const prev = (previous as Record<string, unknown>)[category];
        if (typeof prev !== "number") return [];
        return [{ category, current: currentScore, previous: prev, delta: currentScore - prev }];
    });
}
// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function getAuditById(auditId: string): Promise<GetAuditResult> {
    // --- Input validation ---
    if (!uuidSchema.safeParse(auditId).success) {
        return { success: false, error: "Audit not found" };
    }

    try {
        const session = await getServerSession(authOptions);
        const userId = session?.user?.id;
        if (!userId) return { success: false, error: "Unauthorized" };

        // Ownership is enforced in the query itself — no post-fetch userId check
        // needed, and a missing row is indistinguishable from an unauthorized one
        // (prevents enumeration).
        const audit = await fetchAudit(auditId, userId);
        if (!audit) return { success: false, error: "Audit not found" };

        // Resolve subscription tier to determine Pro feature access.
        // Fixed: was passing audit.site.userId (always === userId here) as the
        // subscriptionTier argument — should pass the user's actual tier string.
        // We fetch it directly from the user row, same pattern as the rest of
        // the codebase.
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { subscriptionTier: true },
        });

        const effectiveTier = await getEffectiveTier(userId);
        const isPaidUser = ["STARTER", "PRO", "AGENCY"].includes(effectiveTier);

        // Fetch the previous completed audit for this site (for score trending).
        const previousAudit = audit.fixStatus === "COMPLETED"
            ? await fetchPreviousAudit(audit.siteId, audit.runTimestamp)
            : null;

        const currentScores = (audit.categoryScores ?? {}) as Record<string, number>;
        const scoreDeltas = computeScoreDeltas(
            currentScores,
            previousAudit?.categoryScores as Record<string, unknown> | null ?? null
        );

        return {
            success: true,
            audit,
            isPaidUser,
            userTier: effectiveTier,
            scoreDeltas,
            previousAuditTimestamp: previousAudit?.runTimestamp.toISOString() ?? null,
        };
    } catch (error: unknown) {
        logger.error("[AuditDetail] getAuditById failed", {
            error: (error as Error)?.message ?? String(error),
        });
        return { success: false, error: "Failed to fetch audit." };
    }
}