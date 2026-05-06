"use client";

import {
  Lightbulb,
  ExternalLink,
  ChevronRight,
  Zap,
  Globe,
  Code2,
  TrendingUp,
  Shield,
  Rocket,
  BookOpen,
  MousePointerClick,
  Trophy,
  Sparkles,
  PlugZap,
} from "lucide-react";
import type {
  Recommendation,
  RecommendationPriority,
  RecommendationEffort,
  RecommendationResult,
} from "@/lib/recommendations/engine";

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

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
  "Click-Through Rate":  MousePointerClick,
  "Ranking Opportunity": TrendingUp,
  "Featured Snippets":   Trophy,
  "Quick Wins":          Sparkles,
  "Data Sources":        Globe,
  "Developer Workflow":  Code2,
  "AI Visibility":       Zap,
  "Content Health":      TrendingUp,
  "SEO Strategy":        BookOpen,
  "Technical SEO":       Shield,
  "Content Strategy":    BookOpen,
  "AI Voice":            Lightbulb,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function GscSourcePip() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wide">
      GSC
    </span>
  );
}

function StatRow({
  stats,
}: {
  stats: NonNullable<Recommendation["stats"]>;
}) {
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

function RecommendationCard({ rec }: { rec: Recommendation }) {
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
          </div>
          <h2 className="text-sm font-semibold text-foreground leading-snug">
            {rec.title}
          </h2>
        </div>
      </div>

      {/* Description */}
      <p className="text-[13px] text-muted-foreground leading-relaxed flex-1">
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

      {/* CTA */}
      {rec.cta && (
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
      )}
    </article>
  );
}

function GscDisconnectedBanner({ domain }: { domain: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
      <PlugZap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-300 mb-0.5">
          GSC not connected for {domain}
        </p>
        <p className="text-[13px] text-muted-foreground">
          The recommendations below are based on your site setup only. Connect
          Google Search Console to unlock data-driven insights specific to your
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

function SummaryBanner({
  summary,
}: {
  summary: RecommendationResult["summary"];
}) {
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

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
              Recommendations — {domain}
            </h1>
            <p className="text-muted-foreground text-sm">
              {gscConnected
                ? `Derived from your live GSC data · ${summary.totalOpportunities} keyword opportunities analysed`
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

      {/* Recommendation grid */}
      {recommendations.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
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
        Recommendations refresh on each page load using live GSC data.
      </p>
    </div>
  );
}