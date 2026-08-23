"use client";

import { useState } from "react";
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  BarChart3,
  Globe,
  Target,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
  DollarSign,
  MousePointerClick,
  Eye,
  Activity,
  Filter,
  AlertTriangle,
  Shield,
  Zap,
  LayoutGrid,
} from "lucide-react";
import type { BaselineMetrics, LiftMetrics } from "@/lib/experiments/tracker";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ExperimentData {
  id: string;
  executedAt: string;
  evaluationDate: string;
  status: string;
  baseline: BaselineMetrics;
  lift: LiftMetrics | null;
  daysElapsed: number;
  daysRemaining: number;
  isReadyForEvaluation: boolean;
}

interface MergedExperiment {
  decisionId: string;
  url: string;
  primaryKeyword: string;
  primaryCategory: string;
  action: string;
  scoreFinal: number;
  trafficPotential: number;
  experiment: ExperimentData | null;
}

interface ExperimentsSummary {
  totalExecuted: number;
  completedEvaluations: number;
  pendingEvaluations: number;
  inProgress: number;
  avgPositionGain: number;
  avgClicksLift: number;
  totalRevenueLift: number;
}

interface ActionInsight {
  action: string;
  totalExperiments: number;
  completedExperiments: number;
  avgPositionDelta: number;
  avgClicksLiftPercent: number;
  successRate: number;
  totalRevenueLift: number;
  label: string;
}

interface GscAlert {
  severity: "warning" | "critical";
  message: string;
  suggestion: string;
}

interface GscHealthData {
  lastSyncDate: string | null;
  daysSinceSync: number;
  totalDaysTracked: number;
  missingDaysLast30: number;
  dataFreshness: "fresh" | "stale" | "missing";
  healthLabel: string;
  alerts: GscAlert[];
}

interface InsightsData {
  totalExperiments: number;
  totalCompleted: number;
  byAction: ActionInsight[];
  bestAction: ActionInsight | null;
  worstAction: ActionInsight | null;
  recentTrend: string;
  recentTrendLabel: string;
}

