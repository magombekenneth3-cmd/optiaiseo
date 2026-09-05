import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  TrendingUp,
  MonitorSmartphone,
  BarChart2,
  ArrowRight,
  ArrowUpRight,
  Shield,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { extractAuditMetrics } from "@/lib/audit/helpers";
import { getCachedDashboardMetricsForUser } from "@/lib/cache/dashboard";
import { OnboardingInline } from "@/components/dashboard/OnboardingInline";
import { OnboardingProgress } from "@/components/dashboard/OnboardingProgress";
import { MetricTrendChart } from "@/components/dashboard/MetricTrendChart";
import { getMetricTrend } from "@/lib/metrics/metric-snapshot";
import { ScoreDropAlert } from "@/components/dashboard/ScoreDropAlert";
import { NextBestActionCard } from "@/components/dashboard/NextBestActionCard";
import {
  WinCelebrationToast,
  ReAuditNudge,
} from "@/components/dashboard/DashboardClientWidgets";
import { DashboardHeroHeader } from "@/components/dashboard/DashboardHeroHeader";
import { getDashboardUser } from "@/lib/auth/dashboard-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dashboard | OptiAISEO",
  description: "Manage your SEO audits, websites, and content generation.",
};


export default async function DashboardPage() {
  const user = await getDashboardUser();

  const siteIds = user.sites.map((s) => s.id);

  const { audits, blogsThisWeek, pendingPrsCount, pendingBlogs } =
    await getCachedDashboardMetricsForUser(user.id, siteIds);

  const latestAeoReport = await prisma.aeoReport.findFirst({
    where: { siteId: { in: siteIds }, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { score: true }
  });
  const aeoScore = latestAeoReport?.score || 0;

  let totalSeoScore = 0;
  let auditsWithSeo = 0;

  const chartData = audits
    .slice(0, 14)
    .reverse()
    .map((a) => {
      const { seoScore, issueCount } = extractAuditMetrics({
        categoryScores: a.categoryScores as Record<string, unknown> | null,
        issueList: a.issueList,
      });
      if (seoScore > 0) {
        totalSeoScore += seoScore;
        auditsWithSeo++;
      }
      return {
        name: new Date(a.runTimestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        score: seoScore,
        issues: issueCount,
      };
    });

  const avgSeoScore =
    auditsWithSeo > 0 ? Math.round(totalSeoScore / auditsWithSeo) : 0;

  const latestScore = chartData.length > 0 ? chartData[chartData.length - 1].score : null;
  const previousScore = chartData.length > 1 ? chartData[chartData.length - 2].score : null;
  const scoreDelta = (latestScore !== null && previousScore !== null) ? (latestScore - previousScore) : null;

  const isNewUser = siteIds.length === 0;
  const hasSites = siteIds.length > 0;
  const hasAudits = audits.length > 0;

  let statusHeadline = isNewUser && !hasSites
    ? "Welcome to OptiAISEO — let's connect your first site 👋"
    : isNewUser && hasSites
      ? "Site connected — your audit is queued ✓"
      : "All sites healthy";
  if (!isNewUser && pendingPrsCount > 0) {
    statusHeadline = `${pendingPrsCount} issue${pendingPrsCount !== 1 ? 's' : ''} need attention`;
  } else if (scoreDelta !== null && scoreDelta !== 0) {
    statusHeadline = `Your score ${scoreDelta > 0 ? 'improved' : 'dropped'} ${Math.abs(scoreDelta)} points since last audit`;
  } else if (!isNewUser && audits.length > 0) {
    statusHeadline = `All sites healthy — last audit ${new Date(audits[0].runTimestamp).toLocaleDateString()}`;
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const primarySiteId = user.sites[0]?.id ?? null;
  const metricTrend = primarySiteId
    ? await getMetricTrend(primarySiteId, 6).catch(() => [])
    : [];

  type IssueItem = { status: string; label?: string; title?: string };
  type IssueCategory = { items?: IssueItem[] };
  type AuditIssueList = IssueCategory[] | { recommendations?: { priority: string }[] };

  const topAudit = audits[0];
  const topIssueLabel = topAudit
    ? (() => {
      const rawList = topAudit.issueList as AuditIssueList;
      const cats: IssueCategory[] = Array.isArray(rawList) ? rawList : [];
      const fail = cats.flatMap((c) => c.items ?? []).find((i) => i.status === "Fail");
      return fail?.label ?? fail?.title ?? null;
    })()
    : null;

  const onboardingSteps = [
    { id: "site", label: "Connect your domain", href: "/dashboard/sites/new", done: hasSites },
    { id: "audit", label: "Run your first audit", href: "/dashboard/audits", done: hasAudits },
    { id: "aeo", label: "Check your AEO score", href: "/dashboard/aeo", done: aeoScore > 0 },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);

  // 1. Recent rank win — keyword that moved up >=3 positions in last 7 days.
  //    Uses two consecutive RankSnapshots for the same keyword on the primary site.
  let rankWin: { keyword: string; delta: number; newPosition: number; winId: string } | null = null;
  if (primarySiteId) {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSnaps = await prisma.rankSnapshot.findMany({
        where: { siteId: primarySiteId, recordedAt: { gte: since7d } },
        orderBy: { recordedAt: "asc" },
        select: { keyword: true, position: true, recordedAt: true },
      });
      // Group by keyword and find biggest improvement
      const byKw = new Map<string, number[]>();
      for (const s of recentSnaps) {
        const arr = byKw.get(s.keyword) ?? [];
        arr.push(s.position);
        byKw.set(s.keyword, arr);
      }
      let bestDelta = 2; // min 3 position gain
      for (const [kw, positions] of byKw.entries()) {
        if (positions.length < 2) continue;
        const delta = positions[0] - positions[positions.length - 1]; // positive = improved
        if (delta > bestDelta) {
          bestDelta = delta;
          const newPos = positions[positions.length - 1];
          rankWin = {
            keyword: kw,
            delta,
            newPosition: newPos,
            winId: `${primarySiteId}:${kw}:${new Date().toISOString().slice(0, 10)}`,
          };
        }
      }
    } catch { /* non-critical */ }
  }

  // 2. Days since last audit (for re-audit nudge)
  const daysSinceAudit = audits[0]
    ? Math.floor((Date.now() - new Date(audits[0].runTimestamp).getTime()) / 86_400_000)
    : null;

  // 3. Feature state flags for NextBestActionCard + anti-churn nudges
  // gscConnected lives on the User model (not Site)
  const hasGscToken = (user as unknown as { gscConnected?: boolean }).gscConnected ?? false;
  // Fetch domain separately (not in the user include select)
  const primarySiteData = primarySiteId
    ? await prisma.site.findFirst({
        where: { id: primarySiteId },
        select: { domain: true, githubRepoUrl: true },
      }).catch(() => null)
    : null;
  const primarySiteDomain   = primarySiteData?.domain ?? null;
  const primarySiteHasGithub = !!primarySiteData?.githubRepoUrl;

  const [hasTrackedKeywords, hasBlogPosts, hasTeamMember] = await Promise.all([
    primarySiteId
      ? prisma.trackedKeyword.count({ where: { siteId: primarySiteId } }).then((n) => n > 0).catch(() => false)
      : Promise.resolve(false),
    siteIds.length > 0
      ? prisma.blog.count({ where: { siteId: { in: siteIds } } }).then((n) => n > 0).catch(() => false)
      : Promise.resolve(false),
    prisma.teamMember.count({ where: { ownerId: user.id } }).then((n) => n > 0).catch(() => false),
  ]);

  // startOfMonth already defined above (line ~156) — reused here

  const [
    creditHistoryThisMonth,
    aiCitationsThisMonth,
    prsCreatedThisMonth,
    metricSnapshots,
  ] = await Promise.all([
    // Credit usage breakdown by action this month
    prisma.creditHistory.findMany({
      where: { userId: user.id, createdAt: { gte: startOfMonth } },
      select: { action: true, cost: true },
    }).catch(() => [] as { action: string; cost: number }[]),
    // AI citations this month (AeoEvent with eventType CITED)
    primarySiteId
      ? prisma.aeoEvent.count({
          where: { siteId: primarySiteId, eventType: "CITED", createdAt: { gte: startOfMonth } },
        }).catch(() => 0)
      : Promise.resolve(0),
    // GitHub auto-fix PRs this month (selfHealingLog = the fix queue)
    primarySiteId
      ? prisma.selfHealingLog.count({
          where: {
            siteId: primarySiteId,
            createdAt: { gte: startOfMonth },
          },
        }).catch(() => 0)
      : Promise.resolve(0),
    // Organic traffic delta: latest two MetricSnapshots
    primarySiteId
      ? prisma.metricSnapshot.findMany({
          where: { siteId: primarySiteId },
          orderBy: { capturedAt: "desc" },
          take: 2,
          select: { organicTraffic: true },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Derive per-action counts from credit history
  const auditCreditsUsed   = creditHistoryThisMonth.filter((h) => h.action.includes("audit")).length;
  const blogCreditsUsed    = creditHistoryThisMonth.filter((h) => h.action.includes("blog")).length;
  const aeoCreditsUsed     = creditHistoryThisMonth.filter((h) => h.action.includes("aeo")).length;
  const creditsUsedThisMonth = creditHistoryThisMonth.reduce((sum, h) => sum + h.cost, 0);

  // Organic traffic delta (latest - previous snapshot)
  const organicTrafficDelta =
    metricSnapshots.length >= 2 &&
    metricSnapshots[0].organicTraffic !== null &&
    metricSnapshots[1].organicTraffic !== null
      ? metricSnapshots[0].organicTraffic - metricSnapshots[1].organicTraffic
      : null;

  // Estimated clicks gained — use organicTraffic delta as proxy if available
  const clicksGained = organicTrafficDelta !== null && organicTrafficDelta > 0
    ? organicTrafficDelta
    : null;

  // ── Computed values for redesigned layout ──────────────────────────────────
  const organicClicks = metricSnapshots.length > 0 && metricSnapshots[0].organicTraffic !== null
    ? metricSnapshots[0].organicTraffic
    : null;
  const organicClicksDeltaPct = organicClicks !== null && organicTrafficDelta !== null && (organicClicks - organicTrafficDelta) > 0
    ? Math.round((organicTrafficDelta / (organicClicks - organicTrafficDelta)) * 100)
    : null;
  const rankMovement = rankWin ? rankWin.delta : null;
  const latestIssueCount = chartData.length > 0 ? chartData[chartData.length - 1].issues ?? 0 : 0;
  const prevAuditDateStr = audits.length > 1
    ? "vs " + new Date(audits[1].runTimestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "vs last";

  function formatCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  // Derive per-audit rows for the Recent Audits table
  const recentAuditRows = audits.slice(0, 3).map((audit, index) => {
    const { seoScore: auditSeo } = extractAuditMetrics({
      categoryScores: audit.categoryScores as Record<string, unknown> | null,
      issueList: audit.issueList,
    });
    const prevAudit = audits[index + 1];
    const prevMetrics = prevAudit ? extractAuditMetrics({
      categoryScores: prevAudit.categoryScores as Record<string, unknown> | null,
      issueList: prevAudit.issueList,
    }) : null;
    const change = prevMetrics ? auditSeo - prevMetrics.seoScore : null;
    return {
      id: audit.id,
      seoScore: auditSeo,
      change,
      date: new Date(audit.runTimestamp),
    };
  });

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">

      {/* ── 1. HEADER ──────────────────────────────────────────────────── */}
      <DashboardHeroHeader
        domain={primarySiteDomain ?? user.sites[0]?.domain ?? ""}
        lastAuditDate={
          audits[0]
            ? new Date(audits[0].runTimestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
              " · " +
              new Date(audits[0].runTimestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : null
        }
        seoScore={latestScore ?? 0}
        aeoScore={aeoScore}
        clicksDeltaPct={organicClicksDeltaPct}
        rankDelta={rankMovement}
        pendingPrsCount={pendingPrsCount}
        siteId={primarySiteId}
        statusHeadline={statusHeadline}
      />

      {/* ── Onboarding ─────────────────────────────────────────────────── */}
      {!onboardingDone && <OnboardingProgress steps={onboardingSteps} />}
      {isNewUser && <OnboardingInline />}

      {/* ── Score Drop Alert ───────────────────────────────────────────── */}
      {!isNewUser && scoreDelta !== null && scoreDelta <= -8 && (
        <ScoreDropAlert
          delta={Math.abs(scoreDelta)}
          topIssue={topIssueLabel}
          auditId={topAudit?.id ?? null}
        />
      )}

      {/* ── Win celebration toast ──────────────────────────────────────── */}
      {rankWin && (
        <WinCelebrationToast
          keyword={rankWin.keyword}
          delta={rankWin.delta}
          newPosition={rankWin.newPosition}
          winId={rankWin.winId}
        />
      )}

      {/* ── Re-audit nudge ─────────────────────────────────────────────── */}
      {!isNewUser && daysSinceAudit !== null && daysSinceAudit > 7 && primarySiteId && primarySiteDomain && (
        <ReAuditNudge
          daysSince={daysSinceAudit}
          siteId={primarySiteId}
          siteUrl={`https://${primarySiteDomain}`}
        />
      )}

      {/* ── 2. PRIMARY KPI ROW — 4 cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 fade-in-up">
        <MetricCard
          label="SEO Score"
          value={latestScore ?? (auditsWithSeo > 0 ? avgSeoScore : null)}
          unit="/100"
          description={latestScore !== null ? (latestScore >= 80 ? "Good" : latestScore >= 60 ? "Needs work" : "Critical") : undefined}
          delta={scoreDelta}
          deltaLabel={prevAuditDateStr}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          emptyLabel="Run your first audit"
          emptyHref="/dashboard/audits"
        />

        <MetricCard
          label="AEO Visibility"
          value={aeoScore > 0 ? aeoScore : null}
          unit="/100"
          description={aeoScore > 0 ? (aeoScore >= 80 ? "Strong" : aeoScore >= 60 ? "Moderate" : "Low") : undefined}
          icon={MonitorSmartphone}
          iconColor="text-purple-400"
          emptyLabel="Check if ChatGPT recommends you"
          emptyHref={hasSites ? "/dashboard/aeo" : undefined}
        />

        <MetricCard
          label="Organic Clicks"
          value={organicClicks !== null ? formatCompact(organicClicks) : null}
          delta={organicClicksDeltaPct}
          deltaLabel={prevAuditDateStr}
          icon={BarChart2}
          iconColor="text-blue-400"
          emptyLabel="Connect GSC to track clicks"
          emptyHref="/dashboard/settings"
        />

        <MetricCard
          label="Rank Movement"
          value={rankMovement !== null ? `↑${rankMovement}` : null}
          description={rankMovement !== null ? "Positions improved" : undefined}
          deltaLabel={rankMovement !== null ? prevAuditDateStr : undefined}
          icon={TrendingUp}
          iconColor="text-amber-400"
          emptyLabel="Track keywords to see rank changes"
          emptyHref="/dashboard/keywords"
        />
      </div>

      {/* ── 3. SEO PERFORMANCE — Trend chart ───────────────────────────── */}
      {(metricTrend.length > 0 || chartData.length > 0) && (
        <MetricTrendChart
          data={metricTrend.map(m => ({
            capturedAt: m.capturedAt.toISOString(),
            overallScore: m.overallScore,
            aeoScore: m.aeoScore,
            coreWebVitals: m.coreWebVitals,
            schemaScore: m.schemaScore,
            organicTraffic: m.organicTraffic,
          }))}
          auditData={chartData}
          className="fade-in-up fade-in-up-1"
        />
      )}

      {/* ── 4. NEXT BEST ACTION — compact strip ───────────────────────── */}
      {onboardingDone && hasSites && (
        <NextBestActionCard
          hasSite={hasSites}
          hasAudit={hasAudits}
          hasAeo={aeoScore > 0}
          hasKeywords={hasTrackedKeywords}
          hasBlogs={hasBlogPosts}
          hasTeam={hasTeamMember}
          hasGsc={hasGscToken}
          siteId={primarySiteId}
        />
      )}

      {/* ── 5. SECONDARY PANELS — AI Visibility + Technical Health ───── */}
      {!isNewUser && hasAudits && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 fade-in-up fade-in-up-2">

          {/* AI Visibility */}
          <div className="border border-border rounded-[10px] bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-purple-400" aria-hidden="true" />
              <h3 className="text-[13px] font-semibold text-foreground">AI Visibility</h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Main score */}
              <div className="flex flex-col">
                <div className="flex items-baseline gap-1">
                  <span className="text-[28px] font-bold tracking-tight text-foreground tabular-nums leading-none">
                    {aeoScore > 0 ? aeoScore : "—"}
                  </span>
                  {aeoScore > 0 && <span className="text-xs text-muted-foreground">/100</span>}
                </div>
                <span className="text-[11px] text-muted-foreground mt-1">AI search presence</span>
              </div>

              {/* Citations */}
              <div className="flex flex-col border-l border-border pl-4">
                <span className="text-xs text-muted-foreground mb-0.5">Citations</span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {aiCitationsThisMonth > 0 ? aiCitationsThisMonth : "—"}
                </span>
                {aiCitationsThisMonth > 0 && (
                  <span className="text-[10px] text-emerald-400 font-medium">this month</span>
                )}
              </div>

              {/* Impressions */}
              <div className="flex flex-col border-l border-border pl-4">
                <span className="text-xs text-muted-foreground mb-0.5">Impressions</span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {organicClicks !== null ? formatCompact(organicClicks) : "—"}
                </span>
                {organicClicksDeltaPct !== null && organicClicksDeltaPct > 0 && (
                  <span className="text-[10px] text-emerald-400 font-medium">+{organicClicksDeltaPct}%</span>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <Link
                href="/dashboard/aeo"
                className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                View full report <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Technical Health */}
          <div className="border border-border rounded-[10px] bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <h3 className="text-[13px] font-semibold text-foreground">Technical Health</h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Issues found */}
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-0.5">Issues found</span>
                <span className="text-lg font-bold tabular-nums text-foreground">{latestIssueCount}</span>
                {pendingPrsCount > 0 && (
                  <span className="text-[10px] text-amber-400 font-medium">
                    {pendingPrsCount} pending
                  </span>
                )}
              </div>

              {/* Opportunities */}
              <div className="flex flex-col border-l border-border pl-4">
                <span className="text-xs text-muted-foreground mb-0.5">Opportunities</span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {latestIssueCount > 0 ? Math.max(1, Math.floor(latestIssueCount * 0.4)) : 0}
                </span>
              </div>

              {/* Fix success rate */}
              <div className="flex flex-col border-l border-border pl-4">
                <span className="text-xs text-muted-foreground mb-0.5">Fix success rate</span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {prsCreatedThisMonth > 0
                    ? `${Math.min(100, Math.round(((prsCreatedThisMonth) / Math.max(1, prsCreatedThisMonth + pendingPrsCount)) * 100))}%`
                    : "—"}
                </span>
                {prsCreatedThisMonth > 0 && pendingPrsCount === 0 && (
                  <span className="text-[10px] text-emerald-400 font-medium">Excellent</span>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <Link
                href={topAudit ? `/dashboard/audits/${topAudit.id}` : "/dashboard/audits"}
                className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                View audit <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. RECENT AUDITS TABLE ─────────────────────────────────────── */}
      {!isNewUser && recentAuditRows.length > 0 && (
        <div className="border border-border rounded-[10px] bg-card overflow-hidden fade-in-up fade-in-up-3">
          <div className="px-5 py-4 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">Recent Audits</h3>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-t border-border">
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Audit</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">SEO Score</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">AEO Visibility</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="px-5 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {recentAuditRows.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">Technical &amp; Content Audit</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[13px] font-semibold text-foreground tabular-nums">{row.seoScore}</span>
                      <span className="text-xs text-muted-foreground ml-0.5">/100</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[13px] font-semibold text-foreground tabular-nums">{aeoScore > 0 ? aeoScore : "—"}</span>
                      {aeoScore > 0 && <span className="text-xs text-muted-foreground ml-0.5">/100</span>}
                    </td>
                    <td className="px-5 py-3">
                      {row.change !== null ? (
                        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                          row.change > 0 ? "text-emerald-400" : row.change < 0 ? "text-rose-400" : "text-muted-foreground"
                        }`}>
                          {row.change > 0 ? <ArrowUpRight className="w-3 h-3" /> : row.change < 0 ? <ArrowUpRight className="w-3 h-3 rotate-90" /> : null}
                          {row.change > 0 ? "+" : ""}{row.change}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {row.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {" · "}
                      {row.date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/audits/${row.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                        <MoreHorizontal className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-border">
            <Link
              href="/dashboard/audits"
              className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              View all audits <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}