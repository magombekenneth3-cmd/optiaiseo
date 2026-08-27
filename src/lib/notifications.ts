import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Notification Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extensible notification type registry.
 * Add new types here when introducing new notification sources.
 */
export type NotificationType =
    | "audit_complete"
    | "rank_change"
    | "score_drop"
    | "serp_feature_lost"
    | "serp_feature_gained"
    | "backlink_alert"
    | "experiment_complete"
    | "mutation_failed"
    | "mutation_rolled_back"
    | "system_info";

export interface CreateNotificationInput {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    href?: string;
    metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core primitive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a persistent user notification.
 *
 * This is the canonical function for creating notifications. All notification
 * sources should use this instead of calling prisma.notification.create directly.
 *
 * Design:
 * - Fail-open: notification creation failure never bubbles up to callers
 * - Idempotent-safe: callers may retry without creating duplicates
 *   (future: add idempotency key support)
 * - Extensible: add channels (email, Slack, push) by extending this function
 *
 * @returns The created notification ID, or null if creation failed
 */
export async function createNotification(
    input: CreateNotificationInput
): Promise<string | null> {
    try {
        const notification = await prisma.notification.create({
            data: {
                userId: input.userId,
                type: input.type,
                title: input.title,
                body: input.body,
                href: input.href ?? null,
                metadata: input.metadata
                    ? (input.metadata as Prisma.InputJsonValue)
                    : Prisma.JsonNull,
            },
        });

        logger.debug("[Notifications] Created notification", {
            id: notification.id,
            userId: input.userId,
            type: input.type,
        });

        return notification.id;
    } catch (err: unknown) {
        // Fail-open: notification creation should never break the calling flow
        logger.error("[Notifications] Failed to create notification", {
            userId: input.userId,
            type: input.type,
            error: (err as Error)?.message,
        });
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers for common notification patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notify user that an audit has completed.
 */
export async function notifyAuditComplete(params: {
    userId: string;
    siteId: string;
    domain: string;
    overallScore: number;
    issueCount: number;
    auditId: string;
}): Promise<string | null> {
    const grade =
        params.overallScore >= 90 ? "A" :
        params.overallScore >= 75 ? "B" :
        params.overallScore >= 60 ? "C" :
        params.overallScore >= 40 ? "D" : "F";

    return createNotification({
        userId: params.userId,
        type: "audit_complete",
        title: `Audit Complete: ${params.domain}`,
        body: `Your SEO audit for ${params.domain} is ready. Score: ${params.overallScore}/100 (Grade ${grade}), ${params.issueCount} issue${params.issueCount !== 1 ? "s" : ""} found.`,
        href: `/dashboard/audits/${params.auditId}`,
        metadata: {
            siteId: params.siteId,
            auditId: params.auditId,
            overallScore: params.overallScore,
            grade,
            issueCount: params.issueCount,
        },
    });
}

/**
 * Notify user about a significant rank change.
 */
export async function notifyRankChange(params: {
    userId: string;
    siteId: string;
    domain: string;
    keyword: string;
    oldPosition: number;
    newPosition: number;
}): Promise<string | null> {
    const delta = params.oldPosition - params.newPosition;
    const direction = delta > 0 ? "improved" : "dropped";
    const emoji = delta > 0 ? "📈" : "📉";

    return createNotification({
        userId: params.userId,
        type: "rank_change",
        title: `${emoji} Rank ${direction}: "${params.keyword}"`,
        body: `${params.domain} ${direction} from position ${params.oldPosition} to ${params.newPosition} for "${params.keyword}".`,
        href: `/dashboard/keywords?siteId=${params.siteId}`,
        metadata: {
            siteId: params.siteId,
            keyword: params.keyword,
            oldPosition: params.oldPosition,
            newPosition: params.newPosition,
            delta,
        },
    });
}

/**
 * Notify user about a mutation operation failure.
 */
export async function notifyMutationFailed(params: {
    userId: string;
    siteId: string;
    operationId: string;
    mutationType: string;
    targetModel: string;
    error: string;
}): Promise<string | null> {
    return createNotification({
        userId: params.userId,
        type: "mutation_failed",
        title: `Mutation Failed: ${params.mutationType.replace(/_/g, " ")}`,
        body: `An automated ${params.mutationType.replace(/_/g, " ").toLowerCase()} operation on ${params.targetModel} failed: ${params.error}`,
        href: `/dashboard/operations?siteId=${params.siteId}`,
        metadata: {
            siteId: params.siteId,
            operationId: params.operationId,
            mutationType: params.mutationType,
        },
    });
}

/**
 * Notify user that a 28-day experiment has completed evaluation.
 * Includes headline metrics so the user can see results at a glance.
 */
export async function notifyExperimentComplete(params: {
    userId: string;
    siteId: string;
    experimentId: string;
    targetUrl: string;
    actionExecuted: string;
    positionDelta: number;
    clicksLiftPercent: number;
    ctrLiftPercent: number;
    revenueLiftAmount: number;
}): Promise<string | null> {
    const improved = params.positionDelta > 0;
    const emoji = improved ? "🧪✅" : "🧪📊";
    const direction = improved ? "improved" : "changed";

    // Build a concise metrics summary
    const metricLines = [
        `Position: ${params.positionDelta > 0 ? "+" : ""}${params.positionDelta} places`,
        `Clicks: ${params.clicksLiftPercent > 0 ? "+" : ""}${params.clicksLiftPercent}%`,
        `CTR: ${params.ctrLiftPercent > 0 ? "+" : ""}${params.ctrLiftPercent}pp`,
        `Revenue: ${params.revenueLiftAmount >= 0 ? "+$" : "-$"}${Math.abs(params.revenueLiftAmount)}`,
    ].join(" · ");

    return createNotification({
        userId: params.userId,
        type: "experiment_complete",
        title: `${emoji} Experiment ${direction}: ${params.actionExecuted.replace(/_/g, " ")}`,
        body: `28-day evaluation complete for ${params.targetUrl}. ${metricLines}`,
        href: `/dashboard/experiments?siteId=${params.siteId}`,
        metadata: {
            siteId: params.siteId,
            experimentId: params.experimentId,
            targetUrl: params.targetUrl,
            positionDelta: params.positionDelta,
            clicksLiftPercent: params.clicksLiftPercent,
            ctrLiftPercent: params.ctrLiftPercent,
            revenueLiftAmount: params.revenueLiftAmount,
        },
    });
}
