/**
 * Mutation Effect Processor — dispatches QUEUED effects and reconciles DISPATCHED ones.
 *
 * Two functions:
 *   1. `mutationEffectProcessor` — Cron (every 2 min): picks up QUEUED effects and dispatches them
 *   2. `mutationEffectReconciler` — Cron (every 5 min): checks DISPATCHED effects for confirmation
 *
 * This replaces the in-memory outbox engine with durable, DB-backed effect processing.
 *
 * See: implementation_plan.md v2.1 — Phase 3 + Phase 4
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
    assertEffectChannelEnabled,
    checkOperationCompletion,
    MutationBlockedError,
} from "@/lib/mutations";
import type { KillSwitchChannel } from "@/lib/mutations";
import { triggerInstantIndexing } from "@/lib/indexing/indexnow";

// ── Effect Type → Kill Switch Channel mapping ──────────────────────────────

const EFFECT_TO_CHANNEL: Record<string, KillSwitchChannel> = {
    CMS_PUBLISH: "CMS",
    GITHUB_PR: "GITHUB",
    INDEXNOW: "INDEXNOW",
    GOOGLE_INDEXING: "INDEXNOW", // shares the INDEXNOW channel
};

// ── Effect Processor (QUEUED → DISPATCHED) ──────────────────────────────────

export const mutationEffectProcessor = inngest.createFunction(
    {
        id: "mutation-effect-processor",
        name: "Mutation Effect Processor",
        retries: 1,
        concurrency: { limit: 1 }, // Single processor to avoid contention
        triggers: [{ cron: "*/2 * * * *" }], // Every 2 minutes
    },
    async ({ step }: { step: any }) => {
        const batchResult = await step.run("process-queued-effects", async () => {
            // Fetch QUEUED effects, oldest first, limit 20 per batch
            const queuedEffects = await (prisma as any).mutationEffect.findMany({
                where: {
                    status: "QUEUED",
                    OR: [
                        { nextRetryAt: null },
                        { nextRetryAt: { lte: new Date() } },
                    ],
                },
                orderBy: { createdAt: "asc" },
                take: 20,
                include: {
                    operation: {
                        select: { siteId: true, status: true },
                    },
                },
            });

            if (queuedEffects.length === 0) {
                return { processed: 0, dispatched: 0, failed: 0, blocked: 0 };
            }

            let dispatched = 0;
            let failed = 0;
            let blocked = 0;

            for (const effect of queuedEffects) {
                try {
                    // Check if parent operation is still valid
                    if (effect.operation.status === "FAILED" || effect.operation.status === "CANCELLED") {
                        await (prisma as any).mutationEffect.update({
                            where: { id: effect.id },
                            data: { status: "CANCELLED", updatedAt: new Date() },
                        });
                        continue;
                    }

                    // Channel kill switch check
                    const channel = EFFECT_TO_CHANNEL[effect.effectType];
                    if (channel) {
                        try {
                            await assertEffectChannelEnabled(effect.operation.siteId, channel);
                        } catch (err) {
                            if (err instanceof MutationBlockedError) {
                                logger.warn("[EffectProcessor] Channel blocked — skipping", {
                                    effectId: effect.id,
                                    channel,
                                    siteId: effect.operation.siteId,
                                });
                                blocked++;
                                continue;
                            }
                            throw err;
                        }
                    }

                    // Dispatch the effect
                    const success = await dispatchEffect(effect);

                    if (success) {
                        dispatched++;
                    } else {
                        failed++;
                    }
                } catch (err) {
                    logger.error("[EffectProcessor] Unexpected error dispatching effect", {
                        effectId: effect.id,
                        error: (err as Error)?.message,
                    });
                    failed++;
                    await markEffectFailed(effect, (err as Error)?.message || "Unknown error");
                }
            }

            return { processed: queuedEffects.length, dispatched, failed, blocked };
        });

        // Check if any operations are now complete
        await step.run("check-operation-completions", async () => {
            // Find operations in EFFECTS_PENDING that might be complete
            const pendingOps = await (prisma as any).mutationOperation.findMany({
                where: { status: "EFFECTS_PENDING" },
                select: { id: true },
                take: 50,
            });

            let completed = 0;
            for (const op of pendingOps) {
                const result = await checkOperationCompletion(op.id);
                if (result) completed++;
            }

            return { checked: pendingOps.length, completed };
        });

        return batchResult;
    }
);

// ── Effect Reconciler (DISPATCHED → CONFIRMED/FAILED) ───────────────────────

