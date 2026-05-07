export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const keysDeleted = await prisma.idempotencyKey.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
                status: { in: ["SUCCEEDED", "FAILED"] },
            },
        });

        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const snapshotsDeleted = await prisma.rankSnapshot.deleteMany({
            where: {
                recordedAt: { lt: ninetyDaysAgo },
                device: { not: "seed" },
            },
        });

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const webhooksDeleted = await prisma.webhookEvent.deleteMany({
            where: {
                status: "PROCESSED",
                createdAt: { lt: thirtyDaysAgo },
            },
        });

        return NextResponse.json({
            keysDeleted: keysDeleted.count,
            snapshotsDeleted: snapshotsDeleted.count,
            webhooksDeleted: webhooksDeleted.count,
        });

    } catch (err: unknown) {
        logger.error("[Cleanup] Cron failed:", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
    }
}
