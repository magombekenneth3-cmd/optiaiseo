import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  TrendingUp,
  GitBranch,
  FileText,
  ArrowRight,
  AlertCircle,
  MonitorSmartphone,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { extractAuditMetrics } from "@/lib/audit/helpers";
import { getCachedDashboardMetricsForUser } from "@/lib/cache/dashboard";
import { OnboardingInline } from "@/components/dashboard/OnboardingInline";
import { OnboardingProgress } from "@/components/dashboard/OnboardingProgress";
import { MetricTrendChart } from "@/components/dashboard/MetricTrendChart";
import { DashboardStateCard } from "@/components/dashboard/DashboardStateCard";
import { getMetricTrend } from "@/lib/metrics/metric-snapshot";
import type { DashboardState } from "@/components/dashboard/DashboardStateCard";
import { getSiteBenchmarkContext } from "@/app/actions/benchmarks";
import { BenchmarkSummaryCard } from "@/components/dashboard/BenchmarkPanel";
import { getSiteLeaderboardPosition, NICHE_META } from "@/lib/leaderboard";
import { UptimeCard, type UptimeCardData } from "@/components/dashboard/UptimeCard";
import { QuickWinCard, QuickWinAllClear } from "@/components/dashboard/QuickWinCard";
import { ScoreDropAlert } from "@/components/dashboard/ScoreDropAlert";
import { NextBestActionCard } from "@/components/dashboard/NextBestActionCard";
import { CreditValueSummary } from "@/components/dashboard/CreditValueSummary";
import { ValueCreatedBanner } from "@/components/dashboard/ValueCreatedBanner";
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

  // Free-tier audit usage (limit = 5/month)
  const FREE_AUDIT_LIMIT = 5;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const auditsThisMonth = audits.filter(a => new Date(a.runTimestamp) >= startOfMonth).length;

  // Evaluated top-to-bottom; the first matching branch wins. Every combination
  // of (sites, audits, score) is covered explicitly — no catch-all fallback
  // that could incorrectly show "connect your first domain" to existing users.
  const dashState: DashboardState = (() => {
    if (siteIds.length === 0) return "no_site";            // no sites yet
    if (audits.length === 0) return "no_audit";            // site exists, no audits yet
    if (latestScore !== null && latestScore >= 90 && pendingPrsCount === 0)
      return "all_done";                                    // perfect score, nothing pending
    return "audit_complete";                               // has site + audits (± pending PRs)
  })();

  const primarySiteId = user.sites[0]?.id ?? null;
  const metricTrend = primarySiteId
    ? await getMetricTrend(primarySiteId, 6).catch(() => [])
    : [];
  const benchmarkContext = primarySiteId
    ? await getSiteBenchmarkContext(primarySiteId).catch(() => null)
    : null;
  const leaderboardPosition = primarySiteId
    ? await getSiteLeaderboardPosition(primarySiteId).catch(() => null)
    : null;

  let uptimeCardData: UptimeCardData | null = null;
  if (primarySiteId) {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const uptimeAlerts = await prisma.uptimeAlert.findMany({
        where: { siteId: primarySiteId, createdAt: { gte: since7d } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, resolvedAt: true, durationMs: true },
      });

      // Build a 7-bucket daily map (today = index 6)
      const weekHistory: boolean[] = Array(7).fill(true);
      const now = Date.now();
      for (const alert of uptimeAlerts) {
        const daysAgo = Math.floor((now - new Date(alert.createdAt).getTime()) / 86400000);
        const idx = 6 - Math.min(daysAgo, 6);
        weekHistory[idx] = false;
      }

      const totalChecks = Math.max(1, Math.round(7 * 24 * 60 / 5)); // 5-min intervals
      const downtimeEvents = uptimeAlerts.length;
      const uptimePct = Math.max(0, Math.min(100, ((totalChecks - downtimeEvents) / totalChecks) * 100));

      const currentlyDown = uptimeAlerts.some(
        (a) => !a.resolvedAt && (now - new Date(a.createdAt).getTime()) < 10 * 60 * 1000
      );

      const lastDown = uptimeAlerts.at(-1);

      uptimeCardData = {
        uptimePct: parseFloat(uptimePct.toFixed(1)),
        avgResponseMs: null, // stored in durationMs on the check, not the alert
        isDown: currentlyDown,
        lastDownAt: lastDown ? new Date(lastDown.createdAt).toISOString() : null,
        weekHistory,
      };
    } catch {
      // Non-critical — silently skip
    }
  }

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

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* ── Top Fold: Health → Change → Next Action ───────────────────── */}
      <DashboardHeroHeader
        domain={primarySiteDomain ?? user.sites[0]?.domain ?? ""}
        lastAuditDate={audits[0] ? new Date(audits[0].runTimestamp).toLocaleDateString() : null}
        seoScore={latestScore ?? 0}
        aeoScore={aeoScore}
        clicksDeltaPct={organicTrafficDelta !== null ? Math.round(organicTrafficDelta) : null}
        rankDelta={rankWin ? rankWin.delta : null}
        pendingPrsCount={pendingPrsCount}
        siteId={primarySiteId}
        statusHeadline={statusHeadline}
      />

      {/* ── Value Created Banner (ROI proof) ──────────────────────────── */}
      {!isNewUser && (
        <ValueCreatedBanner
          clicksGained={clicksGained}
          prsCreatedThisMonth={prsCreatedThisMonth}
          aiCitationsThisMonth={aiCitationsThisMonth}
          organicTrafficDelta={organicTrafficDelta}
        />
      )}

      {/* ── Onboarding Progress Card ─────────────────────────────────────── */}
      {!onboardingDone && (
        <OnboardingProgress steps={onboardingSteps} />
      )}

      {/* ── Next Best Action (post-onboarding) ───────────────────────────── */}
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



      {/* ── Win celebration (client — shows once per win) ─────────────────── */}
      {rankWin && (
        <WinCelebrationToast
          keyword={rankWin.keyword}
          delta={rankWin.delta}
          newPosition={rankWin.newPosition}
          winId={rankWin.winId}
        />
      )}
      {/* ── 4.2: Priority-Driven State Card ──────────────────────────────── */}
      {(dashState === "no_site" || dashState === "no_audit" || dashState === "all_done") && (
        <DashboardStateCard
          state={dashState}
          domain={user.sites[0] ? (user.sites[0] as unknown as { domain?: string }).domain : undefined}
          siteId={primarySiteId ?? undefined}
          overallScore={latestScore ?? undefined}
          topIssue={topIssueLabel ?? undefined}
        />
      )}
      {/* Inline onboarding wizard — only shown to new users with no sites */}
      {isNewUser && <OnboardingInline />}


      {/* ── Quick Win Card ─────────────────────────────────────────── */}
      {!isNewUser && hasAudits && topAudit && (
        topIssueLabel
          ? <QuickWinCard
              issueLabel={topIssueLabel}
              auditId={topAudit.id}
              score={latestScore ?? 50}
            />
          : <QuickWinAllClear />
      )}

      {/* ── Re-audit nudge (client — session-dismissable) ────────────────── */}
      {!isNewUser && daysSinceAudit !== null && daysSinceAudit > 7 && primarySiteId && primarySiteDomain && (
        <ReAuditNudge
          daysSince={daysSinceAudit}
          siteId={primarySiteId}
          siteUrl={`https://${primarySiteDomain}`}
        />
      )}

      {/* ── Score Drop Alert ───────────────────────────────────────────── */}
      {!isNewUser && scoreDelta !== null && scoreDelta <= -8 && (
        <ScoreDropAlert
          delta={Math.abs(scoreDelta)}
          topIssue={topIssueLabel}
          auditId={topAudit?.id ?? null}
        />
      )}

      {/* ── Metric Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 fade-in-up fade-in-up-2">
        {/* SEO Score */}
        <MetricCard
          label="Avg SEO Score"
          value={auditsWithSeo > 0 ? avgSeoScore : null}
          unit="/100"
          description={auditsWithSeo > 0 ? `${auditsWithSeo} audit${auditsWithSeo !== 1 ? 's' : ''} analysed` : undefined}
          delta={scoreDelta}
          deltaLabel="vs last"
          progress={auditsWithSeo > 0 ? avgSeoScore : null}
          icon={TrendingUp}
          iconColor="text-emerald-400"
          emptyLabel="Run your first audit"
          emptyHref="/dashboard/audits"
        />

        {/* AEO Visibility */}
        <MetricCard
          label="AEO Visibility"
          value={aeoScore > 0 ? aeoScore : null}
          unit="/100"
          description="AI search presence"
          progress={aeoScore > 0 ? aeoScore : null}
          icon={MonitorSmartphone}
          iconColor="text-purple-400"
          emptyLabel="Check if ChatGPT recommends you"
          emptyHref={hasSites ? "/dashboard/aeo" : undefined}
          footer={
            aeoScore > 0 ? (
              <Link href="/dashboard/aeo" className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1">
                View full report <ArrowRight className="w-3 h-3" />
              </Link>
            ) : null
          }
        />

        {/* Pending Fixes */}
        <MetricCard
          label="Pending Fixes"
          value={pendingPrsCount}
          description={
            pendingPrsCount === 0
              ? "No pending automated fixes"
              : `${pendingPrsCount} fix${pendingPrsCount !== 1 ? 'es' : ''} awaiting review`
          }
          icon={GitBranch}
          iconColor="text-blue-400"
          footer={
            pendingPrsCount > 0 ? (
              <Link href="/dashboard/audits" className="text-xs font-semibold text-blue-400 hover:underline inline-flex items-center gap-1">
                Review fixes <ArrowRight className="w-3 h-3" />
              </Link>
            ) : null
          }
        />

        {/* AI Content this week */}
        <MetricCard
          label="Posts This Week"
          value={blogsThisWeek}
          description="AI-generated blog posts"
          icon={FileText}
          iconColor="text-violet-400"
          footer={
            <Link href="/dashboard/blogs" className="text-xs font-semibold text-violet-400 hover:underline inline-flex items-center gap-1">
              {blogsThisWeek === 0 ? "Generate content" : "View all posts"} <ArrowRight className="w-3 h-3" />
            </Link>
          }
        />

        {/* Leaderboard rank — conditional */}
        {leaderboardPosition && (
          <MetricCard
            label={`${NICHE_META[leaderboardPosition.niche].label} Ranking`}
            value={`#${leaderboardPosition.rank}`}
            description={`of ${leaderboardPosition.totalSites} sites`}
            icon={TrendingUp}
            iconColor="text-amber-400"
            footer={
              <Link href={`/leaderboard/${leaderboardPosition.niche}`} className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1">
                View leaderboard <ArrowRight className="w-3 h-3" />
              </Link>
            }
          />
        )}

        {/* Uptime */}
        {uptimeCardData && (
          <div className="metric-card overflow-hidden group">
            <UptimeCard data={uptimeCardData} />
          </div>
        )}

        {/* Benchmark */}
        {benchmarkContext && (
          <div className="metric-card overflow-hidden group sm:col-span-2">
            <BenchmarkSummaryCard context={benchmarkContext} />
          </div>
        )}
      </div>

      {/* ── Free-tier usage bar ────────────────────────────────────── */}
      {hasSites && auditsThisMonth >= Math.ceil(FREE_AUDIT_LIMIT * 0.8) && (
        <div className="fade-in-up">
          <Link
            href="/dashboard/billing"
            className="block w-full p-4 rounded-xl border border-border bg-card hover:border-emerald-500/30 transition-all group"
          >
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Audits this month
              </span>
              <span className={`text-xs font-bold ${auditsThisMonth >= FREE_AUDIT_LIMIT ? "text-rose-400" : "text-amber-400"}`}>
                {auditsThisMonth}/{FREE_AUDIT_LIMIT}
                {auditsThisMonth < FREE_AUDIT_LIMIT
                  ? ` — ${FREE_AUDIT_LIMIT - auditsThisMonth} remaining`
                  : " — limit reached"}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-muted/40">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${auditsThisMonth >= FREE_AUDIT_LIMIT ? "bg-rose-500" : "bg-amber-500"
                  }`}
                style={{ width: `${Math.min((auditsThisMonth / FREE_AUDIT_LIMIT) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 group-hover:text-emerald-400 transition-colors">
              Upgrade to Pro for unlimited audits →
            </p>
          </Link>
        </div>
      )}



      {/* ── Pending Approvals + Credits ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in-up fade-in-up-3">

        {/* Pending Approvals */}
        <div className="card-surface p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-semibold">Pending Approvals</h3>
            {pendingBlogs.length > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {pendingBlogs.length}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3 flex-1">
            {pendingBlogs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-6">
                <div className="w-10 h-10 rounded-xl bg-muted/40 border border-border flex items-center justify-center">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No content generated yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Generate your first article to start tracking performance.
                  </p>
                </div>
                <Link
                  href="/dashboard/blogs"
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                >
                  Generate content <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              <>
                {pendingBlogs.map((blog) => (
                  <div
                    key={blog.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/20 hover:bg-accent transition-colors group"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span
                        className="text-sm font-medium truncate text-foreground"
                        title={blog.title}
                      >
                        {blog.title}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {blog.pipelineType === "INDUSTRY"
                          ? "Evergreen"
                          : blog.pipelineType}
                      </span>
                    </div>
                    <Link
                      href={`/dashboard/blogs?review=${blog.id}`}
                      className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/20 transition-colors"
                    >
                      Review
                    </Link>
                  </div>
                ))}
                <Link
                  href="/dashboard/blogs"
                  className="mt-auto text-center text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 pt-2 transition-colors"
                >
                  View all content <ArrowRight className="w-3 h-3" />
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Credit Value Summary */}
        {!isNewUser && (
          <CreditValueSummary
            auditsThisMonth={auditCreditsUsed}
            blogsThisMonth={blogCreditsUsed}
            aeoChecksThisMonth={aeoCreditsUsed}
            keywordsTracked={hasTrackedKeywords ? 1 : 0}
            prsThisMonth={prsCreatedThisMonth}
            creditsUsed={creditsUsedThisMonth}
            creditsBalance={user.credits}
            creditLimit={160}
          />
        )}
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────── */}
      <div className="fade-in-up fade-in-up-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              icon: AlertCircle,
              label: "Run audit",
              sub: "Scan for issues",
              href: "/dashboard/audits",
              color: "text-emerald-400",
              bg: "bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/12 hover:border-emerald-500/30",
            },
            {
              icon: FileText,
              label: "Create content",
              sub: "AI-powered blog",
              href: "/dashboard/blogs",
              color: "text-purple-400",
              bg: "bg-violet-500/8 border-violet-500/20 hover:bg-violet-500/12 hover:border-violet-500/30",
            },
            {
              icon: TrendingUp,
              label: "Research keywords",
              sub: "Track rankings",
              href: "/dashboard/keywords",
              color: "text-blue-400",
              bg: "bg-blue-500/8 border-blue-500/20 hover:bg-blue-500/12 hover:border-blue-500/30",
            },
            {
              icon: GitBranch,
              label: "Add a domain",
              sub: "New site",
              href: "/dashboard/sites/new",
              color: "text-amber-400",
              bg: "bg-amber-500/8 border-amber-500/20 hover:bg-amber-500/12 hover:border-amber-500/30",
            },
          ].map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex flex-col gap-2 p-4 card-surface rounded-xl border ${action.bg} transition-all duration-200 group hover:-translate-y-0.5`}
            >
              <action.icon className={`w-5 h-5 ${action.color}`} />
              <div>
                <p className="text-sm font-semibold text-foreground truncate">
                  {action.label}
                </p>
                <p className="text-xs text-muted-foreground truncate">{action.sub}</p>
              </div>
            </Link>
          ))}
        </div>

      </div>

      {/* ── 2.1: 6-Month Metric Trend Chart ─────────────────────────────── */}
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
          className="fade-in-up"
        />
      )}
    </div>
  );
}