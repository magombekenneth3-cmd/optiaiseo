"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { executeGrowthDecision } from "@/lib/growth/execution-engine";

export async function executeGrowthDecisionAction(
    decisionId: string,
    siteId: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    // Execution requires EDIT permissions on the site
    const site = await assertSiteAccess(siteId, auth.user.id, "EDIT");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const result = await executeGrowthDecision(decisionId, siteId);

    return {
        success: result.success,
        data: result
    };
}