interface ExperimentsDashboardProps {
  domain: string;
  siteId: string;
  experiments: MergedExperiment[];
  summary: ExperimentsSummary;
  insights?: InsightsData;
  gscHealth?: GscHealthData;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function LiftIndicator({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const isPositive = invert ? value < 0 : value > 0;
  const isNeutral = value === 0;

  if (isNeutral) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-400 text-sm font-semibold">
        <Minus className="w-3.5 h-3.5" /> 0{suffix}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
      {isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {value > 0 ? "+" : ""}{value}{suffix}
    </span>
  );
}

function ProgressRing({ progress, size = 48 }: { progress: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;
  const isComplete = progress >= 100;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={3} fill="none" className="stroke-accent" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={3} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className={isComplete ? "stroke-emerald-400" : "stroke-blue-400"}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {isComplete ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <span className="text-[10px] font-bold text-foreground">{Math.round(progress)}%</span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Summary Header
// ────────────────────────────────────────────────────────────────────────────

function SummaryHeader({ summary }: { summary: ExperimentsSummary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="card-surface p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-blue-400" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Executed</span>
        </div>
        <span className="text-2xl font-bold text-foreground">{summary.totalExecuted}</span>
        <span className="text-[11px] text-muted-foreground">
          {summary.inProgress} in progress · {summary.pendingEvaluations} ready
        </span>
      </div>

      <div className="card-surface p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Position Gain</span>
        </div>
        <span className="text-2xl font-bold text-foreground">
          {summary.avgPositionGain > 0 ? "+" : ""}{summary.avgPositionGain}
        </span>
        <span className="text-[11px] text-muted-foreground">
          positions (observed, {summary.completedEvaluations} evaluated)
        </span>
      </div>

      <div className="card-surface p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <MousePointerClick className="w-4 h-4 text-amber-400" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Clicks Lift</span>
        </div>
        <span className="text-2xl font-bold text-foreground">
          {summary.avgClicksLift > 0 ? "+" : ""}{summary.avgClicksLift}%
        </span>
        <span className="text-[11px] text-muted-foreground">observed after optimization</span>
      </div>

      <div className="card-surface p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue Impact</span>
        </div>
        <span className="text-2xl font-bold text-foreground">
          ${summary.totalRevenueLift.toLocaleString()}
        </span>
        <span className="text-[11px] text-muted-foreground">estimated at $7/click</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Experiment Card
// ────────────────────────────────────────────────────────────────────────────

function ExperimentCard({
  exp,
  onEvaluate,
  evaluating,
}: {
  exp: MergedExperiment;
  onEvaluate: (id: string) => void;
  evaluating: string | null;
}) {
  const ex = exp.experiment;
  const progress = ex ? Math.min(100, (ex.daysElapsed / 28) * 100) : 0;
  const isComplete = ex?.status === "COMPLETED" && ex.lift;
  const isReady = ex?.isReadyForEvaluation;
  const hasBaseline = ex && ex.baseline.impressions > 0;

  return (
    <article className="card-surface p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        {ex ? (
          <ProgressRing progress={progress} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-accent border border-border flex items-center justify-center">
            <Clock className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {formatAction(exp.action)}
            </span>
            {isComplete && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> Evaluated
              </span>
            )}
            {isReady && !isComplete && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                <Activity className="w-3 h-3" /> Ready
              </span>
            )}
            {ex && !isComplete && !isReady && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Clock className="w-3 h-3" /> {ex.daysRemaining}d remaining
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">
            &quot;{exp.primaryKeyword}&quot;
          </h3>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
            <Globe className="w-3 h-3" />
            <span className="truncate font-mono">{exp.url}</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      {ex && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Executed: {formatDate(ex.executedAt)}</span>
          <span className="text-border">→</span>
          <span>Evaluation: {formatDate(ex.evaluationDate)}</span>
          <span className="text-border">·</span>
          <span>Day {Math.min(ex.daysElapsed, 28)}/28</span>
        </div>
      )}

      {/* Metrics comparison */}
      {ex && hasBaseline && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Position */}
          <div className="p-3 rounded-xl bg-accent/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Position</div>
            <div className="text-lg font-bold text-foreground">
              #{ex.baseline.position > 0 ? ex.baseline.position : "—"}
            </div>
            {isComplete && ex.lift && (
              <LiftIndicator value={ex.lift.positionDelta} suffix=" pos" />
            )}
          </div>

          {/* Clicks */}
          <div className="p-3 rounded-xl bg-accent/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Clicks (28d)</div>
            <div className="text-lg font-bold text-foreground">{ex.baseline.clicks.toLocaleString()}</div>
            {isComplete && ex.lift && (
              <LiftIndicator value={ex.lift.clicksLiftPercent} suffix="%" />
            )}
          </div>

          {/* Impressions */}
          <div className="p-3 rounded-xl bg-accent/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Impressions</div>
            <div className="text-lg font-bold text-foreground">{ex.baseline.impressions.toLocaleString()}</div>
            {isComplete && ex.lift && (
              <LiftIndicator value={ex.lift.impressionsLiftPercent} suffix="%" />
            )}
          </div>

          {/* CTR */}
          <div className="p-3 rounded-xl bg-accent/30 border border-border/30">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">CTR</div>
            <div className="text-lg font-bold text-foreground">{ex.baseline.ctr}%</div>
            {isComplete && ex.lift && (
              <LiftIndicator value={ex.lift.ctrLiftPercent} suffix="pp" />
            )}
          </div>
        </div>
      )}

      {/* No baseline data */}
      {ex && !hasBaseline && (
        <div className="p-3 rounded-lg bg-accent/20 border border-border/20 text-[12px] text-muted-foreground">
          Baseline pending — GSC data will populate after the next daily sync.
        </div>
      )}

      {/* No experiment record */}
      {!ex && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10 text-[12px] text-amber-400">
          Approved but no experiment baseline recorded yet. This may resolve after re-execution.
        </div>
      )}

      {/* Completed result summary */}
      {isComplete && ex.lift && (
        <div className={`p-3 rounded-xl border ${ex.lift.clicksLiftPercent > 0 ? "bg-emerald-500/5 border-emerald-500/15" : "bg-rose-500/5 border-rose-500/15"}`}>
          <div className="flex items-start gap-2">
            {ex.lift.clicksLiftPercent > 0 ? (
              <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <TrendingDown className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-[13px] font-medium text-foreground">
                {ex.lift.clicksLiftPercent > 0
                  ? `Observed improvement: +${ex.lift.clicksLiftPercent}% clicks, position moved ${ex.lift.positionDelta > 0 ? "up" : "down"} by ${Math.abs(ex.lift.positionDelta)} positions`
                  : `No measurable improvement observed in the 28-day window. Position changed by ${ex.lift.positionDelta} positions.`}
              </p>
              {ex.lift.revenueLiftAmount !== 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Estimated revenue impact: {ex.lift.revenueLiftAmount > 0 ? "+" : ""}${ex.lift.revenueLiftAmount.toLocaleString()}/mo
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Evaluate button */}
      {isReady && !isComplete && (
        <button
          onClick={() => onEvaluate(ex!.id)}
          disabled={evaluating === ex!.id}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          {evaluating === ex!.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <BarChart3 className="w-4 h-4" />
          )}
          Evaluate 28-Day Results
        </button>
      )}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

export function ExperimentsDashboard({
  domain,
  siteId,
  experiments,
  summary,
  insights,
  gscHealth,
}: ExperimentsDashboardProps) {
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [experimentList, setExperimentList] = useState(experiments);
  const [summaryData, setSummaryData] = useState(summary);
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  async function handleEvaluate(experimentId: string) {
    setEvaluating(experimentId);
    try {
      const res = await fetch(`/api/experiments/${experimentId}/evaluate`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.experiment) {
          setExperimentList((prev) =>
            prev.map((exp) => {
              if (exp.experiment?.id === experimentId) {
                return {
                  ...exp,
                  experiment: {
                    ...exp.experiment,
                    status: data.experiment.status,
                    lift: data.experiment.lift,
                    isReadyForEvaluation: false,
                  },
                };
              }
              return exp;
            })
          );

          if (data.experiment.status === "COMPLETED" && data.experiment.lift) {
            setSummaryData((prev) => ({
              ...prev,
              completedEvaluations: prev.completedEvaluations + 1,
              pendingEvaluations: Math.max(0, prev.pendingEvaluations - 1),
            }));
          }
        }
      }
    } catch { /* fail silently */ }
    setEvaluating(null);
  }

  // Filtering
  const actionTypes = [...new Set(experimentList.map((e) => e.action))];
  const filteredExperiments = experimentList.filter((exp) => {
    if (filterAction !== "ALL" && exp.action !== filterAction) return false;
    if (filterStatus === "COMPLETED" && exp.experiment?.status !== "COMPLETED") return false;
    if (filterStatus === "IN_PROGRESS" && (exp.experiment?.status === "COMPLETED" || !exp.experiment)) return false;
    if (filterStatus === "READY" && !exp.experiment?.isReadyForEvaluation) return false;
    return true;
  });

  const hasExperiments = experimentList.length > 0;

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <FlaskConical className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Experiments — {domain}</h1>
          <p className="text-muted-foreground text-sm">
            {hasExperiments
              ? `Tracking ${summary.totalExecuted} optimization${summary.totalExecuted === 1 ? "" : "s"} with 28-day before/after measurement`
              : "Execute recommendations to start tracking experiments"}
          </p>
        </div>
      </div>

      {/* GSC Health Banner */}
      {gscHealth && gscHealth.alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {gscHealth.alerts.map((alert, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-xl border ${
                alert.severity === "critical"
                  ? "bg-rose-500/5 border-rose-500/20"
                  : "bg-amber-500/5 border-amber-500/20"
              }`}
            >
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                alert.severity === "critical" ? "text-rose-400" : "text-amber-400"
              }`} />
              <div>
                <p className={`text-[13px] font-medium ${
                  alert.severity === "critical" ? "text-rose-300" : "text-amber-300"
                }`}>
                  {alert.message}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{alert.suggestion}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GSC Health Status Bar */}
      {gscHealth && gscHealth.dataFreshness !== "missing" && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-accent/30 border border-border/30">
          <Shield className={`w-4 h-4 ${
            gscHealth.dataFreshness === "fresh" ? "text-emerald-400" : "text-amber-400"
          }`} />
          <span className="text-[12px] text-muted-foreground">{gscHealth.healthLabel}</span>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {gscHealth.totalDaysTracked}/30 days tracked
          </span>
        </div>
      )}

      {/* Summary */}
      {hasExperiments && <SummaryHeader summary={summaryData} />}

      {/* Cross-Experiment Insights Panel */}
      {insights && insights.totalCompleted >= 2 && (
        <div className="card-surface p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Cross-Experiment Insights</h2>
          </div>

          {/* Trend indicator */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
            insights.recentTrend === "improving"
              ? "bg-emerald-500/5 border-emerald-500/20"
              : insights.recentTrend === "declining"
                ? "bg-rose-500/5 border-rose-500/20"
                : "bg-accent/30 border-border/30"
          }`}>
            {insights.recentTrend === "improving" ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : insights.recentTrend === "declining" ? (
              <TrendingDown className="w-4 h-4 text-rose-400" />
            ) : (
              <Activity className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-[12px] text-muted-foreground">{insights.recentTrendLabel}</span>
          </div>

          {/* Action breakdown table */}
          {insights.byAction.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-muted-foreground text-left border-b border-border/30">
                    <th className="pb-2 font-medium">Action Type</th>
                    <th className="pb-2 font-medium text-center">Experiments</th>
                    <th className="pb-2 font-medium text-center">Success Rate</th>
                    <th className="pb-2 font-medium text-center">Avg Clicks Lift</th>
                    <th className="pb-2 font-medium text-center">Avg Position Δ</th>
                    <th className="pb-2 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.byAction.map((a) => (
                    <tr key={a.action} className="border-b border-border/10">
                      <td className="py-2 font-medium text-foreground">
                        {a.action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </td>
                      <td className="py-2 text-center text-muted-foreground">
                        {a.completedExperiments}/{a.totalExperiments}
                      </td>
                      <td className="py-2 text-center">
                        {a.completedExperiments > 0 ? (
                          <span className={`font-semibold ${
                            a.successRate >= 70 ? "text-emerald-400" :
                            a.successRate >= 40 ? "text-amber-400" : "text-rose-400"
                          }`}>
                            {a.successRate}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
                        {a.completedExperiments > 0 ? (
                          <LiftIndicator value={a.avgClicksLiftPercent} suffix="%" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
                        {a.completedExperiments > 0 ? (
                          <LiftIndicator value={a.avgPositionDelta} suffix=" pos" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono text-muted-foreground">
                        {a.totalRevenueLift > 0 ? `+$${a.totalRevenueLift.toLocaleString()}` : a.totalRevenueLift < 0 ? `-$${Math.abs(a.totalRevenueLift).toLocaleString()}` : "$0"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Best/worst action callout */}
          {insights.bestAction && insights.bestAction.completedExperiments >= 2 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
              <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-emerald-300">{insights.bestAction.label}</p>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      {hasExperiments && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Filter</span>
          </div>

          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="text-[12px] px-2.5 py-1.5 rounded-lg bg-accent border border-border text-foreground"
          >
            <option value="ALL">All Actions</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-[12px] px-2.5 py-1.5 rounded-lg bg-accent border border-border text-foreground"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="READY">Ready for Evaluation</option>
          </select>

          <span className="text-[11px] text-muted-foreground ml-auto">
            {filteredExperiments.length} of {experimentList.length} shown
          </span>
        </div>
      )}

      {/* Experiment cards */}
      {hasExperiments ? (
        filteredExperiments.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredExperiments.map((exp) => (
              <ExperimentCard
                key={exp.decisionId}
                exp={exp}
                onEvaluate={handleEvaluate}
                evaluating={evaluating}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <LayoutGrid className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No experiments match the current filters</p>
          </div>
        )
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <FlaskConical className="w-10 h-10 text-blue-400" />
          <p className="text-lg font-semibold">No experiments yet</p>
          <p className="text-muted-foreground text-sm max-w-sm">
            Approve and execute a recommendation to start a 28-day experiment.
            Baseline metrics are captured automatically.
          </p>
          <a
            href={`/dashboard/recommendations?siteId=${siteId}`}
            className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <Target className="w-4 h-4" />
            View Recommendations
          </a>
        </div>
      )}

      {/* Disclaimer */}
      {hasExperiments && (
        <p className="text-xs text-muted-foreground text-center pb-4">
          Experiment results show <strong>observed changes</strong> in the 28-day period following optimization.
          Correlation does not imply causation — external factors (algorithm updates, seasonality, competitor actions) may also contribute.
        </p>
      )}
    </div>
  );
}
