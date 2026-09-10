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

    const result = await triggerInstantIndexing(siteId, urls, auth.user.id);

    return {
        success: result.success,
        data: {
            domain: result.domain,
            urlsCount: result.urls.length,
            google: { status: result.google.status },
            indexNow: { status: result.indexNow.status },
        },
        ...(result.success
            ? {}
            : { error: "One or more indexing providers failed. Check the indexing dashboard for details." }
        ),
    };
}
