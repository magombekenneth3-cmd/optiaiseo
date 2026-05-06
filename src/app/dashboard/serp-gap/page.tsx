import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { SerpGapDashboard } from "./SerpGapDashboard";

export const metadata: Metadata = {
    title: "SERP Gap Analysis | OptiAISEO",
    description: "Identify content gaps vs. top-ranking competitors and get a 4-week implementation plan to break into page 1.",
};

export default async function SerpGapPage({
    searchParams,
}: {
    searchParams: Promise<{ siteId?: string }>;
}) {
    const session = await getServerSession(authOptions);
    const resolved = await searchParams;

    let userSites: { id: string; domain: string }[] = [];
    let activeSiteId = resolved.siteId ?? "";
    let userTier = "FREE";
    let userCredits = 0;
    let analyses: {
        id: string;
        keyword: string;
        clientUrl: string;
        clientPosition: number;
        status: string;
        serpFormat: string | null;
        gapCount: number | null;
        criticalGapCount: number | null;
        estimatedPositionGain: string | null;
        topPriority: string | null;
        taskCount: number | null;
        automatedTaskCount: number | null;
        createdAt: Date;
        completedAt: Date | null;
    }[] = [];

    if (session?.user?.id) {
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { subscriptionTier: true, credits: true },
        });
        userTier = user?.subscriptionTier ?? "FREE";
        userCredits = user?.credits ?? 0;

        userSites = await prisma.site.findMany({
            where: { userId: session.user.id },
            select: { id: true, domain: true },
            orderBy: { createdAt: "desc" },
        });

        if (!activeSiteId && userSites[0]) activeSiteId = userSites[0].id;

        if (activeSiteId) {
            analyses = await prisma.serpGapAnalysis.findMany({
                where: { siteId: activeSiteId },
                orderBy: { createdAt: "desc" },
                take: 20,
                select: {
                    id: true,
                    keyword: true,
                    clientUrl: true,
                    clientPosition: true,
                    status: true,
                    serpFormat: true,
                    gapCount: true,
                    criticalGapCount: true,
                    estimatedPositionGain: true,
                    topPriority: true,
                    taskCount: true,
                    automatedTaskCount: true,
                    createdAt: true,
                    completedAt: true,
                },
            });
        }
    }

    const activeSite = userSites.find((s) => s.id === activeSiteId) ?? null;

    return (
        <SerpGapDashboard
            sites={userSites}
            activeSiteId={activeSiteId}
            activeSiteDomain={activeSite?.domain ?? ""}
            userTier={userTier}
            userCredits={userCredits}
            initialAnalyses={analyses}
        />
    );
}
