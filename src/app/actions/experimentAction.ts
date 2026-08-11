"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { getSiteExperimentSummary, evaluate28DayExperimentLift } from "@/lib/experiments/tracker";

export async function fetchSiteExperimentSummaryAction(siteId: string) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const summary = await getSiteExperimentSummary(siteId);

    return {
        success: true,
        data: summary,
    };
}

export async function evaluateExperimentLiftAction(experimentId: string, siteId: string) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "EDIT");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const exp = await evaluate28DayExperimentLift(experimentId);

    return {
        success: true,
        data: exp,
    };
}
