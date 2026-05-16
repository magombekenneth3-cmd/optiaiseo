import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import { ContentDecayClient } from "./ContentDecayClient";

export const metadata: Metadata = {
  title: "Content Decay | OptiAISEO",
  description:
    "Identify pages losing traffic compared to the previous period and use AI to refresh them.",
};

export const dynamic = "force-dynamic";

export default async function ContentDecayPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const resolvedParams = await searchParams;

  let siteId = resolvedParams.siteId ?? "";
  let userTier: "FREE" | "STARTER" | "PRO" | "AGENCY" = "FREE";

  if (session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, subscriptionTier: true },
    });

    if (user) {
      userTier = user.subscriptionTier as "FREE" | "STARTER" | "PRO" | "AGENCY";
      const userSites = await prisma.site.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });

      const site = siteId
        ? userSites.find((s) => s.id === siteId)
        : userSites[0];

      if (site) siteId = site.id;
    }
  }

  if (!siteId) {
    return (
      <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto pb-12 fade-in-up mt-8">
        <div className="card-surface p-12 text-center border-dashed border-border">
          <TrendingDown className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-xl font-semibold mb-2 text-foreground">
            No sites registered yet
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            Register a site first to start identifying decaying content.
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

  return <ContentDecayClient siteId={siteId} userTier={userTier} />;
}
