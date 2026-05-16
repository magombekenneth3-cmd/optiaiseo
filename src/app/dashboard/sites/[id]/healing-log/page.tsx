import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import { HealingLogClient } from "./HealingLogClient";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id }, select: { domain: true } });
  return { title: site ? `Healing Log — ${site.domain}` : "Healing Log" };
}

export default async function HealingLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin");

  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, domain: true },
  });

  if (!site) notFound();

  const logs = await prisma.selfHealingLog.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const serialised = logs.map((l) => ({
    id: l.id,
    issueType: l.issueType,
    description: l.description,
    actionTaken: l.actionTaken,
    impactScore: l.impactScore,
    status: l.status,
    metadata: l.metadata as Record<string, unknown> | null,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 fade-in-up">
      <Link
        href={`/dashboard/sites/${site.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {site.domain}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5 mb-1">
          <Zap className="w-6 h-6 text-emerald-400" />
          Self-Healing Log
        </h1>
        <p className="text-sm text-muted-foreground">
          Every automated fix applied to <span className="font-medium text-foreground">{site.domain}</span> — with before/after impact scoring.
        </p>
      </div>

      <HealingLogClient logs={serialised} siteId={site.id} domain={site.domain} />
    </div>
  );
}
