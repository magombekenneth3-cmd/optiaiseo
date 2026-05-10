"use server";

import { logger } from "@/lib/logger";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
    generatePredictiveAlerts,
    type PredictiveAlert,
} from "@/lib/alerts/engine";
import { sendAeoDropAlert } from "@/lib/email/aeo-alert";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Input schemas

const uuidSchema = z.string().min(1).max(50);

// Return types

type GetSiteAlertsResult =
    | { success: true; alerts: PredictiveAlert[] }
    | { success: false; error: string };

// Action

export async function getSiteAlerts(
    siteId: string,
): Promise<GetSiteAlertsResult> {
    // --- Input validation ---
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const userId = session.user.id;

        // Scope the aeoReport query to the user's site to prevent cross-user
        // data leakage — the original queried aeoReport with siteId alone (no userId
        // filter), relying on the site lookup below to catch unauthorised access
        // after the fact. Both queries are still parallel via Promise.all.
        const [site, recentAeo] = await Promise.all([
            prisma.site.findFirst({
                where: { id: siteId, userId },
                select: {
                    domain: true,
                    user: { select: { email: true } },
                },
            }),
            prisma.aeoReport.findMany({
                where: { siteId, site: { userId } },
                orderBy: { createdAt: "desc" },
                take: 2,
                select: { citationScore: true },
            }),
        ]);

        if (!site) return { success: false, error: "Unauthorized" };

        const alerts: PredictiveAlert[] =
            (await generatePredictiveAlerts(siteId)) ?? [];

        // --- Email alert on critical citation drop ---
        // Only fire when we have exactly two reports to diff and the user has an
        // email address on record. A positive dropAmount (prev > latest) is a real
        // drop; negative means the score actually improved — skip in that case.
        const isCriticalCitationAlert = alerts.some(
            (a) => a.severity === "CRITICAL" && a.type === "AEO_CITATION_LOSS",
        );

        if (isCriticalCitationAlert && recentAeo.length === 2 && site.user.email) {
            const [latest, previous] = recentAeo;
            const dropAmount = previous.citationScore - latest.citationScore;

            // Guard: only email when the score actually dropped, not improved
            if (dropAmount > 0) {
                await sendAeoDropAlert(site.user.email, {
                    domain: site.domain,
                    previousScore: previous.citationScore,
                    currentScore: latest.citationScore,
                    dropAmount,
                }).catch((err: unknown) =>
                    logger.error("[Alerts] Failed to send drop alert email", {
                        error: (err as Error)?.message,
                        siteId,
                        userId,
                    }),
                );
            }
        }

        return { success: true, alerts };
    } catch (error: unknown) {
        logger.error("[Action] getSiteAlerts error", {
            error: (error as Error)?.message || String(error),
            siteId,
        });
        return { success: false, error: "Failed to fetch alerts." };
    }
}