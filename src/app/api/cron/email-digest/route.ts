export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
// =============================================================================
// WEEKLY PRIORITY EMAIL DIGEST CRON
// GET /api/cron/email-digest
// Runs every Monday — sends "Top 3 Fixes This Week" emails to opted-in users.
// FREE users: monthly cadence. PRO/AGENCY: weekly.
// Protected by CRON_SECRET.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { sendPriorityDigest } from "@/lib/email";
import { extractEnrichedRecommendations } from "@/lib/seo/recommendations";

const APP_URL    = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
const JWT_SECRET = process.env.NEXTAUTH_SECRET ?? "change-me";


/** Compute a blended SEO score from categoryScores JSON. */
function blendedScore(categoryScores: unknown): number {
    if (!categoryScores || typeof categoryScores !== "object") return 0;
    const s = categoryScores as Record<string, unknown>;
    return Math.round(
        (Number(s.seo          ?? 0) * 0.5) +
        (Number(s.performance  ?? 0) * 0.3) +
        (Number(s.accessibility ?? 0) * 0.2)
    );
}

/** Create a signed JWT unsubscribe token for the user (30-day expiry). */
async function makeUnsubToken(email: string): Promise<string> {
    const secret = new TextEncoder().encode(JWT_SECRET);
    return new SignJWT({ email, action: "unsubscribe" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(secret);
}

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        logger.debug("[Cron/EmailDigest] Starting priority digest fan-out…");

        const now      = Date.now();
        const WEEK_MS  = 7  * 24 * 60 * 60 * 1000;
        const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

        // Fetch all users with at least one site, latest 2 audits per site
        const users = await prisma.user.findMany({
            where: {
                email: { not: null },
                sites: { some: {} },
            },
            include: {
                sites: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    include: {
                        audits: {
                            orderBy: { runTimestamp: "desc" },
                            take: 2,
                        },
                        aeoSnapshots: {
                            orderBy: { createdAt: "desc" },
                            take: 2,
                        },
                    },
                },
            },
        });

        let sent    = 0;
        let skipped = 0;

        for (const user of users) {
            if (!user.email) { skipped++; continue; }

            const prefs = (user.preferences as Record<string, unknown>) ?? {};

            // Respect opt-out — default true
            const emailDigest = prefs.emailDigest !== false;
            if (!emailDigest) { skipped++; continue; }

            const site = user.sites[0];
            if (!site) { skipped++; continue; }

            // Frequency gate
            const windowMs   = ["PRO", "AGENCY"].includes(user.subscriptionTier) ? WEEK_MS : MONTH_MS;
            const lastSentAt = Number(prefs.lastDigestSentAt ?? 0);
            if (now - lastSentAt < windowMs) { skipped++; continue; }

            const latestAudit = site.audits[0];
            if (!latestAudit) { skipped++; continue; }

            // Compute aeoChange
            const latestAeoSnap = site.aeoSnapshots[0];
            const prevAeoSnap   = site.aeoSnapshots[1];
            const aeoScore      = latestAeoSnap?.score ?? blendedScore(latestAudit.categoryScores);
            const prevAeoScore  = prevAeoSnap?.score   ?? aeoScore;
            const aeoChange     = aeoScore - prevAeoScore;

            // Pull rank movement data stored by rank-alert-checker
            const rankWins  = Array.isArray(prefs.rankWins)  ? prefs.rankWins  : [];
            const rankDrops = Array.isArray(prefs.rankDrops) ? prefs.rankDrops : [];

            // Count AI citations from this week's AEO snapshots
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const aiCitations = site.aeoSnapshots.filter(
                (s: { createdAt: Date; brandMentioned?: boolean }) =>
                    s.createdAt >= weekAgo && s.brandMentioned === true
            ).length;

            // Extract top 3 issues using the typed recommendation engine
            const topIssues = extractEnrichedRecommendations(latestAudit.issueList, 3, "medium");
            if (topIssues.length === 0 && rankWins.length === 0 && aiCitations === 0) { skipped++; continue; }

            // Build unsubscribe token
            const unsubToken = await makeUnsubToken(user.email);

            // Send
            const { success, error } = await sendPriorityDigest(user.email, {
                userName:   user.name ?? user.email.split("@")[0],
                domain:     site.domain,
                aeoScore,
                aeoChange,
                topIssues,
                rankWins,
                rankDrops,
                aiCitations,
                unsubToken,
                appUrl:     APP_URL,
            });

            if (success) {
                await prisma.$executeRaw`
                    UPDATE "User"
                    SET preferences = jsonb_set(
                        COALESCE(preferences::jsonb, '{}'::jsonb),
                        '{lastDigestSentAt}',
                        to_jsonb(${now}::bigint)
                    )
                    WHERE id = ${user.id}
                `;
                sent++;
                logger.debug(`[Cron/EmailDigest] Sent to ${user.email}`);

            } else {
                logger.warn(`[Cron/EmailDigest] Failed for ${user.email}: ${error}`);
                skipped++;
            }
        }

        logger.debug(`[Cron/EmailDigest] Done. Sent: ${sent}, Skipped: ${skipped}`);
        return NextResponse.json({ success: true, sent, skipped });

    } catch (error: unknown) {
        logger.error("[Cron/EmailDigest] Fatal error:", { error: (error as Error)?.message ?? String(error) });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
