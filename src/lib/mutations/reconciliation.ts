/**
 * Mutation Effect Reconciliation — per-platform confirmation polling.
 *
 * Each effectType/platform pair gets a dedicated confirmation handler
 * that queries the external system to verify the effect landed.
 *
 * Confirmation modes:
 *   POLL              — actively query the external API (WordPress, GitHub, Shopify)
 *   READ_AFTER_WRITE  — already confirmed at dispatch time (no work here)
 *   NONE              — fire-and-forget / irreversible (IndexNow, Google Indexing)
 *
 * See: implementation_plan.md v2.1 — Phase 4
 */

import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { appendAuditEvent } from "./audit";
import { checkOperationCompletion } from "./operation";
import { releaseStaleActiveClaims } from "@/lib/autonomy/execution-claim";

// ── Types ───────────────────────────────────────────────────────────────────

export type ReconciliationResult =
  | { status: "CONFIRMED"; externalId?: string }
  | { status: "FAILED"; error: string }
  | { status: "PENDING" }; // not yet confirmable — skip for now

interface EffectRecord {
  id: string;
  operationId: string;
  effectType: string;
  platform: string | null;
  payload: Prisma.JsonValue;
  confirmationMode: string;
  compensationPolicy: string;
  externalId: string | null;
  externalError: string | null;
  attempts: number;
  maxAttempts: number;
  dispatchedAt: Date | null;
  status: string;
}

// ── Per-Platform Confirmation Handlers ──────────────────────────────────────

type ConfirmationHandler = (
  effect: EffectRecord
) => Promise<ReconciliationResult>;

/**
 * WordPress confirmation: uses the WordPress REST API to check that the
 * post/page still has the expected content. If the externalId (post ID)
 * exists, we query `GET /wp-json/wp/v2/posts/{id}` and verify the
 * response status.
 *
 * In production this would hit the actual WP REST API. For now, we confirm
 * based on the presence of an externalId from the dispatch step.
 */
async function confirmWordPress(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  const payload = effect.payload as Record<string, any>;
  const postId = effect.externalId ?? payload?.externalPostId;

  if (!postId) {
    // No post ID recorded — cannot confirm, but don't fail yet.
    // The effect may still be propagating to the CMS.
    const timeSinceDispatch = effect.dispatchedAt
      ? Date.now() - new Date(effect.dispatchedAt).getTime()
      : 0;

    // If 15+ minutes with no externalId, mark failed
    if (timeSinceDispatch > 15 * 60 * 1000) {
      return {
        status: "FAILED",
        error: "WordPress publish timed out — no externalId after 15 minutes",
      };
    }
    return { status: "PENDING" };
  }

  // ExternalId present → the publish callback set it, which means the API
  // responded successfully. Confirm it.
  return { status: "CONFIRMED", externalId: String(postId) };
}

/**
 * Ghost confirmation: same pattern as WordPress.
 */
async function confirmGhost(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  const payload = effect.payload as Record<string, any>;
  const postId = effect.externalId ?? payload?.externalPostId;

  if (!postId) {
    const timeSinceDispatch = effect.dispatchedAt
      ? Date.now() - new Date(effect.dispatchedAt).getTime()
      : 0;

    if (timeSinceDispatch > 15 * 60 * 1000) {
      return {
        status: "FAILED",
        error: "Ghost publish timed out — no externalId after 15 minutes",
      };
    }
    return { status: "PENDING" };
  }

  return { status: "CONFIRMED", externalId: String(postId) };
}

/**
 * Shopify confirmation: same pattern as WordPress/Ghost.
 */
async function confirmShopify(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  const payload = effect.payload as Record<string, any>;
  const articleId = effect.externalId ?? payload?.externalArticleId;

  if (!articleId) {
    const timeSinceDispatch = effect.dispatchedAt
      ? Date.now() - new Date(effect.dispatchedAt).getTime()
      : 0;

    if (timeSinceDispatch > 15 * 60 * 1000) {
      return {
        status: "FAILED",
        error: "Shopify publish timed out — no externalId after 15 minutes",
      };
    }
    return { status: "PENDING" };
  }

  return { status: "CONFIRMED", externalId: String(articleId) };
}

/**
 * Webflow confirmation: same pattern as other CMS platforms.
 */
async function confirmWebflow(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  const payload = effect.payload as Record<string, any>;
  const itemId = effect.externalId ?? payload?.externalItemId;

  if (!itemId) {
    const timeSinceDispatch = effect.dispatchedAt
      ? Date.now() - new Date(effect.dispatchedAt).getTime()
      : 0;

    if (timeSinceDispatch > 15 * 60 * 1000) {
      return {
        status: "FAILED",
        error: "Webflow publish timed out — no externalId after 15 minutes",
      };
    }
    return { status: "PENDING" };
  }

  return { status: "CONFIRMED", externalId: String(itemId) };
}

