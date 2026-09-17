/**
 * /dashboard/backlinks — Server Component wrapper.
 *
 * Pre-fetches the summary and stored backlinks on the server so the first
 * render is instant (no blank-page flash). The client component handles
 * live refreshes, gap analysis, and all interactive state.
 */
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isConfigured as isDataForSeoConfigured } from "@/lib/backlinks/client";
import { hasFeature } from "@/lib/stripe/plans";
import BacklinksClient from "./BacklinksClient";

export const metadata = {
    title: "Backlinks — Dashboard",
    description: "Monitor your backlink profile, detect toxic links, and find competitor link gaps.",
};

export default async function BacklinksPage({
    searchParams,
}: {
    searchParams: Promise<{ siteId?: string }>;
}) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email! },
        select: { id: true, subscriptionTier: true },
    });
    if (!user) redirect("/login");

    const { siteId } = await searchParams;
    if (!siteId) redirect("/dashboard");

    const site = await prisma.site.findUnique({
        where:  { id: siteId, userId: user.id },
        select: { id: true, domain: true },
    });
    if (!site) redirect("/dashboard");

    const dataForSeoConfigured = isDataForSeoConfigured();

    // Never make a paid DataForSEO request during server rendering. The
    // authenticated API route performs plan/rate checks before the client asks
    // for a live summary. Historical rows are withheld from non-Pro users too.
    const canUseBacklinks = hasFeature(user.subscriptionTier, "backlinks");
    const stored = canUseBacklinks
        ? await prisma.backlinkDetail.findMany({
            where:   { siteId },
            orderBy: { domainRating: "desc" },
            take:    200,
            select: {
                id:           true,
                linkKey:      true,
                srcDomain:    true,
                sourceUrl:    true,
                targetUrl:    true,
                anchorText:   true,
                domainRating: true,
                isDoFollow:   true,
                isToxic:      true,
                toxicReason:  true,
                spamScore:    true,
                status:       true,
                firstSeen:    true,
                lastSeen:     true,
            },
        }).catch(() => [])
        : [];

    const storedSerialized = stored.map((b: {
        id: string;
        linkKey: string;
        srcDomain: string;
        sourceUrl: string;
        targetUrl: string | null;
        anchorText: string;
        domainRating: number | null;
        isDoFollow: boolean;
        isToxic: boolean;
        toxicReason: string | null;
        spamScore: number | null;
        status: string;
        firstSeen: Date;
        lastSeen: Date;
    }) => ({
        ...b,
        status: b.status as "active" | "lost" | "broken",
        firstSeen: b.firstSeen.toISOString(),
        lastSeen:  b.lastSeen.toISOString(),
    }));

    return (
        <BacklinksClient
            siteId={siteId}
            domain={site.domain}
            initialSummary={null}
            initialStored={storedSerialized}
            dataForSeoConfigured={dataForSeoConfigured}
        />
    );
}
