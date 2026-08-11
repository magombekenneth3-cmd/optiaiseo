"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { runAgencyAutopilotJob } from "@/lib/agency/autopilot";

export async function triggerAgencyAutopilotAction(
    organizationId: string,
    siteId: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "EDIT");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const result = await runAgencyAutopilotJob(organizationId, siteId);

    return {
        success: result.pdfReportGenerated,
        data: result,
    };
}
