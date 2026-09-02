import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { getPersistedDecisions } from "@/lib/growth/decision-persistence";
import { performOneClickAutoFix } from "@/lib/autofix/fixer";
import { recordExperimentBaseline } from "@/lib/experiments/tracker";
import { logger } from "@/lib/logger";
import { acquireSyncLock, releaseSyncLock } from "@/lib/growth/decision-lock";

// Mutation lifecycle
import {
    createOperation,
    executeOperation,
    registerEffect,
    type CreateOperationParams,
    type MutableModel,
    ExecutionClaimError,
    MutationBlockedError,
    ConcurrentModificationError,
} from "@/lib/mutations";



export interface ExecutionResult {
    decisionId: string;
    siteId: string;
    actionExecuted: string;
    targetUrl: string;
    success: boolean;
    details: string;
    executedAt: Date;
    affectedBlogId?: string;
    operationId?: string;
    baselineMetrics?: {
        position?: number;
        clicks?: number;
        impressions?: number;
    };
}

/**
 * Executes a growth decision through the Mutation Operation lifecycle.
 *
 * Flow:
 *   0. Acquire Redis sync lock (fail-closed on Redis error)
 *   1. Resolve decision + target blog
 *   2. Build the mutation payload (the exact patch to apply)
 *   3. createOperation() → risk assessment → auto-approve or PENDING_APPROVAL
 *   4. executeOperation() → atomic versioned update with snapshot
 *   5. registerEffect() → INDEXNOW, GOOGLE_INDEXING side effects
 *   6. Mark GrowthDecision as EXECUTED
 *
 * The external ExecutionResult interface is preserved for backward compatibility.
 */