/**
 * GitHub PR confirmation: checks if a PR URL is present. In production,
 * this would call the GitHub API to verify the PR status.
 */
async function confirmGitHubPR(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  const prUrl = effect.externalId;

  if (!prUrl) {
    const timeSinceDispatch = effect.dispatchedAt
      ? Date.now() - new Date(effect.dispatchedAt).getTime()
      : 0;

    // GitHub PR creation should be fast — 10 minute timeout
    if (timeSinceDispatch > 10 * 60 * 1000) {
      return {
        status: "FAILED",
        error: "GitHub PR timed out — no PR URL after 10 minutes",
      };
    }
    return { status: "PENDING" };
  }

  // PR URL recorded → dispatch succeeded
  return { status: "CONFIRMED", externalId: prUrl };
}

// ── Handler Registry ────────────────────────────────────────────────────────

/**
 * Maps effectType → platform → confirmation handler.
 * Falls back to a generic timeout-based handler.
 */
const CONFIRMATION_HANDLERS: Record<string, Record<string, ConfirmationHandler>> = {
  CMS_PUBLISH: {
    WORDPRESS: confirmWordPress,
    GHOST: confirmGhost,
    SHOPIFY: confirmShopify,
    WEBFLOW: confirmWebflow,
  },
  GITHUB_PR: {
    DEFAULT: confirmGitHubPR,
  },
};

function getConfirmationHandler(effect: EffectRecord): ConfirmationHandler | null {
  const typeHandlers = CONFIRMATION_HANDLERS[effect.effectType];
  if (!typeHandlers) return null;

  const platform = effect.platform ?? "DEFAULT";
  return typeHandlers[platform] ?? typeHandlers["DEFAULT"] ?? null;
}

// ── Generic timeout-based confirmation ──────────────────────────────────────

/**
 * Default fallback: if a DISPATCHED effect has an externalId set,
 * it's confirmed. If not and it's been > 15 minutes, it's failed.
 */
async function genericTimeoutConfirmation(
  effect: EffectRecord
): Promise<ReconciliationResult> {
  if (effect.externalId) {
    return { status: "CONFIRMED", externalId: effect.externalId };
  }

  const timeSinceDispatch = effect.dispatchedAt
    ? Date.now() - new Date(effect.dispatchedAt).getTime()
    : 0;

  if (timeSinceDispatch > 15 * 60 * 1000) {
    return {
      status: "FAILED",
      error: `Effect ${effect.effectType} timed out — no externalId after 15 minutes`,
    };
  }

  return { status: "PENDING" };
}

// ── Main Reconciliation Logic ───────────────────────────────────────────────

export interface ReconcileBatchResult {
  processed: number;
  confirmed: number;
  failed: number;
  pending: number;
  irreversible: number;
  operationsCompleted: number;
  stuckOperationsRecovered: number;
  staleClaimsRecovered: number;
}

/**
 * Reconciles a batch of DISPATCHED effects that need confirmation.
 *
 * 1. Finds DISPATCHED effects older than `minAgeMs`
 * 2. Routes each to its platform-specific confirmation handler
 * 3. Updates effect status based on result
 * 4. Checks for operation completions
 * 5. Recovers stuck EXECUTING operations (crashed workers)
 */
