import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

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

    // Rollback eligibility check
    const rollbackableStatuses = [
        "COMMITTED",
        "EFFECTS_PENDING",
        "COMPLETED",
        "COMPLETED_WITH_ERRORS",
    ];
    if (!rollbackableStatuses.includes(operation.status)) {
        return NextResponse.json(
            { error: `Cannot rollback operation in status: ${operation.status}` },
            { status: 409 }
        );
    }

    if (!operation.snapshot?.beforeState) {
        return NextResponse.json(
            { error: "No snapshot available for rollback" },
            { status: 409 }
        );
    }

    // Perform rollback
    try {
        const beforeState = operation.snapshot.beforeState as Record<string, unknown>;
        const targetModel = operation.targetModel; // e.g. "Blog"
        const targetId = operation.targetId;

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
