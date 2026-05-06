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
import prisma from "@/lib/prisma";
import { getBacklinkSummary } from "@/lib/backlinks/index";
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
        select: { id: true },
    });
    if (!user) redirect("/login");

    const { siteId } = await searchParams;
    if (!siteId) redirect("/dashboard");

    const site = await prisma.site.findUnique({
        where:  { id: siteId, userId: user.id },
        select: { id: true, domain: true },
    });
    if (!site) redirect("/dashboard");

    // Pre-fetch summary + stored concurrently so the client gets instant data
    const [summary, stored] = await Promise.all([
        getBacklinkSummary(site.domain, siteId).catch(() => null),
        prisma.backlinkDetail.findMany({
            where:   { siteId },
            orderBy: { domainRating: "desc" },
            take:    200,
            select: {
                id:           true,
                srcDomain:    true,
                anchorText:   true,
                domainRating: true,
                isDoFollow:   true,
                isToxic:      true,
                toxicReason:  true,
                firstSeen:    true,
                lastSeen:     true,
            },
        }).catch(() => []),
    ]);

    // Serialize dates to strings for the client component
    const storedSerialized = stored.map(b => ({
        ...b,
        firstSeen: b.firstSeen.toISOString(),
        lastSeen:  b.lastSeen.toISOString(),
    }));

    return (
        <BacklinksClient
            siteId={siteId}
            domain={site.domain}
            initialSummary={summary}
            initialStored={storedSerialized}
        />
    );
}
