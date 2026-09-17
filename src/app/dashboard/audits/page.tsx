import { Metadata } from "next";
import { getUserAudits } from "@/app/actions/audit";
import { getUserSites } from "@/app/actions/site";
import { AuditButton } from "./AuditButton";
import { AuditPoller } from "./AuditPoller";
import { AuditTable } from "./AuditTable";
import { AuditSiteSwitcher } from "./AuditSiteSwitcher";
import { extractAuditMetrics } from "@/lib/audit/helpers";
import { Activity, ArrowUpRight, FileSearch, Sparkles } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OAuthConnectButton } from "@/components/auth/OAuthConnectButton";

export const metadata: Metadata = {
  title: "Audit Reports | OptiAISEO",
  description: "View your OptiAISEO technical audit history. Audits run automatically after site setup or on demand from the dashboard.",
};

export const dynamic = "force-dynamic";

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const { siteId } = await searchParams;
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email;
  const [{ audits, nextCursor }, { sites }, dbUser] = await Promise.all([
    getUserAudits(undefined, 20, siteId),
    getUserSites(),
    userEmail ? prisma.user.findUnique({
      where: { email: userEmail },
      select: {
        subscriptionTier: true,
        accounts: { where: { provider: "google-gsc" }, select: { id: true } },
      },
    }) : null,
  ]);
  const userTier       = dbUser?.subscriptionTier ?? "FREE";
  const gscConnected   = (dbUser?.accounts?.length ?? 0) > 0;
  const allAudits = audits ?? [];
  const selectedSite = siteId ? sites?.find((site) => site.id === siteId) : undefined;
  const visibleAudits = selectedSite ? allAudits.filter((audit) => audit.site.id === selectedSite.id) : allAudits;
  const completedAudits = visibleAudits.filter((audit) => audit.fixStatus === "COMPLETED" || audit.fixStatus === "PARTIAL");
  const latestAudit = completedAudits[0];
  const previousAudit = completedAudits[1];
  const latestMetrics = latestAudit
    ? extractAuditMetrics({ categoryScores: latestAudit.categoryScores as Record<string, unknown>, issueList: latestAudit.issueList })
    : null;
  const previousMetrics = previousAudit
    ? extractAuditMetrics({ categoryScores: previousAudit.categoryScores as Record<string, unknown>, issueList: previousAudit.issueList })
    : null;
  const scoreDelta = latestMetrics && previousMetrics ? latestMetrics.seoScore - previousMetrics.seoScore : null;
  const latestScores = (latestAudit?.categoryScores ?? {}) as Record<string, unknown>;
  const categoryScores = Object.entries(latestScores).filter(([, score]) => typeof score === "number").slice(0, 3);
  const inProgress = visibleAudits.filter((audit) => audit.fixStatus === "IN_PROGRESS" || audit.fixStatus === "PENDING");

  const processingAudits = inProgress
    .filter((a) => a.fixStatus === "IN_PROGRESS" || a.fixStatus === "PENDING")
    .map((a) => ({
      id: a.id,
      totalPages: a.totalPages,
      completedPages: a.completedPages,
      failedPages: a.failedPages,
      fixStatus: a.fixStatus,
    }));

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-8">
      <AuditPoller processingAudits={processingAudits} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
            <AuditSiteSwitcher sites={sites ?? []} selectedSiteId={selectedSite?.id} />
            {latestAudit && <span>Last completed {new Date(latestAudit.runTimestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Site health</h1>
          <p className="text-muted-foreground mt-1">See what changed, what matters most, and the next best fix.</p>
        </div>
        <AuditButton siteId={selectedSite?.id} sites={sites} userTier={userTier} />
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]" aria-label="Latest audit health">
        <div className="card-surface overflow-hidden p-5 sm:p-6 relative">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />
          {latestMetrics ? (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-[7px] border-emerald-500/15 bg-emerald-500/5">
                <div className="text-center">
                  <div className="text-3xl font-bold tabular-nums text-foreground">{latestMetrics.seoScore}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">of 100</div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-muted-foreground">SEO health score</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold">{latestMetrics.seoScore >= 80 ? "Healthy foundation" : latestMetrics.seoScore >= 60 ? "Needs attention" : "At risk"}</h2>
                  {scoreDelta !== null && scoreDelta !== 0 && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${scoreDelta > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                      <ArrowUpRight className={`h-3 w-3 ${scoreDelta < 0 ? "rotate-90" : ""}`} /> {scoreDelta > 0 ? "+" : ""}{scoreDelta} since last audit
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{latestMetrics.issueCount === 0 ? "No issues found in the latest completed scan." : `${latestMetrics.issueCount} issue${latestMetrics.issueCount === 1 ? "" : "s"} found in the latest completed scan.`}</p>
              </div>
              <a href={latestAudit ? `/dashboard/audits/${latestAudit.id}` : "#audit-history"} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold transition-colors hover:border-emerald-500/40 hover:text-emerald-400">
                Open report <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-4 py-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted"><FileSearch className="h-5 w-5 text-muted-foreground" /></div>
              <div><h2 className="font-bold">Your first health baseline starts here</h2><p className="mt-1 text-sm text-muted-foreground">Run an audit to identify your highest-impact technical SEO improvements.</p></div>
            </div>
          )}
        </div>

        <div className="card-surface p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Category health</p><p className="mt-0.5 text-xs text-muted-foreground">Latest completed audit</p></div><Activity className="h-4 w-4 text-emerald-400" /></div>
          <div className="mt-5 space-y-4">
            {categoryScores.length > 0 ? categoryScores.map(([name, score]) => {
              const value = score as number;
              return <div key={name}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="capitalize text-muted-foreground">{name.replace(/([A-Z])/g, " $1")}</span><span className="font-bold tabular-nums">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${value >= 80 ? "bg-emerald-400" : value >= 60 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
            }) : <p className="py-5 text-sm text-muted-foreground">Category scores will appear after the first completed audit.</p>}
          </div>
        </div>
      </section>

      {latestMetrics && latestMetrics.issueCount > 0 && latestAudit && (
        <section className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/[0.09] to-transparent p-5 sm:flex sm:items-center sm:gap-5" aria-label="Recommended next action">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10"><Sparkles className="h-5 w-5 text-amber-400" /></div>
          <div className="mt-3 flex-1 sm:mt-0"><p className="text-sm font-bold">Top opportunity: resolve the highest-impact findings</p><p className="mt-1 text-sm text-muted-foreground">Start with the latest report to review prioritised issues and turn approved fixes into implementation work.</p></div>
          <a href={`/dashboard/audits/${latestAudit.id}`} className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 sm:mt-0">Review fixes <ArrowUpRight className="h-4 w-4" /></a>
        </section>
      )}

      {!gscConnected && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 text-sm text-blue-300">
            <span className="font-semibold text-blue-200">Connect Google Search Console</span> to unlock keyword-level audit insights — CTR drops, position changes, and exact queries losing traffic.
          </div>
          <OAuthConnectButton
            provider="google-gsc"
            callbackUrl="/dashboard/audits"
            className="shrink-0 text-xs font-semibold text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg hover:bg-blue-500/10 transition-colors whitespace-nowrap"
          >
            Connect GSC
          </OAuthConnectButton>
        </div>
      )}

      <div id="audit-history" className="scroll-mt-6">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-bold">Audit history</h2><p className="text-sm text-muted-foreground">Compare completed scans and investigate regressions.</p></div>{inProgress.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" /> {inProgress.length} running</span>}</div>
      <AuditTable
        initialAudits={visibleAudits as Parameters<typeof AuditTable>[0]["initialAudits"]}
        initialCursor={nextCursor ?? null}
        siteId={selectedSite?.id}
      />
      </div>
    </div>
  );
}
