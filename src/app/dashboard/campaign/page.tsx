import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CampaignsDashboard } from "./CampaignsDashboard";
import type { CampaignKeyword, CampaignRow } from "@/app/actions/campaigns";
import type { Campaign } from "@prisma/client";

export const metadata: Metadata = {
    title: "Page-2 Campaigns | OptiAISEO",
    description: "AI-generated fix plans for every keyword stuck on page 2.",
};

export const dynamic = "force-dynamic";

interface PageProps {
    searchParams: Promise<{ siteId?: string }>;
}

export default async function CampaignsPage({ searchParams }: PageProps) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) redirect("/login");

    const { siteId: qSiteId } = await searchParams;

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: {
            id: true,
            subscriptionTier: true,
            sites: {
                orderBy: { createdAt: "desc" },
                select: { id: true, domain: true },
            },
        },
    });

    if (!user) redirect("/login");

    const sites = user.sites;
    const activeSiteId = qSiteId ?? sites[0]?.id ?? null;

    const rawCampaigns = activeSiteId
        ? await prisma.campaign.findMany({
            where: { siteId: activeSiteId },
            orderBy: { createdAt: "desc" },
            take: 50,
        })
        : [];

    const campaigns: CampaignRow[] = rawCampaigns.map((c: Campaign) => ({
        id: c.id,
        siteId: c.siteId,
        userId: c.userId,
        type: c.type,
        name: c.name,
        keyword: c.keyword,
        clientUrl: c.clientUrl,
        initialPosition: c.initialPosition,
        targetPosition: c.targetPosition,
        status: c.status,
        keywordCount: c.keywordCount,
        urlCount: c.urlCount,
        keywords: (c.keywords as CampaignKeyword[] | null) ?? null,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
    }));

    return (
        <CampaignsDashboard
            sites={sites}
            activeSiteId={activeSiteId}
            campaigns={campaigns}
            userTier={user.subscriptionTier ?? "FREE"}
        />
    );
}