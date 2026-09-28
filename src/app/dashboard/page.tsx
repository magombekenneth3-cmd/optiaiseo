import { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  TrendingUp,
  Zap,
} from "lucide-react";
import { extractAuditMetrics } from "@/lib/audit/helpers";
import { getCachedDashboardMetricsForUser } from "@/lib/cache/dashboard";
import { OnboardingInline } from "@/components/dashboard/OnboardingInline";
import { OnboardingProgress } from "@/components/dashboard/OnboardingProgress";
import { MetricTrendChart } from "@/components/dashboard/MetricTrendChart";
import { getMetricTrend } from "@/lib/metrics/metric-snapshot";
import { ScoreDropAlert } from "@/components/dashboard/ScoreDropAlert";
import {
  WinCelebrationToast,
  ReAuditNudge,
} from "@/components/dashboard/DashboardClientWidgets";
import { AutonomousActivity } from "@/components/dashboard/AutonomousActivity";
import { DashboardAttentionQueue } from "@/components/dashboard/DashboardAttentionQueue";
import { DashboardRemediationPipeline } from "@/components/dashboard/DashboardRemediationPipeline";
import { getDashboardUser } from "@/lib/auth/dashboard-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Dashboard | OptiAISEO",
  description: "Manage your SEO audits, websites, and content generation.",
};


