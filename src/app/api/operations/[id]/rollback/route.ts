import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { type OperationStatus, VALID_TRANSITIONS } from "@/lib/mutations/types";
import { assertAllKillSwitchesClear, MutationBlockedError } from "@/lib/mutations";

/**
 * Known Prisma model names that support rollback.
 * Only models in this set can be targeted by the dynamic restore logic.
 */
const ROLLBACKABLE_MODELS = new Set([
    "blog",
    "site",
    "experiment",
    "plannerItem",
    "audit",
    "competitor",
]);

/**
 * POST /api/operations/[id]/rollback
 *
 * Triggers compensation for a committed operation by restoring the snapshot
 * beforeState. Only available when the operation has a snapshot with
 * beforeState and is in a post-commit status.
 *
 * Creates a new MutationAuditEvent of type "ROLLED_BACK" and transitions
 * the operation status to "ROLLED_BACK".
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: operationId } = await params;

    // Fetch operation with snapshot
    const operation = await (prisma as any).mutationOperation.findUnique({
        where: { id: operationId },
        include: {
            snapshot: true,
            site: {
                select: { id: true, domain: true, userId: true },
            },
        },
    });

    if (!operation) {
        return NextResponse.json({ error: "Operation not found" }, { status: 404 });
    }

    // Authorization: only site owner can rollback
    if (operation.site.userId !== session.user.id) {
        return NextResponse.json({ error: "Only the site owner can rollback operations" }, { status: 403 });
    }

    // Rollback eligibility: use the canonical state machine instead of
    // a hand-rolled list. ROLLED_BACK must be a valid target from the
    // current status, otherwise the transition is illegal.
    const currentStatus = operation.status as OperationStatus;
    const allowedTargets = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowedTargets.includes("ROLLED_BACK")) {
        return NextResponse.json(
            { error: `Cannot rollback operation in status: ${currentStatus}` },
            { status: 409 }
        );
    }

    if (!operation.snapshot?.beforeState) {
        return NextResponse.json(
            { error: "No snapshot available for rollback" },
            { status: 409 }
        );
    }

    // Kill-switch enforcement: rollbacks must respect the same safety
    // controls as forward mutations. If automations are paused for this
    // site, the rollback is blocked.
    try {
        await assertAllKillSwitchesClear(operation.site.id);
    } catch (ksErr: unknown) {
        if (ksErr instanceof MutationBlockedError) {
            logger.warn("[Operations] Rollback blocked by kill switch", {
                operationId,
                siteId: operation.site.id,
                error: (ksErr as Error).message,
            });
            return NextResponse.json(
                { error: `Rollback blocked: ${(ksErr as Error).message}` },
                { status: 409 }
            );
        }
        throw ksErr;
    }

    // Perform rollback
    try {
        const beforeState = operation.snapshot.beforeState as Record<string, unknown>;
        const targetModel = operation.targetModel; // e.g. "Blog"
        const targetId = operation.targetId;

        // Detect third-party effects that cannot be automatically reversed.
        // The rollback only restores local DB state; remote side effects
        // (WordPress publish, GitHub PR, IndexNow) are marked as
        // LOCAL_ONLY so the user is aware.
        const thirdPartyNotes: string[] = [];
        const effects = operation.effects ?? [];
        for (const effect of effects) {
            const effectType = typeof effect === "object" ? (effect as any).effectType : String(effect);
            if (["WORDPRESS_PUBLISH", "GITHUB_PR", "GHOST_PUBLISH", "MEDIUM_PUBLISH"].includes(effectType)) {
                thirdPartyNotes.push(`${effectType}: remote asset not automatically reversed — manual cleanup may be required`);
            }
        }

        // Determine Prisma model name (lowercase first letter)
        const prismaModel = targetModel.charAt(0).toLowerCase() + targetModel.slice(1);

        // Guard: verify the model exists in our allow-list to prevent
        // dynamic access to arbitrary Prisma models
        if (!ROLLBACKABLE_MODELS.has(prismaModel)) {
            logger.error("[Operations] Rollback target model not in allow-list", {
                operationId,
                targetModel,
                prismaModel,
            });
            return NextResponse.json(
                { error: `Rollback is not supported for model: ${targetModel}` },
                { status: 422 }
            );
        }

        // Build the update payload from beforeState, excluding non-updatable fields
        const excludeFields = new Set(["id", "siteId", "createdAt"]);
        const updateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(beforeState)) {
            if (!excludeFields.has(key)) {
                updateData[key] = value;
            }
        }

        // Execute rollback in a transaction
        await (prisma as any).$transaction([
            // 1. Restore target to beforeState
            (prisma as any)[prismaModel].update({
                where: { id: targetId },
                data: updateData,
            }),
            // 2. Update operation status
            (prisma as any).mutationOperation.update({
                where: { id: operationId },
                data: {
                    status: "ROLLED_BACK",
                    completedAt: new Date(),
                },
            }),
            // 3. Append audit event
            (prisma as any).mutationAuditEvent.create({
                data: {
                    operationId,
                    eventType: "ROLLED_BACK",
                    actorId: session.user.id,
                    details: {
                        trigger: "manual",
                        rolledBackBy: session.user.id,
                        rolledBackAt: new Date().toISOString(),
                        previousStatus: operation.status,
                        rollbackScope: thirdPartyNotes.length > 0 ? "LOCAL_ONLY" : "FULL",
                        thirdPartyNotes: thirdPartyNotes.length > 0 ? thirdPartyNotes : undefined,
                    },
                },
            }),
        ]);

        logger.info("[Operations] Manual rollback completed", {
            operationId,
            targetModel,
            targetId,
            rolledBackBy: session.user.id,
        });

        return NextResponse.json({
            success: true,
            operationId,
            newStatus: "ROLLED_BACK",
        });
    } catch (err: unknown) {
        logger.error("[Operations] Rollback failed", {
            operationId,
            error: (err as Error)?.message,
        });
        // Sanitize: do not expose internal error details to the client
        return NextResponse.json(
            { error: "Rollback failed. The operation could not be reverted. Check the audit log for details." },
            { status: 500 }
        );
    }
}
