import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

/**
 * Writes an immutable record to AuditLog for any admin mutation.
 *
 * Never throws — an audit log failure must never fail the primary operation.
 * Use this in every admin POST/PATCH/DELETE route:
 *
 * ```ts
 * await logAdminAction({
 *   actorId:   guard.user.id,
 *   action:    "subscription.update",
 *   target:    userId,
 *   payload:   { from: "FREE", to: tier },
 *   ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim(),
 * });
 * ```
 */
export async function logAdminAction(params: {
    actorId:   string;
    action:    string;
    target:    string;
    payload?:  Record<string, unknown>;
    ipAddress?: string | null;
}): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                actorId:   params.actorId,
                action:    params.action,
                target:    params.target,
                payload:   params.payload
                    ? (JSON.parse(JSON.stringify(params.payload)) as Prisma.InputJsonObject)
                    : undefined,
                ipAddress: params.ipAddress ?? null,
            },
        });
    } catch (err: unknown) {
        // Log but never re-throw — a failed audit write must not block the response.
        logger.error("[AuditLog] Failed to write audit record", {
            error:  err instanceof Error ? err.message : String(err),
            action: params.action,
            target: params.target,
        });
    }
}
