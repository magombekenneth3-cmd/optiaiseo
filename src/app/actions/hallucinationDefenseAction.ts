"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { auditLlmBrandHallucinations } from "@/lib/gsov/hallucination-defense";

export async function auditBrandHallucinationsAction(
    siteId: string,
    brandName: string,
    query: string,
    targetDomain: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const report = await auditLlmBrandHallucinations(siteId, brandName, query, targetDomain);

    return {
        success: true,
        data: report,
    };
}
