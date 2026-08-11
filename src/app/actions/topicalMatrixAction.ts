"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { buildTopicalAuthorityMatrix } from "@/lib/blog/topical-matrix";

export async function getTopicalAuthorityMatrix(siteId: string) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const report = await buildTopicalAuthorityMatrix(siteId);

    return {
        success: true,
        data: report
    };
}
