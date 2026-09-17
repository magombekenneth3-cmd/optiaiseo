import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function avgScore(categoryScores: unknown): number {
    if (!categoryScores || typeof categoryScores !== "object") return 0;
    const scores = Object.values(categoryScores as Record<string, number>).filter(
        (v) => typeof v === "number"
    );
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
}

const estimatedHoursSaved = (actionTaken: string): number => {
    if (actionTaken === "DEPLOYED_GITHUB_PR") return 2;
    if (actionTaken === "GENERATED_MANUAL_FIX") return 1;
    return 0;
};

export async function measureFixImpact(logId: string, siteId: string): Promise<void> {
    const log = await prisma.selfHealingLog.findUnique({ where: { id: logId } });
    if (!log) return;

    // This function is intentionally callable only after a deployment webhook
    // or equivalent trusted integration records the live deployment. PR creation
    // is not evidence of a change reaching users or crawlers.
    const metadata = (log.metadata ?? {}) as { deployedAt?: unknown };
    if (typeof metadata.deployedAt !== "string") {
        throw new Error("Cannot measure SEO impact before a verified deployment.");
    }

    const baselineAudit = await prisma.audit.findFirst({
        where: { siteId, runTimestamp: { lt: log.createdAt } },
        orderBy: { runTimestamp: "desc" },
    });

    const baselineScore = avgScore(baselineAudit?.categoryScores);

    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
        name: "audit/run-post-fix",
        data: { siteId, logId, baselineScore },
    });
}

export async function getSelfHealingStats(siteId: string) {
    const weekAgo = subDays(new Date(), 7);

    const logs = await prisma.selfHealingLog.findMany({
        where: { siteId, createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "desc" },
    });

    return {
        totalFixed: logs.filter((l) => l.status === "COMPLETED").length,
        avgImpact: avg(logs.map((l) => l.impactScore ?? 0)),
        // This is an estimate, not observed duration. Alerts do not claim time
        // savings, while prepared fixes reflect a conservative manual effort.
        timeSavedHours: logs.reduce((total, log) => total + estimatedHoursSaved(log.actionTaken), 0),
        timeSavedIsEstimate: true,
        recentLogs: logs.slice(0, 10).map((l) => ({
            id: l.id,
            description: l.description,
            impactScore: l.impactScore,
            status: l.status,
            createdAt: l.createdAt,
        })),
    };
}
