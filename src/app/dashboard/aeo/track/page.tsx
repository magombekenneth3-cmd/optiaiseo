import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AeoTrackerClient } from "./AeoTrackerClient";
import Link from "next/link";
import { Bot } from "lucide-react";

export const metadata = {
    title: "AEO Tracking | OptiAISEO",
    description: "Track your AI Share of Voice across Generative Engines.",
};

export default async function AeoTrackerPage({
    searchParams
}: {
    searchParams: Promise<{ siteId?: string }>
}) {
    const session = await getServerSession(authOptions);
    const resolvedParams = await searchParams;
    let siteId = resolvedParams.siteId || "";
    let userSites: { id: string; domain: string }[] = [];
    let activeDomain = "";

    if (session?.user?.email) {
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (user) {
            userSites = await prisma.site.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                select: { id: true, domain: true },
            });

            const site = siteId
                ? userSites.find(s => s.id === siteId)
                : userSites[0];

            if (site) {
                siteId = site.id;
                activeDomain = site.domain;
            }
        }
    }

    const seedKeywordCount = siteId
        ? await prisma.seedKeyword.count({ where: { siteId } })
        : 0;

    if (!siteId) {
        return (
            <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto pb-12 fade-in-up mt-8">
                <div className="card-surface p-12 text-center border-dashed border-border">
                    <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <h2 className="text-xl font-semibold mb-2 text-foreground">No sites registered yet</h2>
                    <p className="text-muted-foreground text-sm mb-6">
                        Register a site first to start tracking AEO Share of Voice metrics.
                    </p>
                    <Link
                        href="/dashboard/sites/new"
                        className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all inline-block shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                    >
                        Register a site
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <AeoTrackerClient
            siteId={siteId}
            activeDomain={activeDomain}
            userSites={userSites}
            seedKeywordCount={seedKeywordCount}
        />
    );
}
