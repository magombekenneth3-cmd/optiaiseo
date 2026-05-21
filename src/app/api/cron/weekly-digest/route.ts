export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sendPriorityDigest } from "@/lib/email";

/**
 * GET /api/cron/weekly-digest
 *
 * Weekly cron: compile SEO checker errors, GSO grade changes, and
 * competitor velocity alerts into a digest email sent via Resend.
 *
 * Schedule: 0 8 * * 1  (08:00 UTC every Monday)
 */
export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        // Fetch all paid users with active sites
        const users = await prisma.user.findMany({
            where: {
                subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] },
                email: { not: null },
            },
            select: {
                id: true,
                email: true,
                name: true,
                preferences: true,
                sites: {
                    take: 1,
                    orderBy: { updatedAt: "desc" },
                    select: {
                        id: true,
                        domain: true,
                        audits: {
                            orderBy: { runTimestamp: "desc" },
                            take: 2,
                            select: { overallScore: true, runTimestamp: true },
                        },
                        aeoSnapshots: {
                            orderBy: { createdAt: "desc" },
                            take: 2,
                            select: { aeoScore: true, createdAt: true },
                        },
                        competitorAlerts: {
                            where: { createdAt: { gte: oneWeekAgo } },
                            take: 3,
                            select: { competitor: true, gainedCount: true, message: true },
                        },
                        rankSnapshots: {
                            where: { recordedAt: { gte: oneWeekAgo } },
                            orderBy: { recordedAt: "desc" },
                            take: 50,
                            select: { keyword: true, position: true, recordedAt: true },
                        },
                    },
                },
            },
        });

        let sent = 0;
        let skipped = 0;

        for (const user of users) {
            try {
                // Check opt-out preference
                const prefs = user.preferences as Record<string, unknown> | null;
                if (prefs?.weeklyDigestOptOut === true) { skipped++; continue; }
                if (!user.email) { skipped++; continue; }

                const site = user.sites[0];
                if (!site) { skipped++; continue; }

                const domain = site.domain;

                // AEO score delta
                const [latestAeo, prevAeo] = site.aeoSnapshots;
                const aeoScore = latestAeo?.aeoScore ?? 0;
                const aeoChange = latestAeo && prevAeo
                    ? Math.round(latestAeo.aeoScore - prevAeo.aeoScore)
                    : 0;

                // Rank movements: compare first half vs second half of snapshots
                const snapshots = site.rankSnapshots;
                const kwMap = new Map<string, number[]>();
                for (const snap of snapshots) {
                    if (!kwMap.has(snap.keyword)) kwMap.set(snap.keyword, []);
                    kwMap.get(snap.keyword)!.push(snap.position);
                }
                const rankWins: { keyword: string; from: number; to: number }[] = [];
                const rankDrops: { keyword: string; from: number; to: number }[] = [];
                for (const [kw, positions] of kwMap) {
                    if (positions.length < 2) continue;
                    const from = positions[positions.length - 1]; // oldest
                    const to = positions[0];                       // newest
                    const delta = from - to;                       // positive = improved
                    if (delta >= 3) rankWins.push({ keyword: kw, from, to });
                    else if (delta <= -3) rankDrops.push({ keyword: kw, from, to });
                }
                rankWins.sort((a, b) => (b.from - b.to) - (a.from - a.to));
                rankDrops.sort((a, b) => (a.from - a.to) - (b.from - b.to));

                // Top issues from latest audit
                const topIssues = site.audits.length > 0
                    ? [] // issueList is not selected here; send a placeholder
                    : [];

                // Competitor velocity alerts → enrich topIssues
                const competitorIssues = site.competitorAlerts.map(a => ({
                    title: `Competitor surge: ${a.competitor}`,
                    priorityScore: 85,
                    difficulty: "Medium effort" as const,
                    action: a.message,
                }));

                if (rankWins.length === 0 && rankDrops.length === 0 && competitorIssues.length === 0 && aeoChange === 0) {
                    skipped++;
                    continue;
                }

                const appUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
                await sendPriorityDigest(user.email, {
                    userName: user.name ?? user.email.split("@")[0],
                    domain,
                    aeoScore,
                    aeoChange,
                    topIssues: competitorIssues,
                    rankWins: rankWins.slice(0, 5),
                    rankDrops: rankDrops.slice(0, 3),
                    aiCitations: 0,
                    unsubToken: user.id,
                    appUrl,
                });
                sent++;
            } catch (err) {
                logger.warn("[Cron/WeeklyDigest] Failed to send for user", {
                    userId: user.id,
                    error: (err as Error)?.message,
                });
                skipped++;
            }
        }

        logger.info("[Cron/WeeklyDigest] Done", { sent, skipped, total: users.length });
        return NextResponse.json({ success: true, sent, skipped, total: users.length });
    } catch (error: unknown) {
        logger.error("[Cron/WeeklyDigest] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
