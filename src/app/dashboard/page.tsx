import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  ArrowRight,
  ArrowUpRight,
  Shield,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Activity,
  TrendingUp,
  Link2,
} from "lucide-react";
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
import { PriorityActions } from "@/components/dashboard/PriorityActions";
import { AutonomousActivity } from "@/components/dashboard/AutonomousActivity";
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

  const actionState = pendingPrsCount > 0
    ? {
      label: `${pendingPrsCount} fix${pendingPrsCount === 1 ? "" : "es"} awaiting review`,
      detail: "A proposed change already exists. Review it before starting another fix.",
      tone: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    }
    : {
      label: "Ready to act",
      detail: "Based on your latest completed audit and current visibility signals.",
      tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    };

  const onboardingSteps = [
    { id: "site", label: "Connect your domain", href: "/dashboard/sites/new", done: hasSites },
    { id: "audit", label: "Run your first audit", href: "/dashboard/audits", done: hasAudits },
    { id: "aeo", label: "Check your AEO score", href: "/dashboard/aeo", done: aeoScore > 0 },
  ];
  const onboardingDone = onboardingSteps.every((s) => s.done);
  let rankWin: { keyword: string; delta: number; newPosition: number; winId: string } | null = null;
  if (primarySiteId) {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSnaps = await prisma.rankSnapshot.findMany({
        where: { siteId: primarySiteId, recordedAt: { gte: since7d } },
        orderBy: { recordedAt: "asc" },
        select: { keyword: true, position: true, recordedAt: true },
      });
      const byKw = new Map<string, number[]>();
      for (const s of recentSnaps) {
        const arr = byKw.get(s.keyword) ?? [];
        arr.push(s.position);
        byKw.set(s.keyword, arr);
      }
      let bestDelta = 2;
      for (const [kw, positions] of byKw.entries()) {
        if (positions.length < 2) continue;
        const delta = positions[0] - positions[positions.length - 1];
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
  const daysSinceAudit = audits[0]
    ? Math.floor((Date.now() - new Date(audits[0].runTimestamp).getTime()) / 86_400_000)
    : null;
  const hasGscToken = (user as unknown as { gscConnected?: boolean }).gscConnected ?? false;
  const primarySiteData = primarySiteId
    ? await prisma.site.findFirst({
      where: { id: primarySiteId },
      select: { domain: true, githubRepoUrl: true },
    }).catch(() => null)
    : null;
  const primarySiteDomain = primarySiteData?.domain ?? null;
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

  const [
    creditHistoryThisMonth,
    aiCitationsThisMonth,
    prsCreatedThisMonth,
    metricSnapshots,
  ] = await Promise.all([
    prisma.creditHistory.findMany({
      where: { userId: user.id, createdAt: { gte: startOfMonth } },
      select: { action: true, cost: true },
    }).catch(() => [] as { action: string; cost: number }[]),
    primarySiteId
      ? prisma.aeoEvent.count({
        where: { siteId: primarySiteId, eventType: "CITED", createdAt: { gte: startOfMonth } },
      }).catch(() => 0)
      : Promise.resolve(0),
    primarySiteId
      ? prisma.selfHealingLog.count({
        where: {
          siteId: primarySiteId,
          createdAt: { gte: startOfMonth },
        },
      }).catch(() => 0)
      : Promise.resolve(0),
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
  const auditCreditsUsed = creditHistoryThisMonth.filter((h) => h.action.includes("audit")).length;
  const blogCreditsUsed = creditHistoryThisMonth.filter((h) => h.action.includes("blog")).length;
  const aeoCreditsUsed = creditHistoryThisMonth.filter((h) => h.action.includes("aeo")).length;
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

  function timeAgo(date: Date): string {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const priorityActions: { id: string; impact: "critical" | "high" | "medium" | "low"; title: string; subtitle: string; reason?: string; confidence?: string; href: string; ctaLabel: string }[] = [];

  if (topAudit) {
    type IssueItem = { status: string; label?: string; title?: string; id?: string };
    type IssueCategory = { items?: IssueItem[] };
    const rawList = topAudit.issueList as IssueCategory[] | null;
    const cats: IssueCategory[] = Array.isArray(rawList) ? rawList : [];
    const failItems = cats.flatMap((c) => c.items ?? []).filter((i) => i.status === "Fail");
    for (const item of failItems.slice(0, 3)) {
      const title = item.label ?? item.title ?? "SEO Issue";
      priorityActions.push({
        id: item.id ?? item.label ?? item.title ?? "issue",
        impact: "high",
        title,
        subtitle: "Detected in the latest audit.",
        reason: "This issue is likely blocking ranking improvements or content quality signals in the current report.",
        confidence: "High confidence",
        href: topAudit ? `/dashboard/audits/${topAudit.id}` : "/dashboard/audits",
        ctaLabel: "Review fix",
      });
    }
  }

  if (aeoScore > 0 && aeoScore < 70) {
    priorityActions.push({
      id: "aeo-weak",
      impact: "high",
      title: "Weak AI search visibility",
      subtitle: `AEO score is ${aeoScore}/100.`,
      reason: "AI answer engines are under-citing your brand, which can limit visibility even when your technical SEO is otherwise healthy.",
      confidence: "Strong signal",
      href: "/dashboard/aeo",
      ctaLabel: "Optimize",
    });
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

  // ── Score Ring helper ──────────────────────────────────────────────────────
  function ScoreRing({ score, max = 100, size = 56, strokeWidth = 5, color }: { score: number; max?: number; size?: number; strokeWidth?: number; color: string }) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const pct = Math.min(score / max, 1);
    const offset = circumference * (1 - pct);
    return (
      <div className="score-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} aria-hidden="true">
          <circle className="score-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
          <circle className="score-ring-fill" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} stroke={color} strokeDasharray={circumference} strokeDashoffset={offset} />
        </svg>
        <span className="score-ring-value" style={{ fontSize: size > 48 ? '16px' : '13px' }}>{score}</span>
      </div>
    );
  }

  // ── Score color helper ─────────────────────────────────────────────────────
  function scoreColor(score: number): string {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-400";
  }

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

      {/* ── Primary action focus ──────────────────────────────────────── */}
      {!isNewUser && priorityActions[0] && (
        <section className="rounded-3xl border border-brand/20 bg-brand/5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">Recommended next step</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${actionState.tone}`}>
                  {actionState.label}
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{priorityActions[0].title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {priorityActions[0].reason ?? priorityActions[0].subtitle}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{actionState.detail}</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Link
                href={priorityActions[0].href}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
              >
                {priorityActions[0].ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                href="/dashboard/recommendations"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                View opportunities
              </Link>

              <Link
                href="/dashboard/aeo"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Check AI visibility
              </Link>
            </div>
          </div>

          {priorityActions.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {priorityActions.slice(1, 3).map((action) => (
                <Link
                  key={action.id}
                  href={action.href}
                  className="rounded-full border border-border/80 bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
                >
                  {action.title}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

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

      {/* ── 2. KPI OVERVIEW — Score Rings + Metrics ────────────────────── */}
      {!isNewUser && hasAudits && (
        <section aria-label="Performance overview" className="fade-in-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">

            {/* SEO Score */}
            <div className="kpi-card">
              <div className="flex items-center gap-3">
                <ScoreRing score={latestScore ?? (auditsWithSeo > 0 ? avgSeoScore : 0)} color="var(--brand)" size={52} strokeWidth={4.5} />
                <div className="min-w-0">
                  <p className="stat-label" style={{ marginTop: 0 }}>SEO Score</p>
                  {scoreDelta !== null && scoreDelta !== 0 && (
                    <span className={`text-xs font-semibold ${scoreDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {scoreDelta > 0 ? "+" : ""}{scoreDelta} {prevAuditDateStr}
                    </span>
                  )}
                  {(scoreDelta === null || scoreDelta === 0) && (
                    <span className="text-xs text-muted-foreground/60">out of 100</span>
                  )}
                </div>
              </div>
              {/* Score bar for accessibility */}
              <div className="score-bar mt-1" role="progressbar" aria-valuenow={latestScore ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`SEO Score: ${latestScore ?? 0} out of 100`}>
                <div className="score-bar-fill" style={{ width: `${latestScore ?? 0}%` }} />
              </div>
            </div>

            {/* AEO Visibility */}
            <div className="kpi-card">
              <div className="flex items-center gap-3">
                {aeoScore > 0 ? (
                  <ScoreRing score={aeoScore} color="var(--ai-accent, #a78bfa)" size={52} strokeWidth={4.5} />
                ) : (
                  <div className="w-[52px] h-[52px] rounded-full border-[4.5px] border-border flex items-center justify-center">
                    <span className="text-base font-bold text-muted-foreground">—</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="stat-label" style={{ marginTop: 0 }}>AEO Visibility</p>
                  {aeoScore > 0 ? (
                    <span className={`text-xs font-semibold ${aeoScore >= 80 ? "text-emerald-400" : aeoScore >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                      {aeoScore >= 80 ? "Strong" : aeoScore >= 60 ? "Moderate" : "Low"}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">Not checked yet</span>
                  )}
                </div>
              </div>
              {aeoScore > 0 && (
                <div className="score-bar mt-1" role="progressbar" aria-valuenow={aeoScore} aria-valuemin={0} aria-valuemax={100} aria-label={`AEO Score: ${aeoScore} out of 100`}>
                  <div className="score-bar-fill" style={{ width: `${aeoScore}%`, background: "var(--ai-accent, #a78bfa)" }} />
                </div>
              )}
            </div>

            {/* Organic Clicks */}
            <div className="kpi-card">
              {organicClicks !== null ? (
                <>
                  <p className="stat-value" style={{ fontSize: '1.75rem' }}>{formatCompact(organicClicks)}</p>
                  <p className="stat-label">Organic Clicks</p>
                  {organicClicksDeltaPct !== null && organicClicksDeltaPct !== 0 && (
                    <span className={`text-xs font-semibold ${organicClicksDeltaPct > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {organicClicksDeltaPct > 0 ? "+" : ""}{organicClicksDeltaPct}% {prevAuditDateStr}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <p className="stat-value text-muted-foreground/30" style={{ fontSize: '1.75rem' }}>—</p>
                  <p className="stat-label">Organic Clicks</p>
                  <p className="empty-state-hint">
                    No Search Console data.{" "}
                    <Link href="/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard">Connect GSC</Link>
                  </p>
                </>
              )}
            </div>

            {/* Rank Movement */}
            <div className="kpi-card">
              {rankMovement !== null ? (
                <>
                  <p className="stat-value text-emerald-400" style={{ fontSize: '1.75rem' }}>↑{rankMovement}</p>
                  <p className="stat-label">Rank Movement</p>
                  <span className="text-xs font-semibold text-emerald-400">
                    Positions improved
                  </span>
                </>
              ) : (
                <>
                  <p className="stat-value text-muted-foreground/30" style={{ fontSize: '1.75rem' }}>—</p>
                  <p className="stat-label">Rank Movement</p>
                  <p className="empty-state-hint">
                    No movement tracked this week
                  </p>
                </>
              )}
            </div>

          </div>
        </section>
      )}

      {/* ── 3. RECOMMENDED ACTIONS — Consolidated ─────────────────────── */}
      {!isNewUser && (priorityActions.length > 0 || (onboardingDone && hasSites)) && (
        <>
          <hr className="section-divider" />
          <section aria-label="Recommended actions">
            <p className="section-label mb-3">Recommended Actions</p>

            {/* Next Best Action — always first when available */}
            {onboardingDone && hasSites && priorityActions.length === 0 && (
              <div className="mb-2">
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
              </div>
            )}

            {/* Priority Actions below */}
            {priorityActions.length > 0 && (
              <PriorityActions actions={priorityActions} />
            )}
          </section>
        </>
      )}

      {/* ── 4. SEO PERFORMANCE — Trend chart ───────────────────────────── */}
      {(metricTrend.length > 0 || chartData.length > 0) && (
        <>
          <hr className="section-divider" />
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
        </>
      )}

      {/* ── 5. SECONDARY PANELS — AI Visibility + Technical Health ───── */}
      {!isNewUser && hasAudits && (
        <>
          <hr className="section-divider" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 fade-in-up fade-in-up-2">

            {/* AI Search Presence */}
            <div className="border border-border rounded-2xl bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4" style={{ color: "var(--ai-accent, #a78bfa)" }} aria-hidden="true" />
                <h3 className="text-[13px] font-semibold text-foreground">AI Search Presence</h3>
              </div>

              <div className="flex items-start gap-6">
                {/* Main score */}
                <div className="flex flex-col">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[28px] font-bold tracking-tight text-foreground tabular-nums leading-none">
                      {aeoScore > 0 ? aeoScore : "—"}
                    </span>
                    {aeoScore > 0 && <span className="text-xs text-muted-foreground">/100</span>}
                  </div>
                  {aeoScore > 0 ? (
                    <span className={`text-[11px] font-semibold mt-1.5 ${aeoScore >= 80 ? "text-emerald-400" : aeoScore >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                      {aeoScore >= 80 ? "Strong" : aeoScore >= 60 ? "Moderate" : "Low"} visibility
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground mt-1.5">Run an AEO check to start</span>
                  )}
                </div>

                {/* Citations */}
                <div className="flex flex-col border-l border-border pl-5">
                  <span className="text-xs text-muted-foreground mb-0.5">Citations</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">
                    {aiCitationsThisMonth > 0 ? aiCitationsThisMonth : "—"}
                  </span>
                  {aiCitationsThisMonth > 0 ? (
                    <span className="text-[10px] text-emerald-400 font-medium">this month</span>
                  ) : (
                    <Link
                      href="/dashboard/aeo"
                      className="text-[10px] font-medium text-brand hover:underline underline-offset-2"
                    >
                      Run AEO check
                    </Link>
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
            <div className="border border-border rounded-2xl bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold text-foreground">Technical Health</h3>
              </div>

              <div className="flex items-start gap-6">
                {/* Issues found */}
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">Issues found</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">{latestIssueCount}</span>
                  {latestIssueCount === 0 ? (
                    <span className="text-[10px] text-emerald-400 font-medium">All clear</span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-medium">Needs attention</span>
                  )}
                </div>

                {/* Pending fixes */}
                <div className="flex flex-col border-l border-border pl-5">
                  <span className="text-xs text-muted-foreground mb-0.5">Pending fixes</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">
                    {pendingPrsCount}
                  </span>
                  {pendingPrsCount === 0 ? (
                    <span className="text-[10px] text-emerald-400 font-medium">None pending</span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-medium">Awaiting review</span>
                  )}
                </div>

                {/* Fixes applied */}
                <div className="flex flex-col border-l border-border pl-5">
                  <span className="text-xs text-muted-foreground mb-0.5">Fixes applied</span>
                  <span className="text-lg font-bold tabular-nums text-foreground">
                    {prsCreatedThisMonth > 0 ? prsCreatedThisMonth : "—"}
                  </span>
                  {prsCreatedThisMonth > 0 ? (
                    <span className="text-[10px] text-emerald-400 font-medium">this month</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">No fixes yet</span>
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
        </>
      )}

      {/* ── 6. AUTONOMOUS ACTIVITY ─────────────────────────────────────── */}
      {!isNewUser && primarySiteId && (
        <>
          <hr className="section-divider" />
          <AutonomousActivity siteId={primarySiteId} />
        </>
      )}

      {/* ── 7. RECENT AUDITS TABLE ─────────────────────────────────────── */}
      {!isNewUser && recentAuditRows.length > 0 && (
        <div className="border border-border rounded-2xl bg-card overflow-hidden fade-in-up fade-in-up-3">
          <div className="px-5 py-4 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">Recent Audits</h3>
            <Link
              href="/dashboard/audits"
              className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Table */}
          <div className="table-scroll">
            <table className="w-full text-left">
              <thead>
                <tr className="border-t border-border">
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Audit</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">SEO Score</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Change</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="px-5 py-2.5 w-8"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {recentAuditRows.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-accent/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <p className="text-[13px] font-medium text-foreground">Technical &amp; Content Audit</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[13px] font-semibold tabular-nums ${scoreColor(row.seoScore)}`}>{row.seoScore}</span>
                      <span className="text-xs text-muted-foreground ml-0.5">/100</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.change !== null ? (
                        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${row.change > 0 ? "text-emerald-400" : row.change < 0 ? "text-rose-400" : "text-muted-foreground"
                          }`}>
                          {row.change > 0 ? <ArrowUpRight className="w-3 h-3" /> : row.change < 0 ? <ArrowUpRight className="w-3 h-3 rotate-90" /> : null}
                          {row.change > 0 ? "+" : ""}{row.change}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(row.date)}
                    </td>
                    <td className="px-5 py-3.5">
                      <Link href={`/dashboard/audits/${row.id}`} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`View audit from ${timeAgo(row.date)}`}>
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state — no audits yet ─────────────────────────────────── */}
      {!isNewUser && hasSites && !hasAudits && (
        <div className="border border-border rounded-2xl bg-card p-8 text-center fade-in-up">
          <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-6 h-6 text-brand" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Run your first audit</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
            Start tracking your SEO performance, discover issues, and get actionable recommendations.
          </p>
          {primarySiteId && (
            <Link
              href={`/dashboard/audits?siteId=${primarySiteId}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors"
            >
              Run Audit <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
