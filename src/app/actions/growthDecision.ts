"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { getPersistedDecisions } from "@/lib/growth/decision-persistence";
import { runGrowthDecisionPipeline } from "@/lib/opportunity-engine";

export async function getTopGrowthDecisions(siteId: string) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    // Strict fast DB/Redis read — NO synchronous fallback analysis!
    const decisions = await getPersistedDecisions(siteId);

    return {
        success: true,
        data: decisions,
        status: decisions.length > 0 ? "READY" : "SYNC_PENDING",
    };
}

export async function triggerGrowthDecisionSync(siteId: string) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "EDIT");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    // Asynchronous background trigger
    const result = await runGrowthDecisionPipeline(siteId);

    return {
        success: true,
        status: result.status ?? "COMPLETED",
        count: result.count,
    };
}
