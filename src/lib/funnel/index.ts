import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const FUNNEL_EVENTS = [
    "site_connected",
    "audit_completed",
    "fix_approved",
    "checkout_completed",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const ACTION_PREFIX = "funnel.";

export function funnelAction(event: FunnelEvent): string {
    return `${ACTION_PREFIX}${event}`;
}

export async function trackFunnelEvent(
    userId: string,
    event: FunnelEvent,
    target: string,
    properties?: Record<string, string | number | boolean | null>,
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: funnelAction(event),
                target,
                payload: properties ?? undefined,
            },
        });
    } catch (err: unknown) {
        logger.warn("[Funnel] Failed to record event", {
            event,
            error: (err as Error)?.message || String(err),
        });
    }
}

export type FunnelSummary = Record<FunnelEvent, number>;

export async function getFunnelSummary(since: Date): Promise<FunnelSummary> {
    const rows = await prisma.auditLog.groupBy({
        by: ["action", "actorId"],
        where: {
            action: { in: FUNNEL_EVENTS.map(funnelAction) },
            createdAt: { gte: since },
        },
    });

    const summary = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0])) as FunnelSummary;
    for (const row of rows) {
        const event = row.action.slice(ACTION_PREFIX.length) as FunnelEvent;
        if (event in summary) summary[event] += 1;
    }
    return summary;
}
