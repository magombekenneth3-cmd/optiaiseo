"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { auditCompetitorWeaknesses } from "@/lib/intelligence/competitor-interceptor";

export async function fetchCompetitorStealOpportunities(
    siteId: string,
    competitorDomain: string,
    targetKeyword: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const report = await auditCompetitorWeaknesses(siteId, competitorDomain, targetKeyword);

    return {
        success: true,
        data: report,
    };
}
