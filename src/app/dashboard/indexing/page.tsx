/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { IndexingDashboard } from "./IndexingDashboard";
import { IndexingUpgradeGate } from "./IndexingUpgradeGate";
import { getEffectiveTier } from "@/lib/stripe/guards";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Auto Indexer — OptiAISEO",
    description: "Submit URLs to Google Indexing API and track submission history.",
};

export default async function IndexingPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
            id: true,
            subscriptionTier: true,
            trialEndsAt: true,
            sites: { select: { id: true, domain: true } }
        },
    });
    if (!user) redirect("/login");

    // Resolve effective tier (handles trial window)
    const tier = await getEffectiveTier(user.id);
    const isPaid = ['PRO', 'AGENCY'].includes(tier);

    // FREE users see upgrade gate, not the dashboard
    if (!isPaid) return <IndexingUpgradeGate />;

    const siteIds = user.sites.map((s: { id: string }) => s.id);

    // Get today's usage
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const todayCount = siteIds.length > 0
        ? await prisma.indexingLog.count({
            where: {
                siteId: { in: siteIds },
                createdAt: { gte: startOfDay },
                status: { in: ["SUCCESS", "PENDING"] },
            },
        })
        : 0;

    // Get last 50 log entries across all sites
    const logs = siteIds.length > 0
        ? await prisma.indexingLog.findMany({
            where: { siteId: { in: siteIds } },
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { site: { select: { domain: true } } },
        })
        : [];

    return (
        <IndexingDashboard
            sites={user.sites}

            logs={logs as any}
            todayCount={todayCount}
            dailyQuota={200}
        />
    );
}
