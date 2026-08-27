import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Wrench } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-Healing Log | OptiAISEO",
  description: "Full audit trail of automated SEO fixes applied by the self-healing engine.",
};

export const dynamic = "force-dynamic";

export default async function HealingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const resolvedParams = await searchParams;
  let siteId = resolvedParams.siteId;

  if (!siteId && session?.user?.email) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (user) {
      const firstSite = await prisma.site.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      siteId = firstSite?.id;
    }
  }

  if (siteId) {
    redirect(`/dashboard/sites/${siteId}/healing-log`);
  }

  // No site exists — show empty state instead of confusing redirect
  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto pb-12 fade-in-up mt-8">
      <div className="card-surface p-12 text-center border-dashed border-border">
        <Wrench className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-xl font-semibold mb-2 text-foreground">
          No sites registered yet
        </h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
          The self-healing engine monitors your sites for SEO issues — broken links,
          missing meta tags, schema errors — and automatically applies fixes.
          Register a site to get started.
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

