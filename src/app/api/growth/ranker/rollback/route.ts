import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { rollbackRanker, getActiveRanker } from "@/lib/growth/ranker-registry";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({})) as { targetVersion?: string };
        const result = rollbackRanker(body.targetVersion);

        logger.info("[RankerRollback] Rollback executed successfully", {
            user: session.user.email,
            activeVersion: result.activeVersion,
            previousVersion: result.previousVersion,
            auditId: result.auditId,
        });

        return NextResponse.json({
            success: true,
            activeVersion: result.activeVersion,
            previousVersion: result.previousVersion,
            auditId: result.auditId,
            currentRanker: getActiveRanker(),
        });
    } catch (err: unknown) {
        logger.error("[RankerRollback] Rollback failed", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: (err as Error)?.message || "Rollback failed" }, { status: 400 });
    }
}
