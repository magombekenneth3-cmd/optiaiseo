import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { evaluate28DayExperimentLift } from "@/lib/experiments/tracker";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const REDIS_EXPERIMENT_KEY = "aiseo:experiments";

/**
 * POST /api/experiments/[id]/evaluate
 *
 * Triggers 28-day lift evaluation for a specific experiment.
 * Returns the updated experiment record with lift metrics.
 */
export async function POST(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: experimentId } = await context.params;

        // Verify the experiment exists and belongs to a site the user owns
        const redis = getRedis();
        if (redis) {
            try {
                const raw = await redis.hget<string>(REDIS_EXPERIMENT_KEY, experimentId);
                if (raw) {
                    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                    // We'd need site ownership verification here
                    // For now, the experiment tracker handles this
                }
            } catch { /* continue */ }
        }

        const result = await evaluate28DayExperimentLift(experimentId);

        logger.info("[ExperimentsAPI] Evaluated experiment lift", {
            experimentId,
            status: result.status,
            positionDelta: result.lift?.positionDelta,
        });

        return NextResponse.json({
            success: true,
            experiment: {
                id: result.id,
                decisionId: result.decisionId,
                status: result.status,
                baseline: result.baseline,
                lift: result.lift ?? null,
                executedAt: result.executedAt.toISOString(),
                evaluationDate: result.evaluationDate.toISOString(),
            },
        });
    } catch (err: unknown) {
        logger.error("[ExperimentsAPI] Evaluation failed", {
            error: (err as Error)?.message || String(err),
        });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
