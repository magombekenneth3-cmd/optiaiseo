"use server";

import { requireUser, assertSiteAccess } from "@/lib/auth/require-user";
import { dispatchWhiteLabelExecutiveDigest } from "@/lib/agency/email-dispatcher";

export async function sendAgencyDigestEmailAction(
    siteId: string,
    recipientEmail: string,
    agencyName: string,
    customDomain: string
) {
    const auth = await requireUser();
    if (!auth.ok) return auth.error;

    const site = await assertSiteAccess(siteId, auth.user.id, "VIEW");
    if (!site) return { success: false, error: "Access denied", code: "unauthorized" };

    const result = await dispatchWhiteLabelExecutiveDigest({
        recipientEmail,
        clientSiteName: site.brandName || site.domain,
        agencyName,
        customDomain,
        pdfBufferLength: 12500,
    });

    if (!result.success) {
        return {
            success: false,
            error: "Failed to send the executive digest. Please check your email configuration.",
        };
    }

    return {
        success: true,
        data: {
            messageId: result.messageId,
            deliveredAt: result.deliveredAt,
        },
    };
}
