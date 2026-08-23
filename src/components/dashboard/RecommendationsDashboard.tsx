"use client";

import { useState } from "react";
import {
  Lightbulb,
  ExternalLink,
  ChevronRight,
  Zap,
  Globe,
  Code2,
  TrendingUp,
  TrendingDown,
  Shield,
  Rocket,
  BookOpen,
  MousePointerClick,
  Trophy,
  Sparkles,
  PlugZap,
  CheckCircle2,
  XCircle,
  Eye,
  ArrowUpRight,
  BarChart3,
  Target,
  X,
  Loader2,
} from "lucide-react";
import type {
  Recommendation,
  RecommendationPriority,
  RecommendationEffort,
  RecommendationResult,
} from "@/lib/recommendations/engine";

// ────────────────────────────────────────────────────────────────────────────
// Display metadata
// ────────────────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<
  RecommendationPriority,
  { label: string; badgeCls: string; dotCls: string; order: number }
> = {
  critical: {
    label:    "Critical",
    badgeCls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    dotCls:   "bg-rose-400 animate-pulse",
    order:    0,
  },
  high: {
    label:    "High",
    badgeCls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    dotCls:   "bg-amber-400",
    order:    1,
  },
  medium: {
    label:    "Medium",
    badgeCls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    dotCls:   "bg-blue-400",
    order:    2,
  },
  low: {
    label:    "Low",
    badgeCls: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
    dotCls:   "bg-zinc-500",
    order:    3,
  },
};

const EFFORT_META: Record<
  RecommendationEffort,
  { label: string; cls: string }
