export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";

/**
 * Extended health endpoint — checks real dependencies, not just process uptime.
 * Used by: JobPoller.tsx, Railway health check, external uptime monitors.
 * Railway's health check should point here, not just "/".
 */
export async function GET() {
    const checks: Record<string, "ok" | "error"> = {};
    let healthy = true;

    // ── Database check ────────────────────────────────────────────────────────
    let pendingJobs = 0;
    try {
        const [, jobCount] = await Promise.all([
            prisma.$queryRaw`SELECT 1`,
            prisma.audit.count({
                where: {
                    fixStatus: "PENDING",
                    runTimestamp: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
                },
            }),
        ]);
        pendingJobs = jobCount;
        checks.database = "ok";
    } catch (error: unknown) {
        logger.error("[HealthCheck] Database unreachable:", {
            error: (error as Error).message || String(error),
        });
        checks.database = "error";
        healthy = false;
    }

    // ── Redis check ───────────────────────────────────────────────────────────
    try {
        await redis.ping();
        checks.redis = "ok";
    } catch (error: unknown) {
        logger.error("[HealthCheck] Redis unreachable:", {
            error: (error as Error).message || String(error),
        });
        checks.redis = "error";
        // Redis failure degrades rate limiting and caching but is not fatal
        // for basic functionality — don't mark fully unhealthy
    }

    const estimatedWaitMinutes = Math.ceil(pendingJobs * 1.5);

    return NextResponse.json(
        {
            status: healthy ? "healthy" : "unhealthy",
            checks,
            queue: {
                pendingJobs,
                estimatedWaitMinutes,
            },
        },
        { status: healthy ? 200 : 503 },
    );
}
