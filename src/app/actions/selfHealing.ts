"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { analyzeInternalLinking } from "@/lib/seo-audit/internal-links";
import { revalidatePath } from "next/cache";
import { requireUser, assertSiteOwnership } from "@/lib/auth/require-user";

export async function getSelfHealingData(siteId: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Unauthorized" };

        const [logs, linkingRecs] = await Promise.all([
            prisma.selfHealingLog.findMany({
                where: { siteId: site.id },
                orderBy: { createdAt: "desc" },
                take: 10,
            }),
            analyzeInternalLinking(site.id),
        ]);

        return { success: true, logs, linkingRecs };
    } catch (error: unknown) {
        logger.error("Failed to fetch self-healing data:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch data." };
    }
}

export async function toggleAutopilot(siteId: string, enabled: boolean) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Unauthorized" };

        await prisma.site.update({
            where: { id: site.id },
            data: { operatingMode: enabled ? "AUTOPILOT" : "REPORT_ONLY" },
        });

        await prisma.selfHealingLog.create({
            data: {
                siteId,
                issueType: "AUTOPILOT_TOGGLE",
                description: enabled ? "Autopilot mode enabled" : "Autopilot mode disabled",
                actionTaken: enabled ? "AUTOPILOT_ENABLED" : "AUTOPILOT_DISABLED",
                status: "COMPLETED",
                metadata: { triggeredBy: user.id },
            },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidatePath("/dashboard");
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to toggle autopilot:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to toggle autopilot." };
    }
}