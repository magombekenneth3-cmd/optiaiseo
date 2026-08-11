"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { triggerInstantIndexing } from "@/lib/indexing/indexnow";

export async function submitInstantIndexingAction(
    siteId: string,
    urls: string[]
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "EDIT");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const result = await triggerInstantIndexing(siteId, urls);

    return {
        success: true,
        data: result
    };
}
