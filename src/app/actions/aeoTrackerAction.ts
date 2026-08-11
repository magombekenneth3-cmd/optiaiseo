"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { getCombinedAeoSeoOverview } from "@/lib/seo-audit/modules/aeo-tracker";

export async function fetchCombinedAeoSeoOverview(
    siteId: string,
    keyword: string,
    targetUrl: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const report = await getCombinedAeoSeoOverview(siteId, keyword, targetUrl);

    return {
        success: true,
        data: report,
    };
}