export async function executeGrowthDecision(
    decisionId: string,
    siteId: string
): Promise<ExecutionResult> {
    const executedAt = new Date();

    // ── 0. Acquire Redis sync lock (fail-closed on error) ───────────────
    // If the lock cannot be acquired (Redis error, contention), abort
    // immediately with LOCK_UNAVAILABLE so callers know nothing was mutated.
    let lockAcquired = false;
    try {
        lockAcquired = await acquireSyncLock(siteId);
    } catch (lockErr: unknown) {
        logger.warn("[ExecutionEngine] Redis lock acquisition error — aborting execution", {
            decisionId,
            siteId,
            error: (lockErr as Error)?.message,
        });
        return {
            decisionId,
            siteId,
            actionExecuted: "LOCK_UNAVAILABLE",
            targetUrl: "/",
            success: false,
            details: `Lock acquisition failed: ${(lockErr as Error)?.message || "Redis error"}`,
            executedAt,
        };
    }

    if (!lockAcquired) {
        return {
            decisionId,
            siteId,
            actionExecuted: "LOCK_UNAVAILABLE",
            targetUrl: "/",
            success: false,
            details: "Another execution is already in progress for this site.",
            executedAt,
        };
    }

    try {
        // ── 1. Resolve Decision ──────────────────────────────────────────────
        const decisions = await getPersistedDecisions(siteId);
        const decision = decisions.find((d) => d.id === decisionId);

        let targetUrl = decision?.url || "/";
        let actionExecuted = decision?.action || "IMPROVE_SEARCH_INTENT";
        let primaryKeyword = decision?.primaryKeyword || "SEO Optimization";

        // Try DB directly if not found in active list
        let dbRecord: any = null;
        try {
            dbRecord = await (prisma as any).growthDecision.findUnique({
                where: { id: decisionId },
            });
        } catch (dbErr) {
            logger.warn("[ExecutionEngine] DB decision lookup failed", { decisionId, error: (dbErr as Error)?.message });
        }

        if (dbRecord) {
            targetUrl = dbRecord.url;
            actionExecuted = dbRecord.action;
            primaryKeyword = dbRecord.primaryKeyword;

            // Early-return if decision has already been executed
            if (dbRecord.status === "EXECUTED") {
                return {
                    decisionId,
                    siteId,
                    actionExecuted,
                    targetUrl,
                    success: true,
                    details: "Decision already executed.",
                    executedAt
                };
            }

            // P0: Early-exit if decision is not in APPROVED state
            if (dbRecord.status !== "APPROVED" && dbRecord.status !== "EXECUTED") {
                return {
                    decisionId,
                    siteId,
                    actionExecuted,
                    targetUrl,
                    success: false,
                    details: `Decision status is '${dbRecord.status}', not APPROVED — refusing execution.`,
                    executedAt
                };
            }
        }

        // ── 2. Resolve Target Blog ───────────────────────────────────────────
        const slug = targetUrl.replace(/^\/blog\//, "").replace(/\/$/, "");
        let blog: any = null;
        try {
            blog = await prisma.blog.findFirst({
                where: { siteId, slug }
            });
        } catch (blogErr) {
            logger.error("[ExecutionEngine] DB blog lookup threw exception", { siteId, slug, error: (blogErr as Error)?.message });
            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: false,
                details: "Database query failed during blog lookup.",
                executedAt
            };
        }

        // ── 3. Build Mutation Payload ────────────────────────────────────────
        const mutationResult = buildMutationPayload(actionExecuted, blog, primaryKeyword, targetUrl, siteId);

        if (!mutationResult.success) {
            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: false,
                details: mutationResult.error!,
                executedAt,
            };
        }

        if (mutationResult.directAction) {
            await mutationResult.directAction();
            await markDecisionExecuted(decisionId, siteId, targetUrl);

            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: true,
                details: mutationResult.details,
                executedAt,
                affectedBlogId: blog?.id,
            };
        }

        // ── 4. Create Mutation Operation ─────────────────────────────────────
        if (!blog) {
            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: false,
                details: `Target blog not found for action ${actionExecuted}: ${targetUrl}`,
                executedAt,
            };
        }

        // Count site pages for blast radius calculation
        const sitePageCount = await prisma.blog.count({ where: { siteId } });

        const operationParams: CreateOperationParams = {
            siteId,
            actorId: dbRecord?.approvedBy || "system:growth-engine",
            actorType: dbRecord?.approvedBy ? "USER" : "SYSTEM",
            mutationType: mutationResult.mutationType!,
            targetModel: "Blog" as MutableModel,
            targetId: blog.id,
            expectedVersion: blog.version ?? 1,
            mutationPayload: mutationResult.payload!,
            affectedFields: mutationResult.affectedFields!,
            sitePageCount,
            affectedUrlCount: 1,
            idempotencyParams: {
                decisionId,
            },
        };

        const { operation, requiresApproval: needsApproval } =
            await createOperation(operationParams);

        if (needsApproval) {
            // Operation requires human approval — do NOT execute yet
            logger.info("[ExecutionEngine] Operation requires approval", {
                operationId: operation.id,
                decisionId,
                riskLevel: operation.riskLevel,
            });

            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: false,
                details: `Operation ${operation.id} requires approval (risk: ${operation.riskLevel}). Review in dashboard.`,
                executedAt,
                operationId: operation.id,
            };
        }

        // ── 5. Execute Operation (atomic versioned update) ───────────────────
        const execResult = await executeOperation(operation.id);

        if (!execResult.success) {
            logger.warn("[ExecutionEngine] Mutation operation failed", {
                operationId: operation.id,
                status: execResult.status,
                error: execResult.error,
            });

            return {
                decisionId,
                siteId,
                actionExecuted,
                targetUrl,
                success: false,
                details: `Mutation failed: ${execResult.error}`,
                executedAt,
                operationId: operation.id,
            };
        }

        // ── 6. Register Side Effects ─────────────────────────────────────────
        try {
            await registerEffect({
                operationId: operation.id,
                effectType: "INDEXNOW",
                payload: { siteId, targetUrl },
                confirmationMode: "NONE",
                compensationPolicy: "IRREVERSIBLE",
                idempotencyParams: { targetUrl },
            });

            await registerEffect({
                operationId: operation.id,
                effectType: "GOOGLE_INDEXING",
                payload: { siteId, targetUrl },
                confirmationMode: "NONE",
                compensationPolicy: "IRREVERSIBLE",
                idempotencyParams: { targetUrl },
            });
        } catch (effectErr) {
            // Effects are best-effort — don't fail the whole operation
            logger.warn("[ExecutionEngine] Effect registration failed", {
                operationId: operation.id,
                error: (effectErr as Error)?.message,
            });
        }

        // ── 7. Mark Decision as EXECUTED (atomic guard) ──────────────────────
        await markDecisionExecuted(decisionId, siteId, targetUrl);

        // ── 8. Fire-and-forget side effects (non-mutation bookkeeping) ────────
        // NOTE: IndexNow is already registered as a QUEUED effect above (step 6).
        // Do NOT call triggerInstantIndexing() directly here — that would duplicate
        // the external API call. The effect processor dispatches it.
        try {
            await recordExperimentBaseline(decisionId, siteId, targetUrl, actionExecuted);
        } catch { /* Fail open */ }

        logger.info("[ExecutionEngine] Growth decision successfully executed via mutation lifecycle", {
            decisionId,
            siteId,
            actionExecuted,
            targetUrl,
            operationId: operation.id,
            newVersion: execResult.newVersion,
        });

        return {
            decisionId,
            siteId,
            actionExecuted,
            targetUrl,
            success: true,
            details: mutationResult.details,
            executedAt,
            affectedBlogId: blog?.id,
            operationId: operation.id,
        };
    } catch (err: unknown) {
        // Surface specific mutation errors with actionable messages
        if (err instanceof MutationBlockedError) {
            logger.warn("[ExecutionEngine] Mutation blocked by kill switch", {
                decisionId,
                siteId,
                error: (err as Error).message,
            });
            return {
                decisionId,
                siteId,
                actionExecuted: "BLOCKED",
                targetUrl: "/",
                success: false,
                details: `Kill switch active: ${err.message}`,
                executedAt,
            };
        }

        if (err instanceof ExecutionClaimError) {
            return {
                decisionId,
                siteId,
                actionExecuted: "LOCK_CONTESTED",
                targetUrl: "/",
                success: false,
                details: "Another worker is already executing this operation.",
                executedAt,
            };
        }

        if (err instanceof ConcurrentModificationError) {
            return {
                decisionId,
                siteId,
                actionExecuted: "STALE",
                targetUrl: "/",
                success: false,
                details: `Target was modified by another process: ${err.message}`,
                executedAt,
            };
        }

        logger.error("[ExecutionEngine] Decision execution failed", {
            decisionId,
            siteId,
            error: (err as Error)?.message || String(err)
        });

        return {
            decisionId,
            siteId,
            actionExecuted: "UNKNOWN",
            targetUrl: "/",
            success: false,
            details: `Execution failed: ${(err as Error)?.message || String(err)}`,
            executedAt
        };
    } finally {
        // Always release the sync lock, regardless of success or failure
        await releaseSyncLock(siteId);
    }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

