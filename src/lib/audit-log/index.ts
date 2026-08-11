import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function logAuditEvent(data: {
    actorId: string;
    action: string;
    target: string;
    payload?: Record<string, unknown>;
    ipAddress?: string;
}) {
    try {
        await prisma.auditLog.create({
            data: {
                actorId: data.actorId,
                action: data.action,
                target: data.target,
                payload: data.payload ? JSON.stringify(data.payload) : undefined,
                ipAddress: data.ipAddress,
            },
        });
    } catch (err: unknown) {
        logger.error("[AuditLog] Failed to record audit log:", {
            action: data.action,
            actorId: data.actorId,
            error: (err as Error)?.message || String(err),
        });
    }
}