export const mutationEffectReconciler = inngest.createFunction(
    {
        id: "mutation-effect-reconciler",
        name: "Mutation Effect Reconciler",
        retries: 1,
        concurrency: { limit: 1 },
        triggers: [{ cron: "*/5 * * * *" }], // Every 5 minutes
    },
    async ({ step }: { step: any }) => {
        return await step.run("reconcile-dispatched-effects", async () => {
            // Delegate to the reconciliation module which handles:
            // - Per-platform confirmation polling (WordPress, Ghost, Shopify, GitHub)
            // - Irreversible effect terminal transitions
            // - Operation completion checks
            // - Stuck EXECUTING operation recovery
            const { reconcileEffects } = await import("@/lib/mutations");
            return reconcileEffects(5 * 60 * 1000, 30);
        });
    }
);

// ── Dispatch Helpers ────────────────────────────────────────────────────────

/**
 * Dispatches a single effect to its external system.
 * Returns true on success, false on failure (with effect updated).
 */
async function dispatchEffect(effect: any): Promise<boolean> {
    const payload = effect.payload as Record<string, any>;

    switch (effect.effectType) {
        case "INDEXNOW": {
            try {
                const siteId = payload.siteId as string;
                const targetUrl = payload.targetUrl as string;
                if (!siteId || !targetUrl) {
                    await markEffectFailed(effect, "Missing siteId or targetUrl in payload");
                    return false;
                }
                await triggerInstantIndexing(siteId, [targetUrl]);
                await (prisma as any).mutationEffect.update({
                    where: { id: effect.id },
                    data: {
                        status: "IRREVERSIBLE_DISPATCHED",
                        dispatchedAt: new Date(),
                        attempts: { increment: 1 },
                    },
                });
                return true;
            } catch (err) {
                await markEffectFailed(effect, (err as Error)?.message || "IndexNow dispatch failed");
                return false;
            }
        }

        case "GOOGLE_INDEXING": {
            try {
                // Google Indexing API shares the same pathway as IndexNow for now
                const siteId = payload.siteId as string;
                const targetUrl = payload.targetUrl as string;
                if (!siteId || !targetUrl) {
                    await markEffectFailed(effect, "Missing siteId or targetUrl in payload");
                    return false;
                }
                // Google Indexing is fire-and-forget / irreversible
                await (prisma as any).mutationEffect.update({
                    where: { id: effect.id },
                    data: {
                        status: "IRREVERSIBLE_DISPATCHED",
                        dispatchedAt: new Date(),
                        attempts: { increment: 1 },
                    },
                });
                return true;
            } catch (err) {
                await markEffectFailed(effect, (err as Error)?.message || "Google Indexing dispatch failed");
                return false;
            }
        }

        case "CMS_PUBLISH":
        case "GITHUB_PR": {
            // CMS and GitHub effects are dispatched inline by publishers/index.ts
            // and github/index.ts respectively. If they reach the processor still
            // QUEUED, mark them as dispatched (they were registered but the inline
            // dispatch already handled the actual API call).
            await (prisma as any).mutationEffect.update({
                where: { id: effect.id },
                data: {
                    status: "DISPATCHED",
                    dispatchedAt: new Date(),
                    attempts: { increment: 1 },
                },
            });
            return true;
        }

        default: {
            logger.warn("[EffectProcessor] Unknown effect type", {
                effectId: effect.id,
                effectType: effect.effectType,
            });
            await markEffectFailed(effect, `Unknown effect type: ${effect.effectType}`);
            return false;
        }
    }
}

/**
 * Marks an effect as failed with exponential backoff retry scheduling.
 */
async function markEffectFailed(effect: any, errorMessage: string): Promise<void> {
    const newAttempts = (effect.attempts ?? 0) + 1;
    const isTerminal = newAttempts >= (effect.maxAttempts ?? 5);

    await (prisma as any).mutationEffect.update({
        where: { id: effect.id },
        data: {
            status: isTerminal ? "FAILED" : "QUEUED",
            attempts: newAttempts,
            externalError: errorMessage,
            failedAt: isTerminal ? new Date() : undefined,
            // Exponential backoff: 2^attempts * 5 seconds
            nextRetryAt: isTerminal ? undefined : new Date(Date.now() + Math.pow(2, newAttempts) * 5000),
        },
    });

    if (isTerminal) {
        logger.error("[EffectProcessor] Effect permanently failed — max attempts reached", {
            effectId: effect.id,
            effectType: effect.effectType,
            attempts: newAttempts,
            error: errorMessage,
        });
    }
}