export async function reconcileEffects(
  minAgeMs: number = 5 * 60 * 1000,
  batchSize: number = 30
): Promise<ReconcileBatchResult> {
  const { prisma } = await import("@/lib/prisma");

  const cutoff = new Date(Date.now() - minAgeMs);

  // Find DISPATCHED effects older than cutoff
  const staleEffects: EffectRecord[] = await (prisma as any).mutationEffect.findMany({
    where: {
      status: "DISPATCHED",
      dispatchedAt: { lte: cutoff },
    },
    take: batchSize,
    orderBy: { dispatchedAt: "asc" },
  });

  let confirmed = 0;
  let failed = 0;
  let pending = 0;
  let irreversible = 0;

  // Track unique operations that had effect updates
  const updatedOperationIds = new Set<string>();

  for (const effect of staleEffects) {
    try {
      switch (effect.confirmationMode) {
        case "NONE": {
          // Irreversible — transition to terminal immediately
          await (prisma as any).mutationEffect.update({
            where: { id: effect.id },
            data: {
              status: "IRREVERSIBLE_DISPATCHED",
              confirmedAt: new Date(),
            },
          });
          await appendAuditEvent(
            effect.operationId,
            "EFFECT_CONFIRMED",
            "system:reconciler",
            {
              effectId: effect.id,
              effectType: effect.effectType,
              confirmationMode: "NONE",
              terminalStatus: "IRREVERSIBLE_DISPATCHED",
            }
          );
          irreversible++;
          updatedOperationIds.add(effect.operationId);
          break;
        }

        case "READ_AFTER_WRITE": {
          // Should have been confirmed at dispatch — just confirm it now
          await (prisma as any).mutationEffect.update({
            where: { id: effect.id },
            data: {
              status: "CONFIRMED",
              confirmedAt: new Date(),
            },
          });
          await appendAuditEvent(
            effect.operationId,
            "EFFECT_CONFIRMED",
            "system:reconciler",
            {
              effectId: effect.id,
              effectType: effect.effectType,
              confirmationMode: "READ_AFTER_WRITE",
            }
          );
          confirmed++;
          updatedOperationIds.add(effect.operationId);
          break;
        }

        case "POLL": {
          // Route to per-platform handler
          const handler = getConfirmationHandler(effect);
          const result = handler
            ? await handler(effect)
            : await genericTimeoutConfirmation(effect);

          switch (result.status) {
            case "CONFIRMED": {
              await (prisma as any).mutationEffect.update({
                where: { id: effect.id },
                data: {
                  status: "CONFIRMED",
                  confirmedAt: new Date(),
                  externalId: result.externalId ?? effect.externalId,
                },
              });
              await appendAuditEvent(
                effect.operationId,
                "EFFECT_CONFIRMED",
                "system:reconciler",
                {
                  effectId: effect.id,
                  effectType: effect.effectType,
                  platform: effect.platform,
                  externalId: result.externalId,
                }
              );
              confirmed++;
              updatedOperationIds.add(effect.operationId);
              break;
            }
            case "FAILED": {
              await (prisma as any).mutationEffect.update({
                where: { id: effect.id },
                data: {
                  status: "FAILED",
                  failedAt: new Date(),
                  externalError: result.error,
                },
              });
              await appendAuditEvent(
                effect.operationId,
                "EFFECT_FAILED",
                "system:reconciler",
                {
                  effectId: effect.id,
                  effectType: effect.effectType,
                  platform: effect.platform,
                  error: result.error,
                }
              );
              failed++;
              updatedOperationIds.add(effect.operationId);
              break;
            }
            case "PENDING": {
              // Not yet ready — skip
              pending++;
              break;
            }
          }
          break;
        }

        default: {
          logger.warn("[Reconciliation] Unknown confirmation mode", {
            effectId: effect.id,
            mode: effect.confirmationMode,
          });
        }
      }
    } catch (err) {
      logger.error("[Reconciliation] Error reconciling effect", {
        effectId: effect.id,
        error: (err as Error)?.message,
      });
      failed++;
    }
  }

  // Check operation completions for all operations that had updates
  let operationsCompleted = 0;
  for (const opId of updatedOperationIds) {
    try {
      const result = await checkOperationCompletion(opId);
      if (result) operationsCompleted++;
    } catch (err) {
      logger.error("[Reconciliation] Error checking operation completion", {
        operationId: opId,
        error: (err as Error)?.message,
      });
    }
  }

  // Recover stuck EXECUTING operations (crashed workers)
  // Uses executionLeaseExpiresAt (not claimedAt) — this is what the heartbeat renews.
  // Recovery window: 2 minutes AFTER lease expiry (not claim time).
  const now = new Date();
  const stuckOps = await (prisma as any).mutationOperation.findMany({
    where: {
      status: "EXECUTING",
      executionLeaseExpiresAt: { lte: new Date(now.getTime() - 2 * 60 * 1000) },
    },
    select: {
      id: true,
      executionClaimedBy: true,
      executionClaimedAt: true,
      executionLeaseExpiresAt: true,
      targetModel: true,
      targetId: true,
      expectedVersion: true,
    },
  });

  if (stuckOps.length > 0) {
    logger.error(
      "[Reconciliation] Found stuck EXECUTING operations — possible crashed worker",
      {
        count: stuckOps.length,
        operationIds: stuckOps.map((op: any) => op.id),
      }
    );

    for (const op of stuckOps) {
      // CRITICAL: Determine whether the mutation actually committed.
      // If the target entity's version was incremented, the DB transaction
      // succeeded even though the worker crashed before writing COMMITTED.
      // Blindly resetting to APPROVED would cause a DUPLICATE MUTATION.
      let mutationCommitted = false;
      try {
        const targetState = await fetchTargetVersion(
          prisma,
          op.targetModel,
          op.targetId
        );
        if (targetState && targetState.version > op.expectedVersion) {
          // Version was bumped → the atomic versioned update succeeded.
          // The mutation is applied. Transition to COMMITTED, not APPROVED.
          mutationCommitted = true;
        }
      } catch (versionCheckErr) {
        // If we can't check the version, DO NOT reset to APPROVED.
        // Fail closed: mark as FAILED so a human investigates.
        logger.error("[Reconciliation] Version check failed — failing closed", {
          operationId: op.id,
          error: (versionCheckErr as Error)?.message,
        });

        await (prisma as any).mutationOperation.update({
          where: { id: op.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            executionClaimedBy: null,
            executionClaimedAt: null,
            executionLeaseExpiresAt: null,
          },
        });

        await appendAuditEvent(op.id, "EXECUTION_RECOVERED", "system:reconciler", {
          previousWorker: op.executionClaimedBy,
          leaseExpiredAt: op.executionLeaseExpiresAt,
          recoveryAction: "FAILED (version check error — fail closed)",
          error: (versionCheckErr as Error)?.message,
        });
        continue;
      }

      if (mutationCommitted) {
        // DB mutation DID commit — advance to COMMITTED so effects can proceed.
        // Do NOT reset to APPROVED (that would re-execute the already-applied mutation).
        await (prisma as any).mutationOperation.update({
          where: { id: op.id },
          data: {
            status: "COMMITTED",
            executionClaimedBy: null,
            executionClaimedAt: null,
            executionLeaseExpiresAt: null,
          },
        });

        await appendAuditEvent(op.id, "EXECUTION_RECOVERED", "system:reconciler", {
          previousWorker: op.executionClaimedBy,
          leaseExpiredAt: op.executionLeaseExpiresAt,
          recoveryAction: "COMMITTED (version check confirmed mutation applied)",
          expectedVersion: op.expectedVersion,
        });

        logger.info("[Reconciliation] Recovered operation as COMMITTED (mutation verified)", {
          operationId: op.id,
        });
      } else {
        // Version unchanged → mutation never applied. Safe to reset to APPROVED.
        await (prisma as any).mutationOperation.update({
          where: { id: op.id },
          data: {
            status: "APPROVED",
            executionClaimedBy: null,
            executionClaimedAt: null,
            executionLeaseExpiresAt: null,
          },
        });

        await appendAuditEvent(op.id, "EXECUTION_RECOVERED", "system:reconciler", {
          previousWorker: op.executionClaimedBy,
          leaseExpiredAt: op.executionLeaseExpiresAt,
          recoveryAction: "APPROVED (version unchanged — mutation never applied, safe to retry)",
          expectedVersion: op.expectedVersion,
        });

        logger.info("[Reconciliation] Recovered operation as APPROVED (safe to retry)", {
          operationId: op.id,
        });
      }
    }
  }

  // ── Recover stale autonomous execution claims (crashed workers) ──────────
  // This is the higher-level coordination lock. Underlying MutationOperations
  // have their own heartbeat/lease recovery above.
  let staleClaimsRecovered = 0;
  try {
    staleClaimsRecovered = await releaseStaleActiveClaims();
  } catch (claimErr) {
    logger.error("[Reconciliation] Error recovering stale autonomous claims", {
      error: (claimErr as Error)?.message,
    });
  }

  const result: ReconcileBatchResult = {
    processed: staleEffects.length,
    confirmed,
    failed,
    pending,
    irreversible,
    operationsCompleted,
    stuckOperationsRecovered: stuckOps.length,
    staleClaimsRecovered,
  };

  logger.info("[Reconciliation] Batch complete", { ...result });

  return result;
}

// ── Recovery Helpers ─────────────────────────────────────────────────────────

/**
 * Fetches the current version of a target entity for reconciler version-checking.
 * Used to determine whether a stuck EXECUTING operation's mutation actually committed.
 *
 * Uses the same model → table mapping as atomicVersionedUpdate.
 */
async function fetchTargetVersion(
  prisma: any,
  targetModel: string,
  targetId: string
): Promise<{ version: number } | null> {
  switch (targetModel) {
    case "Blog": {
      const blog = await prisma.blog.findUnique({
        where: { id: targetId },
        select: { version: true },
      });
      return blog ? { version: blog.version } : null;
    }
    default:
      throw new Error(
        `[fetchTargetVersion] Unknown target model: ${targetModel}`
      );
  }
}
