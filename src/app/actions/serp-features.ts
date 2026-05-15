"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface AiOverviewStats {
    totalTracked: number;
    withAiOverview: number;
    brandInAio: number;
    withSnippet: number;
    withPaa: number;
    aioRate: number;
    brandAioRate: number;
    keywords: {
        keyword: string;
        hasAiOverview: boolean;
        brandInAio: boolean;
        hasSnippet: boolean;
        hasPaa: boolean;
        capturedAt: Date;
    }[];
}

export async function getAiOverviewStats(siteId: string): Promise<AiOverviewStats | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return null;

    const features = await prisma.serpFeature.findMany({
        where: { siteId },
        orderBy: { capturedAt: "desc" },
        distinct: ["keyword"],
        take: 50,
        select: {
            keyword: true,
            hasAiOverview: true,
            brandInAio: true,
            hasSnippet: true,
            hasPaa: true,
            capturedAt: true,
        },
    });

    if (features.length === 0) return null;

    const totalTracked = features.length;
    const withAiOverview = features.filter((f) => f.hasAiOverview).length;
    const brandInAio = features.filter((f) => f.brandInAio).length;
    const withSnippet = features.filter((f) => f.hasSnippet).length;
    const withPaa = features.filter((f) => f.hasPaa).length;

    return {
        totalTracked,
        withAiOverview,
        brandInAio,
        withSnippet,
        withPaa,
        aioRate: totalTracked > 0 ? Math.round((withAiOverview / totalTracked) * 100) : 0,
        brandAioRate: withAiOverview > 0 ? Math.round((brandInAio / withAiOverview) * 100) : 0,
        keywords: features,
    };
}