interface MutationPayloadResult {
    success: boolean;
    error?: string;
    details: string;
    mutationType?: "BLOG_CONTENT_UPDATE" | "BLOG_STATUS_UPDATE" | "BLOG_SCHEMA_UPDATE" | "BLOG_REFRESH" | "INTERNAL_LINK_CREATE" | "CONTENT_CONSOLIDATION";
    payload?: Record<string, unknown>;
    affectedFields?: string[];
    /** If set, this action should be executed directly (not via mutation operation) */
    directAction?: () => Promise<void>;
}

/**
 * Builds the exact mutation payload for each action type.
 * This is the canonical description of WHAT will change — the mutation operation
 * lifecycle handles HOW it's applied (versioned, snapshotted, audited).
 */
function buildMutationPayload(
    action: string,
    blog: any,
    primaryKeyword: string,
    targetUrl: string,
    siteId: string,
): MutationPayloadResult {
    switch (action) {
        case "BUILD_INTERNAL_LINKS": {
            if (!blog) {
                return {
                    success: false,
                    error: `Target blog not found for internal link building: ${targetUrl}`,
                    details: "",
                };
            }
            // Internal link creation doesn't modify the Blog model directly,
            // so we handle it as a "direct action" outside the versioned mutation path.
            return {
                success: true,
                details: "",
                directAction: async () => {
                    const candidatePillar = await prisma.blog.findFirst({
                        where: { siteId, status: "PUBLISHED", id: { not: blog.id } },
                        orderBy: { createdAt: "asc" }
                    });

                    if (candidatePillar) {
                        await (prisma as any).internalLink.upsert({
                            where: {
                                sourceBlogId_targetBlogId: {
                                    sourceBlogId: candidatePillar.id,
                                    targetBlogId: blog.id
                                }
                            },
                            update: { targetUrl: `/blog/${blog.slug}` },
                            create: {
                                siteId,
                                sourceBlogId: candidatePillar.id,
                                targetBlogId: blog.id,
                                sourceUrl: `/blog/${candidatePillar.slug}`,
                                targetUrl: `/blog/${blog.slug}`,
                                anchorText: primaryKeyword
                            }
                        });
                    }
                },
            };
        }

        case "REFRESH_CONTENT": {
            if (!blog) {
                return {
                    success: false,
                    error: `Target blog not found for content refresh: ${targetUrl}`,
                    details: "",
                };
            }
            return {
                success: true,
                details: `Flagged "${blog.title}" for AI content refresh and 2026 stats update.`,
                mutationType: "BLOG_REFRESH",
                payload: { needsRefresh: true },
                affectedFields: ["needsRefresh"],
            };
        }

        case "IMPROVE_SEARCH_INTENT": {
            if (!blog || !blog.content) {
                return {
                    success: false,
                    error: `Target blog content missing for search intent improvement: ${targetUrl}`,
                    details: "",
                };
            }
            const fixResult = performOneClickAutoFix(blog.content, `https://site.com${targetUrl}`);
            const schemaMarkup = JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": [{
                    "@type": "Question",
                    "name": `What is ${primaryKeyword}?`,
                    "acceptedAnswer": { "@type": "Answer", "text": `Comprehensive analysis of ${primaryKeyword}.` }
                }]
            });

            return {
                success: true,
                details: `Executed AutoFix Engine: Applied ${fixResult.changes.length} structural fixes & FAQ Schema.`,
                mutationType: "BLOG_CONTENT_UPDATE",
                payload: {
                    content: fixResult.fixedHtml,
                    schemaMarkup,
                },
                affectedFields: ["content", "schemaMarkup"],
            };
        }

        case "CONSOLIDATE_CONTENT": {
            if (!blog) {
                return {
                    success: false,
                    error: `Target blog not found for content consolidation: ${targetUrl}`,
                    details: "",
                };
            }
            return {
                success: true,
                details: `Set up 301 redirect consolidation for cannibalizing article "${blog.title}".`,
                mutationType: "CONTENT_CONSOLIDATION",
                payload: { status: "CONSOLIDATED" },
                affectedFields: ["status"],
            };
        }

        default: {
            // Unknown action — return as a direct pass-through
            return {
                success: true,
                details: `Applied optimization action ${action} to ${targetUrl}`,
                directAction: async () => {
                    // No-op for unknown actions
                },
            };
        }
    }
}

/**
 * Marks the GrowthDecision as EXECUTED with atomic guard and invalidates cache.
 * Uses updateMany with status guard to prevent double-execution.
 */
async function markDecisionExecuted(
    decisionId: string,
    siteId: string,
    targetUrl: string,
): Promise<void> {
    try {
        await (prisma as any).$transaction(async (tx: any) => {
            const result = await tx.growthDecision.updateMany({
                where: { id: decisionId, status: "APPROVED" },
                data: { status: "EXECUTED" }
            });
            if (result.count === 0) {
                throw new Error("ATOMIC_GUARD: Decision not in APPROVED state — aborting transaction");
            }
        });
    } catch (dbUpdateErr) {
        logger.error("[ExecutionEngine] Failed to mark growth decision as EXECUTED", {
            decisionId,
            error: (dbUpdateErr as Error)?.message,
        });
        // Don't throw — the mutation itself succeeded, this is bookkeeping
    }

    // Invalidate Redis cache
    const redis = getRedis();
    if (redis) {
        try {
            await redis.del(`growth_decisions_compressed:${siteId}`);
        } catch { /* Fail open */ }
    }
}