> = {
  low:    { label: "Low effort",    cls: "text-emerald-400" },
  medium: { label: "Medium effort", cls: "text-amber-400"   },
  high:   { label: "High effort",   cls: "text-rose-400"    },
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "Click-Through Rate":        MousePointerClick,
  "Click-Through Rate Fix":    MousePointerClick,
  "Ranking Opportunity":       TrendingUp,
  "Page-2 Ranking Opportunity": TrendingUp,
  "Featured Snippets":         Trophy,
  "Quick Wins":                Sparkles,
  "Quick Win Opportunity":     Sparkles,
  "Data Sources":              Globe,
  "Developer Workflow":        Code2,
  "AI Visibility":             Zap,
  "Content Health":            TrendingUp,
  "Content Refresh Target":    TrendingDown,
  "Traffic Loss Recovery":     TrendingDown,
  "Internal Linking Target":   BookOpen,
  "SEO Strategy":              BookOpen,
  "Technical SEO":             Shield,
  "LLM Optimization":         Zap,
};

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  ACTIVE:     { label: "Active",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Eye },
  APPROVED:   { label: "Approved",   cls: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: CheckCircle2 },
  EXECUTED:   { label: "Executed",   cls: "bg-violet-500/10 text-violet-400 border-violet-500/20", icon: Rocket },
  MONITORING: { label: "Monitoring", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: BarChart3 },
  COMPLETED:  { label: "Completed",  cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20", icon: CheckCircle2 },
  DISMISSED:  { label: "Dismissed",  cls: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20", icon: XCircle },
};

type FilterTab = "all" | "critical" | "high" | "monitoring";

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: RecommendationPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.badgeCls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotCls}`} />
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.ACTIVE;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.cls}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function GscSourcePip() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wide">
      GSC
    </span>
  );
}

function StatRow({ stats }: { stats: NonNullable<Recommendation["stats"]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 rounded-lg bg-accent/40 border border-border/60">
      {stats.map((s, i) => (
        <div key={`${s.label}-${i}`} className="flex flex-col gap-0.5">
          <dt className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {s.label}
          </dt>
          <dd
            className={`text-[12px] font-semibold truncate ${
              s.highlight ? "text-rose-400" : "text-foreground"
            }`}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Review Detail Modal
// ────────────────────────────────────────────────────────────────────────────

function ReviewModal({
  rec,
  onClose,
  onApprove,
  onDismiss,
  actionLoading,
}: {
  rec: Recommendation;
  onClose: () => void;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  actionLoading: string | null;
}) {
  const CategoryIcon = CATEGORY_ICONS[rec.category] ?? Lightbulb;
  const effort = EFFORT_META[rec.effort];
  const isGsc = rec.source === "gsc";
  const gscMetrics = rec.whyNow?.gscMetrics;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-[#0a0a0f] border border-border/60 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 p-6 pb-4 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-border/40">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
              <CategoryIcon className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{rec.category}</span>
                <PriorityBadge priority={rec.priority} />
                {isGsc && <GscSourcePip />}
              </div>
              <h2 className="text-lg font-bold text-foreground leading-snug">{rec.title}</h2>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-accent transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {/* What happened */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">What happened?</h3>
            <p className="text-sm text-foreground/90 leading-relaxed">{rec.description}</p>
          </div>

          {/* GSC Performance Evidence */}
          {gscMetrics && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Evidence — Search Performance</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {gscMetrics.position !== undefined && gscMetrics.position > 0 && (
                  <div className="p-3 rounded-xl bg-accent/50 border border-border/40">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Position</div>
                    <div className="text-xl font-bold text-foreground">#{gscMetrics.position.toFixed(1)}</div>
                    {gscMetrics.previousPosition !== undefined && (
                      <div className={`text-[11px] font-medium mt-0.5 ${gscMetrics.previousPosition > gscMetrics.position ? "text-emerald-400" : "text-rose-400"}`}>
                        {gscMetrics.previousPosition > gscMetrics.position ? "↑" : "↓"} from #{gscMetrics.previousPosition.toFixed(1)}
                      </div>
                    )}
                  </div>
                )}
                {gscMetrics.impressions !== undefined && (
                  <div className="p-3 rounded-xl bg-accent/50 border border-border/40">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Impressions</div>
                    <div className="text-xl font-bold text-foreground">{gscMetrics.impressions.toLocaleString()}</div>
                  </div>
                )}
                {gscMetrics.clicks !== undefined && (
                  <div className="p-3 rounded-xl bg-accent/50 border border-border/40">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Clicks</div>
                    <div className="text-xl font-bold text-foreground">{gscMetrics.clicks.toLocaleString()}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Why this is an opportunity */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Why is this an opportunity?</h3>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <Target className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-emerald-300 leading-relaxed">{rec.impact}</p>
            </div>
          </div>

          {/* URL */}
          {rec.url && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Page</h3>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/40 border border-border/40">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground font-mono truncate">{rec.url}</span>
              </div>
            </div>
          )}

          {/* Execution Plan */}
          {rec.executionPlan && rec.executionPlan.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">What should I do?</h3>
              <div className="flex flex-col gap-2">
                {rec.executionPlan.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-accent/30 border border-border/30">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <span className="text-[11px] font-bold text-emerald-400">{step.step}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground">{step.action}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{step.expectedOutcome}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats grid */}
          {rec.stats && rec.stats.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Evidence Data</h3>
              <StatRow stats={rec.stats} />
            </div>
          )}

          {/* Effort */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Estimated effort:</span>
            <span className={`font-semibold ${effort.cls}`}>{effort.label}</span>
          </div>
        </div>

        {/* Action footer */}
        {isGsc && rec.opportunityId && (
          <div className="sticky bottom-0 flex items-center gap-3 p-6 pt-4 bg-[#0a0a0f]/95 backdrop-blur-sm border-t border-border/40">
            <button
              onClick={() => onApprove(rec.opportunityId!)}
              disabled={actionLoading === rec.opportunityId}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {actionLoading === rec.opportunityId ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Approve &amp; Execute
            </button>
            <button
              onClick={() => onDismiss(rec.opportunityId!)}
              disabled={actionLoading === rec.opportunityId}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-semibold transition-colors border border-zinc-700"
            >
              <XCircle className="w-4 h-4" />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Recommendation Card
// ────────────────────────────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  onReview,
  onApprove,
  onDismiss,
  actionLoading,
}: {
  rec: Recommendation;
  onReview: (rec: Recommendation) => void;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  actionLoading: string | null;
}) {
  const CategoryIcon = CATEGORY_ICONS[rec.category] ?? Lightbulb;
  const effort       = EFFORT_META[rec.effort];
  const isGsc        = rec.source === "gsc";

  return (
    <article className="card-surface p-5 flex flex-col gap-4 hover:border-border/80 transition-colors group">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-accent border border-border flex items-center justify-center shrink-0">
          <CategoryIcon className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {rec.category}
            </span>
            <PriorityBadge priority={rec.priority} />
            {isGsc && <GscSourcePip />}
            {rec.status && rec.status !== "ACTIVE" && <StatusBadge status={rec.status} />}
          </div>
          <h2 className="text-sm font-semibold text-foreground leading-snug">
            {rec.title}
          </h2>
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-muted-foreground leading-relaxed flex-1 line-clamp-3">
        {rec.description}
      </p>

      {/* GSC stats grid */}
      {rec.stats && rec.stats.length > 0 && <StatRow stats={rec.stats} />}

      {/* Impact chip */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
        <Rocket className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[12px] font-medium text-emerald-300">{rec.impact}</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className={`text-[11px] font-medium ${effort.cls}`}>
          {effort.label}
        </span>
        <div className="flex flex-wrap gap-1">
          {rec.tags.slice(0, 2).map((t) => (
            <span
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground border border-border"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      {isGsc && rec.opportunityId ? (
        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
          <a
            href={`/dashboard/recommendations/${rec.opportunityId}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            Review
          </a>
          <button
            onClick={() => onApprove(rec.opportunityId!)}
            disabled={actionLoading === rec.opportunityId}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
          >
            {actionLoading === rec.opportunityId ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Approve
          </button>
          <button
            onClick={() => onDismiss(rec.opportunityId!)}
            disabled={actionLoading === rec.opportunityId}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold text-zinc-500 hover:bg-zinc-500/10 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-3 h-3" />
          </button>
        </div>
      ) : rec.cta ? (
        <a
          href={rec.cta.href}
          {...(rec.cta.external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:text-emerald-400 transition-colors"
        >
          {rec.cta.label}
          {rec.cta.external ? (
            <ExternalLink className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          )}
        </a>
      ) : null}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Banners
// ────────────────────────────────────────────────────────────────────────────

function GscDisconnectedBanner({ domain }: { domain: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
      <PlugZap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-300 mb-0.5">
          GSC not connected for {domain}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Connect Google Search Console to unlock data-driven insights specific to your
          actual keywords, CTR gaps, and ranking opportunities.
        </p>
      </div>
      <a
        href="/dashboard/settings"
        className="shrink-0 text-[12px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
      >
        Connect →
      </a>
    </div>
  );
}

function SummaryBanner({ summary }: { summary: RecommendationResult["summary"] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {summary.criticalCount > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm font-medium text-rose-400">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
          {summary.criticalCount} critical{" "}
          {summary.criticalCount === 1 ? "action" : "actions"} needed
        </div>
      )}
      {summary.highCount > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm font-medium text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {summary.highCount} high-priority{" "}
          {summary.highCount === 1 ? "item" : "items"}
        </div>
      )}
      {summary.estimatedMissedClicks > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm font-medium text-emerald-400">
          <MousePointerClick className="w-3.5 h-3.5" />
          ~{summary.estimatedMissedClicks.toLocaleString()} clicks/month
          recoverable
        </div>
      )}
      {summary.monitoringCount > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-sm font-medium text-violet-400">
          <BarChart3 className="w-3.5 h-3.5" />
          {summary.monitoringCount} being monitored
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

interface RecommendationsDashboardProps {
  domain: string;
  result: RecommendationResult;
  gscConnected: boolean;
}

export function RecommendationsDashboard({
  domain,
  result,
  gscConnected,
}: RecommendationsDashboardProps) {
  const { recommendations, summary } = result;
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [reviewRec, setReviewRec] = useState<Recommendation | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [executedIds, setExecutedIds] = useState<Set<string>>(new Set());

  const filtered = recommendations.filter((rec) => {
    // Hide client-side dismissed/executed items
    if (rec.opportunityId && dismissedIds.has(rec.opportunityId)) return false;

    switch (activeFilter) {
      case "critical":
        return rec.priority === "critical";
      case "high":
        return rec.priority === "high";
      case "monitoring":
        return rec.status === "MONITORING" || rec.status === "EXECUTED" || (rec.opportunityId && executedIds.has(rec.opportunityId));
      default:
        return true;
    }
  });

  async function handleApprove(decisionId: string) {
    setActionLoading(decisionId);
    try {
      const res = await fetch(`/api/recommendations/${decisionId}/approve`, { method: "POST" });
      if (res.ok) {
        setExecutedIds((prev) => new Set(prev).add(decisionId));
        setReviewRec(null);
      }
    } catch { /* fail silently */ }
    setActionLoading(null);
  }

  async function handleDismiss(decisionId: string) {
    setActionLoading(decisionId);
    try {
      const res = await fetch(`/api/recommendations/${decisionId}/dismiss`, { method: "POST" });
      if (res.ok) {
        setDismissedIds((prev) => new Set(prev).add(decisionId));
        setReviewRec(null);
      }
    } catch { /* fail silently */ }
    setActionLoading(null);
  }

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: recommendations.filter((r) => !(r.opportunityId && dismissedIds.has(r.opportunityId))).length },
    { key: "critical", label: "Critical", count: summary.criticalCount },
    { key: "high", label: "High Priority", count: summary.highCount },
    { key: "monitoring", label: "Monitoring", count: summary.monitoringCount + executedIds.size },
  ];

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              SEO Opportunities — {domain}
            </h1>
            <p className="text-muted-foreground text-sm">
              {gscConnected
                ? `${summary.totalOpportunities} opportunities detected from your GSC data`
                : "Connect GSC to unlock data-driven recommendations for your keywords"}
            </p>
          </div>
        </div>
      </div>

      {/* GSC disconnected warning */}
      {!gscConnected && <GscDisconnectedBanner domain={domain} />}

      {/* Summary badges */}
      {(summary.criticalCount > 0 ||
        summary.highCount > 0 ||
        summary.estimatedMissedClicks > 0) && (
        <SummaryBanner summary={summary} />
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-accent/40 border border-border/40 w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
              activeFilter === tab.key
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-[11px] opacity-70">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Recommendation grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onReview={setReviewRec}
              onApprove={handleApprove}
              onDismiss={handleDismiss}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <Sparkles className="w-10 h-10 text-emerald-400" />
          <p className="text-lg font-semibold">You&apos;re all set!</p>
          <p className="text-muted-foreground text-sm max-w-sm">
            No recommendations right now. Check back after your next GSC data
            sync or after publishing new content.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        Recommendations are derived from your persisted GSC performance data · No live API calls on page load.
      </p>

      {/* Review Modal */}
      {reviewRec && (
        <ReviewModal
          rec={reviewRec}
          onClose={() => setReviewRec(null)}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}