export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
  const user = await getDashboardUser();
  const availableSiteIds = user.sites.map((s) => s.id);
  const params = await searchParams;
  const requestedSiteId = params.siteId && availableSiteIds.includes(params.siteId) ? params.siteId : null;
  const siteIds = requestedSiteId ? [requestedSiteId] : availableSiteIds;

  const { audits, pendingPrsCount } =
    await getCachedDashboardMetricsForUser(user.id, siteIds);

  const latestAeoReport = await prisma.aeoReport.findFirst({
    where: { siteId: { in: siteIds }, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { score: true }
  });
  const aeoScore = latestAeoReport?.score || 0;

  const chartData = audits
    .slice(0, 14)
    .reverse()
    .map((a) => {
      const { seoScore, issueCount } = extractAuditMetrics({
        categoryScores: a.categoryScores as Record<string, unknown> | null,
        issueList: a.issueList,
      });
      return {
        name: new Date(a.runTimestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        score: seoScore,
        issues: issueCount,
      };
    });

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
      : "Monitoring your SEO and AI search visibility";
  if (!isNewUser && pendingPrsCount > 0) {
    statusHeadline = `${pendingPrsCount} issue${pendingPrsCount !== 1 ? 's' : ''} need attention`;
  } else if (scoreDelta !== null && scoreDelta !== 0) {
    statusHeadline = `Your score ${scoreDelta > 0 ? 'improved' : 'dropped'} ${Math.abs(scoreDelta)} points since last audit`;
  } else if (!isNewUser && audits.length > 0) {
    statusHeadline = `Latest audit completed · ${new Date(audits[0].runTimestamp).toLocaleDateString()}`;
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const primarySiteId = siteIds[0] ?? null;
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
      select: { domain: true, githubRepoUrl: true, operatingMode: true, automationsPaused: true },
    }).catch(() => null)
    : null;
  const primarySiteDomain = primarySiteData?.domain ?? null;

  const [
    aiCitationsThisMonth,
    prsCreatedThisMonth,
    metricSnapshots,
  ] = await Promise.all([
    primarySiteId
      ? prisma.aeoEvent.count({ where: { siteId: primarySiteId, eventType: "CITED", createdAt: { gte: startOfMonth } } }).catch(() => 0)
      : Promise.resolve(0),
    primarySiteId
      ? prisma.selfHealingLog.count({ where: { siteId: primarySiteId, createdAt: { gte: startOfMonth } } }).catch(() => 0)
      : Promise.resolve(0),
    primarySiteId
      ? prisma.metricSnapshot.findMany({ where: { siteId: primarySiteId }, orderBy: { capturedAt: "desc" }, take: 2, select: { organicTraffic: true } }).catch(() => [])
      : Promise.resolve([]),
  ]);

  // ── Computed values for redesigned layout ──────────────────────────────────
  const organicClicks = metricSnapshots.length > 0 && metricSnapshots[0].organicTraffic !== null
    ? metricSnapshots[0].organicTraffic
    : null;
  const previousOrganicClicks = metricSnapshots.length > 1 && metricSnapshots[1].organicTraffic !== null
    ? metricSnapshots[1].organicTraffic
    : null;
  const organicTrafficDelta = organicClicks !== null && previousOrganicClicks !== null
    ? organicClicks - previousOrganicClicks
    : null;
  const organicClicksDeltaPct = organicClicks !== null && organicTrafficDelta !== null && (organicClicks - organicTrafficDelta) > 0
    ? Math.round((organicTrafficDelta / (organicClicks - organicTrafficDelta)) * 100)
    : null;
  const rankMovement = rankWin ? rankWin.delta : null;
  const latestIssueCount = chartData.length > 0 ? chartData[chartData.length - 1].issues ?? 0 : 0;
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

  // ── Diagnostic-aware priority actions ──────────────────────────────────────
  // Try to pull evidence-driven findings from the diagnostic engine.
  // If the migration hasn't been run yet, fall back to legacy checklist items.
  let diagnosticFindingCount = 0;
  let diagnosticVerifiedCount = 0;
  let diagnosticDeterministicCount = 0;
  try {
    const diagnosticFindings = await (prisma as any).diagnosticFindingRecord?.findMany?.({
      where: { siteId: primarySiteId ?? "", status: { in: ["FAIL", "WARNING"] } },
      orderBy: [{ severity: "asc" }, { priorityScore: "desc" }],
      take: 5,
      select: {
        id: true,
        fingerprint: true,
        issueType: true,
        status: true,
        severity: true,
        rootCause: true,
        confidence: true,
        expectedOutcome: true,
        remediationType: true,
        priorityScore: true,
      },
    });

    if (diagnosticFindings && diagnosticFindings.length > 0) {
      diagnosticFindingCount = diagnosticFindings.length;

      // Count verified and deterministic
      const allFindings = await (prisma as any).diagnosticFindingRecord?.count?.({
        where: { siteId: primarySiteId ?? "" },
      }) ?? 0;
      diagnosticVerifiedCount = await (prisma as any).diagnosticFindingRecord?.count?.({
        where: { siteId: primarySiteId ?? "", status: "PASS", resolvedAt: { not: null } },
      }) ?? 0;
      diagnosticDeterministicCount = await (prisma as any).diagnosticFindingRecord?.count?.({
        where: { siteId: primarySiteId ?? "", remediationType: "DETERMINISTIC" },
      }) ?? 0;

      // Use diagnostic findings as priority actions (evidence-driven)
      for (const finding of diagnosticFindings.slice(0, 3)) {
        const severity = finding.severity as "critical" | "high" | "medium" | "low";
        const confidencePct = Math.round((finding.confidence ?? 0) * 100);
        priorityActions.push({
          id: `diag-${finding.fingerprint}`,
          impact: severity,
          title: finding.rootCause ?? finding.issueType,
          subtitle: finding.expectedOutcome ?? "Fix this to improve SEO performance.",
          reason: `Root cause identified with ${confidencePct}% confidence. Priority score: ${finding.priorityScore ?? "—"}/100.`,
          confidence: `${confidencePct}% confidence`,
          href: topAudit ? `/dashboard/audits/${topAudit.id}` : "/dashboard/audits",
          ctaLabel: finding.remediationType === "DETERMINISTIC" ? "Auto-fix" : finding.remediationType === "AI_PATCH" ? "Generate fix" : "Review",
        });
      }
    }
  } catch {
    // Table doesn't exist yet (migration not run) — fall through to legacy
  }

  // Legacy fallback: use checklist items if no diagnostic findings available
  if (priorityActions.length === 0 && topAudit) {
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

  const attentionItems = priorityActions.slice(0, 4).map((action) => ({
    id: action.id,
    title: action.title,
    detail: action.subtitle,
    severity: action.impact === "critical" ? "critical" as const : action.impact === "high" ? "high" as const : "medium" as const,
    state: pendingPrsCount > 0 ? "review" as const : "unknown" as const,
    href: action.href,
    action: action.ctaLabel,
  }));

  const automationState = primarySiteData?.automationsPaused ? "PAUSED" : primarySiteData?.operatingMode === "AUTOPILOT" ? "AUTOPILOT" : primarySiteData?.operatingMode === "SUPERVISED" ? "SUPERVISED" : "REPORT_ONLY";
  const lastAuditDate = audits[0]
    ? new Date(audits[0].runTimestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 fade-in-up">

      {/* ── Status summary row ─────────────────────────────────────────────────── */}
      <section aria-label="Site status" className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Mission Control</p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {primarySiteDomain || "Your SEO workspace"}
          </h1>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {statusHeadline}
            {lastAuditDate && (
              <span className="ml-2 text-muted-foreground/60">
                · Last audit {lastAuditDate}
              </span>
            )}
          </p>
          {primarySiteId && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                automationState === "AUTOPILOT"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : automationState === "PAUSED"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    : "border-border bg-muted/40 text-muted-foreground"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  automationState === "AUTOPILOT" ? "bg-emerald-400 animate-pulse" : automationState === "PAUSED" ? "bg-amber-400" : "bg-muted-foreground"
                }`} />
                {automationState === "AUTOPILOT" ? "Autopilot active" : automationState === "SUPERVISED" ? "Supervised mode" : automationState === "PAUSED" ? "Automation paused" : "Report only"}
              </span>
            </div>
          )}
        </div>
        {primarySiteId && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-1">
            <Link
              href={`/dashboard/audits?siteId=${encodeURIComponent(primarySiteId)}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Run audit
            </Link>
            <Link
              href={`/dashboard/autopilot?siteId=${encodeURIComponent(primarySiteId)}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Autopilot
            </Link>
          </div>
        )}
      </section>

      {/* ── Pending fixes alert ──────────────────────────────────────────────── */}
      {pendingPrsCount > 0 && primarySiteId && (
        <Link
          href={`/dashboard/operations?siteId=${encodeURIComponent(primarySiteId)}`}
          className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-sm transition-colors hover:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="font-medium text-amber-200">
            {pendingPrsCount} proposed fix{pendingPrsCount === 1 ? "" : "es"} awaiting review
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
            Review fixes <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </Link>
      )}

      {/* ── Onboarding / returning user branches ────────────────────────── */}
      {isNewUser ? (
        <>
          <OnboardingProgress steps={onboardingSteps} />
          <OnboardingInline />
        </>
      ) : (
        <>
          {!onboardingDone && <OnboardingProgress steps={onboardingSteps} />}
          {scoreDelta !== null && scoreDelta <= -8 && (
            <ScoreDropAlert delta={Math.abs(scoreDelta)} topIssue={topIssueLabel} auditId={topAudit?.id ?? null} />
          )}
          {rankWin && (
            <WinCelebrationToast keyword={rankWin.keyword} delta={rankWin.delta} newPosition={rankWin.newPosition} winId={rankWin.winId} />
          )}
          {daysSinceAudit !== null && daysSinceAudit > 7 && primarySiteId && primarySiteDomain && (
            <ReAuditNudge daysSince={daysSinceAudit} siteId={primarySiteId} siteUrl={"https://" + primarySiteDomain} />
          )}

          {/* ── KPI cards ──────────────────────────────────────────────────── */}
          {hasAudits && (
            <section aria-label="Performance overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="kpi-card">
                <div className="flex items-center gap-3">
                  <ScoreRing score={latestScore ?? 0} color="var(--brand)" size={48} strokeWidth={4} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">SEO health</p>
                    <p className={"mt-0.5 text-sm font-semibold " + scoreColor(latestScore ?? 0)}>
                      {scoreDelta !== null && scoreDelta !== 0
                        ? (scoreDelta > 0 ? "+" : "") + scoreDelta + " pts"
                        : latestScore !== null ? `${latestScore}/100` : "—"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="kpi-card">
                <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{aeoScore > 0 ? aeoScore : "—"}</p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">AI visibility</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{aeoScore > 0 ? "out of 100" : "Run AEO check"}</p>
              </div>
              <div className="kpi-card">
                <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{organicClicks !== null ? formatCompact(organicClicks) : "—"}</p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">Organic clicks</p>
                <p className={"mt-0.5 text-xs " + (organicClicksDeltaPct !== null && organicClicksDeltaPct < 0 ? "text-rose-400" : "text-emerald-400")}>
                  {organicClicksDeltaPct !== null ? (organicClicksDeltaPct > 0 ? "+" : "") + organicClicksDeltaPct + "% MoM" : "No trend yet"}
                </p>
              </div>
              <div className="kpi-card">
                <p className={"text-2xl font-semibold tracking-tight tabular-nums " + (rankMovement !== null ? "text-emerald-400" : "text-muted-foreground")}>
                  {rankMovement !== null ? "↑" + rankMovement : "—"}
                </p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">Rank movement</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{rankMovement !== null ? "positions improved" : "No movement tracked"}</p>
              </div>
            </section>
          )}

          {/* ── Attention queue ──────────────────────────────────────────────── */}
          {attentionItems.length > 0 && <DashboardAttentionQueue items={attentionItems} />}

          {/* ── Trend chart ──────────────────────────────────────────────────── */}
          {(metricTrend.length > 0 || chartData.length > 0) && (
            <MetricTrendChart
              data={metricTrend.map((m) => ({
                capturedAt: m.capturedAt.toISOString(),
                overallScore: m.overallScore,
                aeoScore: m.aeoScore,
                coreWebVitals: m.coreWebVitals,
                schemaScore: m.schemaScore,
                organicTraffic: m.organicTraffic,
              }))}
              auditData={chartData}
              className="fade-in-up fade-in-up-2"
            />
          )}

          {/* ── At-a-glance ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="mc-ai-title">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">AI Search</p>
                  <h2 id="mc-ai-title" className="mt-1 text-sm font-semibold text-foreground">AI visibility</h2>
                </div>
                <Link href="/dashboard/aeo" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  Open report <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-5 flex items-end gap-6">
                <div>
                  <p className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{aeoScore > 0 ? aeoScore : "—"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">visibility score</p>
                </div>
                <div className="border-l border-border pl-6">
                  <p className="text-xl font-semibold text-foreground tabular-nums">{aiCitationsThisMonth || "—"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">citations this month</p>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="mc-tech-title">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Technical health</p>
                  <h2 id="mc-tech-title" className="mt-1 text-sm font-semibold text-foreground">Latest audit</h2>
                </div>
                <Link href={topAudit ? "/dashboard/audits/" + topAudit.id : "/dashboard/audits"} className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  Open audit <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-5 flex items-end gap-6">
                <div>
                  <p className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">{latestIssueCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">issues detected</p>
                </div>
                <div className="border-l border-border pl-6">
                  <p className="text-xl font-semibold text-foreground tabular-nums">{pendingPrsCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">fixes awaiting review</p>
                </div>
              </div>
            </section>
          </div>

          {/* ── Remediation pipeline ───────────────────────────────────────────── */}
          <DashboardRemediationPipeline
            proposed={diagnosticFindingCount > 0 ? diagnosticFindingCount : pendingPrsCount}
            active={diagnosticDeterministicCount}
            completed={prsCreatedThisMonth}
            verified={diagnosticVerifiedCount}
          />

          {/* ── Autonomous activity ────────────────────────────────────────────── */}
          {primarySiteId && <AutonomousActivity siteId={primarySiteId} />}

          {/* ── Recent audit history ────────────────────────────────────────────── */}
          {recentAuditRows.length > 0 && (
            <section className="rounded-2xl border border-border bg-card" aria-labelledby="mc-audit-history">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">History</p>
                  <h2 id="mc-audit-history" className="mt-1 text-sm font-semibold text-foreground">Recent audit activity</h2>
                </div>
                <Link href="/dashboard/audits" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                  View all <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="divide-y divide-border">
                {recentAuditRows.map((row) => (
                  <Link key={row.id} href={"/dashboard/audits/" + row.id} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-accent/20">
                    <div className="flex min-w-0 items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">SEO audit completed</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(row.date)} · {row.seoScore}/100</p>
                      </div>
                    </div>
                    <span className={"shrink-0 text-xs font-semibold " + (row.change !== null && row.change > 0 ? "text-emerald-400" : row.change !== null && row.change < 0 ? "text-rose-400" : "text-muted-foreground")}>
                      {row.change === null ? "—" : (row.change > 0 ? "+" : "") + row.change}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Empty: site connected but no audits ─────────────────────────── */}
          {!isNewUser && hasSites && !hasAudits && (
            <section className="rounded-2xl border border-border bg-card p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10">
                <TrendingUp className="h-6 w-6 text-brand" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Run your first audit</h2>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                Start tracking SEO performance and turn findings into verified improvements.
              </p>
              {primarySiteId && (
                <Link href={"/dashboard/audits?siteId=" + primarySiteId} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90">
                  Run audit <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
