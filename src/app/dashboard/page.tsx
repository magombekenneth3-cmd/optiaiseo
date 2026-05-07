import { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TrendingUp,
  GitBranch,
  FileText,
  ArrowRight,
  Zap,
  AlertCircle,
  Sparkles,
  Mic,
  Search,
  Target,
  Info,
  MonitorSmartphone,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { AuditChart } from "@/components/dashboard/AuditChart";
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

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dashboard | OptiAISEO",
  description: "Manage your SEO audits, websites, and content generation.",
};


export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { sites: { select: { id: true, githubRepoUrl: true } } },
  });
  if (!user) redirect("/login");

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

  // ── 4.2: Determine dashboard state ──────────────────────────────────────────
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

  // ── 2.1: Fetch 6-month metric trend ─────────────────────────────────────────
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

  // ── Uptime (last 7 days) ────────────────────────────────────────────────────
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

  // ── Onboarding progress steps ──────────────────────────────────────────────
  const onboardingSteps = [
    { id: "site", label: "Connect your domain", href: "/dashboard/sites/new", done: hasSites },
    { id: "audit", label: "Run your first audit", href: "/dashboard/audits", done: hasAudits },
    { id: "aeo", label: "Check your AEO score", href: "/dashboard/aeo", done: aeoScore > 0 },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);

  // ── Anti-churn data ───────────────────────────────────────────────────────
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
  const primarySiteDomain = primarySiteId
    ? await prisma.site.findFirst({
        where: { id: primarySiteId },
        select: { domain: true },
      }).then((s) => s?.domain ?? null).catch(() => null)
    : null;

  const [hasTrackedKeywords, hasBlogPosts, hasTeamMember] = await Promise.all([
    primarySiteId
      ? prisma.trackedKeyword.count({ where: { siteId: primarySiteId } }).then((n) => n > 0).catch(() => false)
      : Promise.resolve(false),
    siteIds.length > 0
      ? prisma.blog.count({ where: { siteId: { in: siteIds } } }).then((n) => n > 0).catch(() => false)
      : Promise.resolve(false),
    prisma.teamMember.count({ where: { ownerId: user.id } }).then((n) => n > 0).catch(() => false),
  ]);

  // ── Week 2: Value proof data ─────────────────────────────────────────────
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
      {/* ── Hero Welcome ──────────────────────────────────────────────── */}
      <div className="fade-in-up flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {statusHeadline}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isNewUser
                ? "Let's get your first site up and running."
                : `You're managing ${siteIds.length} site${siteIds.length !== 1 ? "s" : ""}. Here's your overview.`}
            </p>
          </div>
          {!isNewUser && (
            <Link
              href="/dashboard/audits"
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-all hover:bg-emerald-600"
            >
              <ArrowRight className="w-4 h-4" />
              View All Audits
            </Link>
          )}
        </div>

        {/* Inline onboarding wizard — only shown to new users with no sites */}
        {isNewUser && <OnboardingInline />}
      </div>

      {/* ── Insight of the Day (Spotlight) ─────────────────────── */}
      {!isNewUser && hasAudits && (() => {
        let insightTitle = "All clear";
        let insightDesc = "Your sites are healthy. Keep publishing great content.";
        let insightCta = "Write a post";
        let insightHref = "/dashboard/blogs";
        let color = "emerald";

        if (pendingPrsCount > 0) {
          insightTitle = "Technical Debt Alert";
          insightDesc = `You have ${pendingPrsCount} critical SEO issues that can be automatically fixed via our one-click PR integration.`;
          insightCta = "Review Fixes";
          insightHref = "/dashboard/audits";
          color = "rose";
        } else if (aeoScore < 50 && aeoScore > 0) {
          insightTitle = "Low AI Brand Recognition";
          insightDesc = "Your Generative Share of Voice is below industry average. AI engines like ChatGPT do not confidently answer queries about your brand.";
          insightCta = "View Details";
          insightHref = "/dashboard/aeo";
          color = "amber";
        } else if (blogsThisWeek === 0) {
          insightTitle = "Content Velocity Dropping";
          insightDesc = "Search and AI engines favor fresh content. You haven't generated any new articles this week.";
          insightCta = "Generate Content";
          insightHref = "/dashboard/blogs";
          color = "blue";
        } else {
          // All checks pass — show contextual growth prompt for engaged users
          const growthPrompts = [
            { title: "Your site health is strong", desc: "Target a competitor keyword cluster you're not ranking for to find your next growth opportunity.", cta: "Research Keywords →", href: "/dashboard/keywords" },
            { title: "Content published this week", desc: "Analyse your top competitor's content strategy to find your next angle.", cta: "View Keywords →", href: "/dashboard/keywords" },
            { title: "AEO score is solid", desc: "Run a fresh audit to catch any new technical issues before they compound.", cta: "Run Audit →", href: "/dashboard/audits" },
          ];
          const prompt = growthPrompts[new Date().getDate() % growthPrompts.length];
          insightTitle = prompt.title;
          insightDesc = prompt.desc;
          insightCta = prompt.cta;
          insightHref = prompt.href;
          color = "emerald";
        }

        const colorClasses = {
          emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 border-l-4 border-l-emerald-500",
          rose: "bg-rose-500/10 border-rose-500/20 text-rose-400 border-l-4 border-l-rose-500 shadow-[0_4px_24px_-8px_rgba(239,68,68,0.15)]",
          amber: "bg-amber-500/10 border-amber-500/20 text-amber-500 border-l-4 border-l-amber-500 shadow-[0_4px_24px_-8px_rgba(245,158,11,0.15)]",
          blue: "bg-blue-500/10 border-blue-500/20 text-blue-400 border-l-4 border-l-blue-500",
        };

        return (
          <div className={`fade-in-up w-full p-5 rounded-r-2xl border-y border-r ${colorClasses[color as keyof typeof colorClasses]} mb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 transition-all hover:translate-x-1`}>
            <div className="flex gap-4 items-start">
              <div className={`mt-1 p-2.5 rounded-xl bg-background border border-current shrink-0 shadow-sm`}>
                <Sparkles className="w-5 h-5 opacity-90" />
              </div>
              <div>
                <div className={`text-xs items-center flex gap-1.5 font-bold uppercase tracking-widest opacity-70 mb-1.5`}>
                  <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  Insight of the Day
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1 tracking-tight">{insightTitle}</h3>
                <p className="text-sm opacity-80 max-w-xl leading-relaxed">{insightDesc}</p>
              </div>
            </div>
            <Link href={insightHref} className={`shrink-0 w-full md:w-auto text-center px-6 py-3 font-extrabold text-xs rounded-xl bg-foreground text-background shadow-md hover:scale-105 active:scale-95 transition-all`}>
              {insightCta} &rarr;
            </Link>
          </div>
        );
      })()}


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
      {hasSites && auditsThisMonth >= Math.ceil(FREE_AUDIT_LIMIT * 0.5) && (
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

      {/* ── Next Steps — Contextual Action Guide ─────────────────────── */}
      {(() => {
        type NextStep = { icon: React.ElementType; title: string; desc: string; href: string; cta: string; color: string; bg: string; };
        const steps: NextStep[] = [];
        if (!hasSites) {
          steps.push({ icon: Zap, title: "Add your first domain", desc: "Connect a website to unlock SEO audits, AEO tracking, and AI blog generation.", href: "/dashboard/sites/new", cta: "Add Site →", color: "text-emerald-400", bg: "border-emerald-500/20 bg-emerald-500/5" });
        }
        if (hasSites && !hasAudits) {
          steps.push({ icon: AlertCircle, title: "Your first audit is being prepared", desc: "We've queued your first scan automatically. Check the audits page for progress — usually ready in under 60 seconds.", href: "/dashboard/audits", cta: "Check Audit Progress →", color: "text-amber-400", bg: "border-amber-500/20 bg-amber-500/5" });
        }
        const hasErrors = audits.some((a) => {
          type AuditRec = { priority: string };
          type AuditIssue = { severity?: string };
          type AuditIssueList = AuditIssue[] | { recommendations?: AuditRec[] };
          const list = a.issueList as AuditIssueList;
          return Array.isArray(list)
            ? list.some((i) => i.severity === "error")
            : Array.isArray((list as { recommendations?: AuditRec[] }).recommendations) &&
            (list as { recommendations: AuditRec[] }).recommendations.some((r) => r.priority === "High");
        });
        if (hasSites && hasAudits && hasErrors) {
          steps.push({ icon: Target, title: "Fix critical SEO issues", desc: "Your latest audit found high-priority issues. Review and apply one-click fixes.", href: `/dashboard/audits/${audits[0]?.id || ""}`, cta: "Fix Issues →", color: "text-red-400", bg: "border-red-500/20 bg-red-500/5" });
        }
        if (hasSites && blogsThisWeek === 0) {
          steps.push({ icon: FileText, title: "Generate your first blog post", desc: "AI-generated, SEO-optimised content with humanization pass for <35% AI detection score.", href: "/dashboard/blogs", cta: "Create Post →", color: "text-purple-400", bg: "border-purple-500/20 bg-purple-500/5" });
        }
        if (aeoScore === 0 && hasSites) {
          steps.push({ icon: Search, title: "Check your AEO visibility", desc: "See how Gemini, ChatGPT, and Perplexity answer questions about your site.", href: "/dashboard/aeo", cta: "Run AEO Scan →", color: "text-blue-400", bg: "border-blue-500/20 bg-blue-500/5" });
        }
        const shown = steps.slice(0, 3);
        if (shown.length === 0) return null;
        return (
          <div className="fade-in-up fade-in-up-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Your Next Steps
            </h3>
            <div className={`grid gap-3 ${shown.length === 1 ? "grid-cols-1" :
                shown.length === 2 ? "grid-cols-2" :
                  "grid-cols-1 sm:grid-cols-3"
              }`}>
              {shown.map((step, i) => (
                <Link key={i} href={step.href} className={`flex flex-col gap-3 p-4 rounded-xl border ${step.bg} transition-all hover:-translate-y-0.5 group`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
                      <step.icon className={`w-4 h-4 ${step.color}`} />
                    </div>
                    <span className={`text-xs font-bold uppercase tracking-wider ${step.color}`}>
                      Step {i + 1}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
                  </div>
                  <span className={`text-xs font-bold ${step.color}`}>{step.cta}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Charts + Pending ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 fade-in-up fade-in-up-3">
        {/* Chart */}
        <div className="lg:col-span-2 card-surface p-4 md:p-6 flex flex-col min-h-[180px] md:min-h-[380px]">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold">SEO Score Trend</h3>
            <span className="text-xs font-medium text-muted-foreground px-2 py-0.5 bg-muted/40 rounded-full border border-border">
              Last 14 audits
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            Average score across all domains over time
          </p>
          <div className="flex-1 w-full min-h-0">
            {chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    No audit data yet
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    Your score trend will appear here after your first audit.
                  </p>
                </div>
                <Link
                  href="/dashboard/audits"
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                >
                  Run your first audit <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : (
              <AuditChart data={chartData} />
            )}
          </div>
        </div>

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
            creditsRemaining={user.credits}
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

        {/* ── Ask AI Assistant CTA ───────────────────────────────────────────── */}
        <Link
          href="/dashboard/voice"
          className="mt-5 flex items-center gap-4 p-5 rounded-xl border border-border bg-card hover:border-indigo-500/30 hover:bg-accent transition-all duration-200 group"
        >
          <div className="w-9 h-9 rounded-lg bg-accent border border-border flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">
              Ask the AI Assistant — Your AI SEO Copilot
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Speak or type to audit, research keywords, analyze competitors &
              more
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-xs font-bold text-indigo-400 uppercase tracking-widest px-2 py-1 rounded-md bg-indigo-500/15 border border-indigo-500/20">
              <Mic className="w-3 h-3" /> Live
            </span>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-indigo-400 transition-colors" />
          </div>
        </Link>
      </div>

      {/* ── 2.1: 6-Month Metric Trend Chart ─────────────────────────────── */}
      {metricTrend.length > 0 && (
        <MetricTrendChart
          data={metricTrend.map(m => ({
            capturedAt: m.capturedAt.toISOString(),
            overallScore: m.overallScore,
            aeoScore: m.aeoScore,
            coreWebVitals: m.coreWebVitals,
            schemaScore: m.schemaScore,
            organicTraffic: m.organicTraffic,
          }))}
          className="fade-in-up"
        />
      )}
    </div>
  );
}