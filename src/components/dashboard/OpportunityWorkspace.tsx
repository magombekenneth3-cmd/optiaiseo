"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Globe,
  Target,
  BarChart3,
  Sparkles,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
  Shield,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Rocket,
  Calendar,
  Clock,
  Layers,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface DecisionData {
  id: string;
  siteId: string;
  url: string;
  primaryKeyword: string;
  primaryCategory: string;
  opportunityCategories: string[];
  action: string;
  status: string;
  score: {
    final: number;
    impact: number;
    confidence: number;
    trafficPotential: number;
    businessValue: number;
    effort: number;
    components: {
      rankingOpportunity: number;
      trafficOpportunity: number;
      intentAlignment: number;
      businessAlignment: number;
      freshness: number;
      internalLinkOpportunity: number;
    };
  };
  whyNow: {
    signals: Array<{
      signal: string;
      severity: "HIGH" | "MEDIUM" | "LOW";
      evidence: string;
    }>;
    urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  };
  impact: {
    trafficPotential: { low: number; expected: number; high: number; confidence: number };
  };
  executionPlan: Array<{
    step: number;
    action: string;
    expectedOutcome: string;
  }>;
}

interface SerpAnalysisData {
  id: string;
  status: string;
  gapReport: any;
  implementationPlan: any;
  serpFormat: string | null;
  serpHasAiOverview: boolean;
  serpHasFeaturedSnippet: boolean;
  gapCount: number | null;
  criticalGapCount: number | null;
  competitorAvgWordCount: number | null;
  estimatedPositionGain: string | null;
  executiveSummary: string | null;
  topPriority: string | null;
  taskCount: number | null;
  automatedTaskCount: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface PerformancePoint {
  date: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface OpportunityWorkspaceProps {
  decision: DecisionData;
  domain: string;
  serpAnalysis: SerpAnalysisData | null;
  performanceTrend: PerformancePoint[];
}

// ────────────────────────────────────────────────────────────────────────────
// Display helpers
// ────────────────────────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<string, { cls: string; label: string }> = {
  CRITICAL: { cls: "bg-rose-500/10 text-rose-400 border-rose-500/30", label: "Critical" },
  HIGH:     { cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", label: "High" },
  MEDIUM:   { cls: "bg-blue-500/10 text-blue-400 border-blue-500/30", label: "Medium" },
  LOW:      { cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30", label: "Low" },
};

const SEVERITY_STYLE: Record<string, string> = {
  HIGH:   "text-rose-400",
  MEDIUM: "text-amber-400",
  LOW:    "text-zinc-400",
};

const GAP_SEVERITY_STYLE: Record<string, { cls: string; label: string }> = {
  critical: { cls: "bg-rose-500/10 text-rose-400 border-rose-500/20", label: "Critical" },
  high:     { cls: "bg-amber-500/10 text-amber-400 border-amber-500/20", label: "High" },
  medium:   { cls: "bg-blue-500/10 text-blue-400 border-blue-500/20", label: "Medium" },
  low:      { cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", label: "Low" },
};

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ────────────────────────────────────────────────────────────────────────────
// Mini sparkline (pure CSS bar chart)
// ────────────────────────────────────────────────────────────────────────────

function Sparkline({ data, valueKey, color }: { data: PerformancePoint[]; valueKey: "clicks" | "impressions" | "position"; color: string }) {
  if (data.length === 0) return <span className="text-xs text-muted-foreground">No data</span>;

  const values = data.map((d) => d[valueKey]);
  const max = Math.max(...values, 1);
  const isPosition = valueKey === "position";

  return (
    <div className="flex items-end gap-[2px] h-12">
      {data.map((d, i) => {
        const val = d[valueKey];
        const heightPct = isPosition
          ? Math.max(5, ((max - val) / max) * 100) // Lower position = taller bar
          : Math.max(5, (val / max) * 100);
        return (
          <div
            key={i}
            className={`rounded-t-sm ${color} transition-all`}
            style={{
              height: `${heightPct}%`,
              width: `${Math.max(2, Math.min(8, Math.floor(200 / data.length)))}px`,
              opacity: 0.6 + (i / data.length) * 0.4,
            }}
            title={`${d.date}: ${isPosition ? `#${val}` : val}`}
          />
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section wrapper
// ────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card-surface overflow-hidden">
      <button
        onClick={collapsible ? () => setOpen(!open) : undefined}
        className={`w-full flex items-center gap-3 p-5 pb-4 ${collapsible ? "cursor-pointer hover:bg-accent/20 transition-colors" : "cursor-default"}`}
      >
        <div className="w-8 h-8 rounded-lg bg-accent border border-border flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-emerald-400" />
        </div>
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wider flex-1 text-left">{title}</h2>
        {collapsible && (
          open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="px-5 pb-5 flex flex-col gap-4">{children}</div>}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Gap Report Renderer
// ────────────────────────────────────────────────────────────────────────────

function GapReportView({ gapReport }: { gapReport: any }) {
  if (!gapReport || !gapReport.gaps) return null;

  const gaps = gapReport.gaps as Array<{
    dimension: string;
    clientValue: string | number | boolean;
    topCompetitorAvg: string | number;
    gap: string;
    impact: string;
    recommendation: string;
  }>;

  return (
    <div className="flex flex-col gap-4">
      {/* SERP features */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent/50 border border-border/40 text-muted-foreground">
          <Layers className="w-3 h-3" />
          Format: {gapReport.serpFormat ?? "mixed"}
        </span>
        {gapReport.serpHasAiOverview && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
            <Sparkles className="w-3 h-3" /> AI Overview
          </span>
        )}
        {gapReport.serpHasFeaturedSnippet && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Target className="w-3 h-3" /> Featured Snippet
          </span>
        )}
      </div>

      {/* Competitor comparison */}
      {gapReport.topResults && gapReport.topResults.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left text-muted-foreground font-semibold py-2 pr-3">Page</th>
                <th className="text-right text-muted-foreground font-semibold py-2 px-2">Words</th>
                <th className="text-right text-muted-foreground font-semibold py-2 px-2">H2s</th>
                <th className="text-center text-muted-foreground font-semibold py-2 px-2">FAQ</th>
                <th className="text-center text-muted-foreground font-semibold py-2 px-2">Schema</th>
                <th className="text-center text-muted-foreground font-semibold py-2 px-2">Video</th>
              </tr>
            </thead>
            <tbody>
              {/* Client row */}
              {gapReport.clientSignals && (
                <tr className="border-b border-border/20 bg-emerald-500/5">
                  <td className="py-2 pr-3 font-medium text-emerald-400 truncate max-w-[200px]">
                    Your page
                  </td>
                  <td className="text-right py-2 px-2 font-mono">{gapReport.clientSignals.wordCount}</td>
                  <td className="text-right py-2 px-2 font-mono">{gapReport.clientSignals.h2s?.length ?? 0}</td>
                  <td className="text-center py-2 px-2">{gapReport.clientSignals.hasFaqSection ? "✅" : "❌"}</td>
                  <td className="text-center py-2 px-2">{gapReport.clientSignals.schemaTypes?.length > 0 ? "✅" : "❌"}</td>
                  <td className="text-center py-2 px-2">{gapReport.clientSignals.hasVideo ? "✅" : "❌"}</td>
                </tr>
              )}
              {/* Competitor rows */}
              {(gapReport.topResults as any[]).filter((r: any) => r.fetchedOk).slice(0, 5).map((comp: any, i: number) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-2 pr-3 text-muted-foreground truncate max-w-[200px]">
                    #{comp.position} {new URL(comp.url).hostname}
                  </td>
                  <td className="text-right py-2 px-2 font-mono">{comp.wordCount}</td>
                  <td className="text-right py-2 px-2 font-mono">{comp.h2s?.length ?? 0}</td>
                  <td className="text-center py-2 px-2">{comp.hasFaqSection ? "✅" : "❌"}</td>
                  <td className="text-center py-2 px-2">{comp.schemaTypes?.length > 0 ? "✅" : "❌"}</td>
                  <td className="text-center py-2 px-2">{comp.hasVideo ? "✅" : "❌"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Content gaps */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Content Gaps</h3>
        {gaps.map((gap, i) => {
          const style = GAP_SEVERITY_STYLE[gap.gap] ?? GAP_SEVERITY_STYLE.medium;
          return (
            <div key={i} className="p-3 rounded-xl bg-accent/30 border border-border/30">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${style.cls}`}>
                  {style.label}
                </span>
                <span className="text-[13px] font-semibold text-foreground">{gap.dimension}</span>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-2">{gap.impact}</p>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-rose-400">You: {String(gap.clientValue)}</span>
                <span className="text-emerald-400">Top competitors: {String(gap.topCompetitorAvg)}</span>
              </div>
              <p className="text-[12px] text-emerald-300/80 mt-2 leading-relaxed">{gap.recommendation}</p>
            </div>
          );
        })}
      </div>

      {/* Missing topics */}
      {gapReport.competitorTopicMap && gapReport.competitorTopicMap.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Missing Topics (H2s competitors cover that you don&apos;t)</h3>
          <div className="flex flex-wrap gap-2">
            {(gapReport.competitorTopicMap as any[]).slice(0, 10).map((t: any, i: number) => (
              <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/5 text-amber-400 border border-amber-500/15">
                &quot;{t.topic}&quot;
                <span className="text-[10px] text-muted-foreground">({t.mentionCount}×)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Implementation Plan Renderer
// ────────────────────────────────────────────────────────────────────────────

function ImplementationPlanView({ plan }: { plan: any }) {
  if (!plan || !plan.tasks) return null;

  const WEEK_LABELS = [plan.week1Focus, plan.week2Focus, plan.week3Focus, plan.week4Focus];

  return (
    <div className="flex flex-col gap-5">
      {/* Executive summary */}
      {plan.executiveSummary && (
        <div className="p-4 rounded-xl bg-accent/40 border border-border/40">
          <p className="text-[13px] text-foreground leading-relaxed">{plan.executiveSummary}</p>
        </div>
      )}

      {/* Top priority */}
      {plan.topPriority && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/5 border border-rose-500/15">
          <Target className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Top Priority</span>
            <p className="text-[13px] text-foreground">{plan.topPriority}</p>
          </div>
        </div>
      )}

      {/* Week-by-week tasks */}
      {[1, 2, 3, 4].map((week) => {
        const weekTasks = (plan.tasks as any[]).filter((t: any) => t.week === week);
        if (weekTasks.length === 0) return null;
        return (
          <div key={week} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Week {week}</h3>
              {WEEK_LABELS[week - 1] && (
                <span className="text-[11px] text-muted-foreground">— {WEEK_LABELS[week - 1]}</span>
              )}
            </div>
            {weekTasks.map((task: any, i: number) => {
              const prioStyle = GAP_SEVERITY_STYLE[task.priority] ?? GAP_SEVERITY_STYLE.medium;
              return (
                <div key={i} className="p-3 rounded-lg bg-accent/20 border border-border/20">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${prioStyle.cls}`}>
                      {task.priority}
                    </span>
                    <span className="text-[12px] font-semibold text-foreground">{task.title}</span>
                    {task.ariaCanAutomate && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        <Zap className="w-2.5 h-2.5" /> Auto
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {task.estimatedTimeMinutes}m
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{task.description}</p>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Content Blueprint */}
      {plan.contentBlueprint && plan.contentBlueprint.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            Content Blueprint — Sections to Add
          </h3>
          {(plan.contentBlueprint as any[]).map((section: any, i: number) => (
            <div key={i} className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <p className="text-[12px] font-semibold text-emerald-400 mb-1">H2: {section.section}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mb-1">{section.rationale}</p>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{section.guidanceNotes}</p>
              <span className="text-[10px] text-muted-foreground mt-1 block">Target: {section.targetWordCount} words</span>
            </div>
          ))}
        </div>
      )}

      {/* Authority Roadmap */}
      {plan.authorityRoadmap && plan.authorityRoadmap.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-amber-400" />
            Authority Roadmap — Link Building
          </h3>
          {(plan.authorityRoadmap as any[]).map((step: any, i: number) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-accent/20 border border-border/20">
              <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-amber-400">{step.step}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-foreground">{step.action}</span>
                  <span className="text-[10px] text-muted-foreground">{step.estimatedWeeks}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

export function OpportunityWorkspace({
  decision,
  domain,
  serpAnalysis,
  performanceTrend,
}: OpportunityWorkspaceProps) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState<"approve" | "dismiss" | "analyze" | null>(null);
  const [analysisState, setAnalysisState] = useState<SerpAnalysisData | null>(serpAnalysis);
  const [pollingId, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null);

  const urgency = URGENCY_STYLE[decision.whyNow.urgency] ?? URGENCY_STYLE.MEDIUM;

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleApprove() {
    setActionLoading("approve");
    try {
      const res = await fetch(`/api/recommendations/${decision.id}/approve`, { method: "POST" });
      if (res.ok) {
        router.push("/dashboard/recommendations");
        router.refresh();
      }
    } catch { /* fail silently */ }
    setActionLoading(null);
  }

  async function handleDismiss() {
    setActionLoading("dismiss");
    try {
      const res = await fetch(`/api/recommendations/${decision.id}/dismiss`, { method: "POST" });
      if (res.ok) {
        router.push("/dashboard/recommendations");
        router.refresh();
      }
    } catch { /* fail silently */ }
    setActionLoading(null);
  }

  async function handleRunAnalysis() {
    setActionLoading("analyze");
    try {
      const res = await fetch(`/api/recommendations/${decision.id}/analyze`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAnalysisState((prev) => prev
          ? { ...prev, id: data.analysisId, status: data.status }
          : { id: data.analysisId, status: data.status, gapReport: null, implementationPlan: null, serpFormat: null, serpHasAiOverview: false, serpHasFeaturedSnippet: false, gapCount: null, criticalGapCount: null, competitorAvgWordCount: null, estimatedPositionGain: null, executiveSummary: null, topPriority: null, taskCount: null, automatedTaskCount: null, errorMessage: null, completedAt: null, createdAt: new Date().toISOString() }
        );

        // Start polling for completion
        if (!data.alreadyExists || data.status !== "COMPLETED") {
          const id = setInterval(async () => {
            try {
              const pollRes = await fetch(`/api/recommendations/${decision.id}`);
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                if (pollData.serpAnalysis && (pollData.serpAnalysis.status === "COMPLETED" || pollData.serpAnalysis.status === "FAILED")) {
                  setAnalysisState(pollData.serpAnalysis);
                  clearInterval(id);
                  setPollingId(null);
                }
              }
            } catch { /* continue polling */ }
          }, 5000);
          setPollingId(id);
        } else if (data.alreadyExists && data.status === "COMPLETED") {
          // Already completed — refresh to get full data
          router.refresh();
        }
      }
    } catch { /* fail silently */ }
    setActionLoading(null);
  }

  const isAnalyzing = analysisState?.status === "PENDING" || analysisState?.status === "SCRAPING" || analysisState?.status === "PLANNING";
  const hasCompletedAnalysis = analysisState?.status === "COMPLETED" && analysisState?.gapReport;

  // ── Trend summary ───────────────────────────────────────────────────────

  const totalClicks = performanceTrend.reduce((s, d) => s + d.clicks, 0);
  const totalImpressions = performanceTrend.reduce((s, d) => s + d.impressions, 0);
  const avgPosition = performanceTrend.length > 0
    ? Math.round(performanceTrend.reduce((s, d) => s + d.position, 0) / performanceTrend.length * 10) / 10
    : 0;

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto pb-24">
      {/* Back button */}
      <button
        onClick={() => router.push("/dashboard/recommendations")}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Recommendations
      </button>

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="card-surface p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Target className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${urgency.cls}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${decision.whyNow.urgency === "CRITICAL" ? "bg-rose-400 animate-pulse" : "bg-current"}`} />
                {urgency.label} Urgency
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-accent/50 px-2 py-0.5 rounded border border-border/40">
                {formatCategory(decision.primaryCategory)}
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-accent/50 px-2 py-0.5 rounded border border-border/40">
                {formatCategory(decision.action)}
              </span>
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1">
              &quot;{decision.primaryKeyword}&quot;
            </h1>
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Globe className="w-3.5 h-3.5" />
              <span className="font-mono truncate">{decision.url}</span>
            </div>
          </div>
        </div>

        {/* Score chips */}
        <div className="flex flex-wrap gap-3 mt-5">
          <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-accent/40 border border-border/30 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Score</span>
            <span className="text-xl font-bold text-foreground">{decision.score.final}</span>
            <span className="text-[10px] text-muted-foreground">/100</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-accent/40 border border-border/30 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Traffic</span>
            <span className="text-xl font-bold text-emerald-400">{decision.impact.trafficPotential.expected}</span>
            <span className="text-[10px] text-muted-foreground">clicks/mo</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-accent/40 border border-border/30 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence</span>
            <span className="text-xl font-bold text-foreground">{decision.impact.trafficPotential.confidence}%</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-accent/40 border border-border/30 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Range</span>
            <span className="text-sm font-bold text-foreground">{decision.impact.trafficPotential.low}–{decision.impact.trafficPotential.high}</span>
            <span className="text-[10px] text-muted-foreground">clicks/mo</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 rounded-xl bg-accent/40 border border-border/30 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Effort</span>
            <span className={`text-xl font-bold ${decision.score.effort <= 30 ? "text-emerald-400" : decision.score.effort <= 60 ? "text-amber-400" : "text-rose-400"}`}>
              {decision.score.effort <= 30 ? "Low" : decision.score.effort <= 60 ? "Med" : "High"}
            </span>
          </div>
        </div>
      </div>

      {/* ─── Section 1: Performance Trend ────────────────────────────────── */}
      <Section title="30-Day Performance Trend" icon={BarChart3}>
        {performanceTrend.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-accent/30 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Clicks (30d)</div>
              <div className="text-2xl font-bold text-foreground mb-2">{totalClicks.toLocaleString()}</div>
              <Sparkline data={performanceTrend} valueKey="clicks" color="bg-emerald-400" />
            </div>
            <div className="p-4 rounded-xl bg-accent/30 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Impressions (30d)</div>
              <div className="text-2xl font-bold text-foreground mb-2">{totalImpressions.toLocaleString()}</div>
              <Sparkline data={performanceTrend} valueKey="impressions" color="bg-blue-400" />
            </div>
            <div className="p-4 rounded-xl bg-accent/30 border border-border/30">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Avg Position (30d)</div>
              <div className="text-2xl font-bold text-foreground mb-2">#{avgPosition}</div>
              <Sparkline data={performanceTrend} valueKey="position" color="bg-amber-400" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No GSC performance data for this URL in the last 30 days. Data populates after GSC sync.</p>
        )}
      </Section>

      {/* ─── Section 2: Why This Is an Opportunity ───────────────────────── */}
      <Section title="Why This Is an Opportunity" icon={AlertTriangle}>
        <div className="flex flex-col gap-3">
          {decision.whyNow.signals.map((sig, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-accent/20 border border-border/20">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sig.severity === "HIGH" ? "bg-rose-400" : sig.severity === "MEDIUM" ? "bg-amber-400" : "bg-zinc-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-bold text-foreground uppercase tracking-wider">
                    {sig.signal.replace(/_/g, " ")}
                  </span>
                  <span className={`text-[10px] font-semibold ${SEVERITY_STYLE[sig.severity]}`}>{sig.severity}</span>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{sig.evidence}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Execution plan from the decision */}
        {decision.executionPlan.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommended Actions</h3>
            {decision.executionPlan.map((step, i) => (
              <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-emerald-400">{step.step}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground">{step.action}</p>
                  <p className="text-[11px] text-muted-foreground">{step.expectedOutcome}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ─── Section 3: SERP Gap Analysis ────────────────────────────────── */}
      <Section title="SERP Gap Analysis" icon={FileSearch}>
        {hasCompletedAnalysis ? (
          <GapReportView gapReport={analysisState!.gapReport} />
        ) : isAnalyzing ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm font-semibold text-foreground">
              {analysisState?.status === "SCRAPING" ? "Scraping competitor pages..." : analysisState?.status === "PLANNING" ? "Generating implementation plan..." : "Starting analysis..."}
            </p>
            <p className="text-[13px] text-muted-foreground">This usually takes 30-60 seconds.</p>
          </div>
        ) : analysisState?.status === "FAILED" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <XCircle className="w-8 h-8 text-rose-400" />
            <p className="text-sm font-semibold text-rose-400">Analysis failed</p>
            <p className="text-[13px] text-muted-foreground">{analysisState.errorMessage || "An unexpected error occurred."}</p>
            <button
              onClick={handleRunAnalysis}
              disabled={actionLoading === "analyze"}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors mt-2"
            >
              <Search className="w-4 h-4" />
              Retry Analysis
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-14 h-14 rounded-2xl bg-accent border border-border flex items-center justify-center">
              <Search className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground mb-1">No SERP analysis yet</p>
              <p className="text-[13px] text-muted-foreground max-w-sm">
                Run a SERP gap analysis to see what the top-ranking pages are doing for
                &quot;{decision.primaryKeyword}&quot; and exactly how your page compares.
              </p>
            </div>
            <button
              onClick={handleRunAnalysis}
              disabled={actionLoading === "analyze"}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {actionLoading === "analyze" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Run SERP Analysis
            </button>
          </div>
        )}
      </Section>

      {/* ─── Section 4: Implementation Plan ──────────────────────────────── */}
      {hasCompletedAnalysis && analysisState!.implementationPlan && (
        <Section title="Implementation Plan" icon={BookOpen} collapsible defaultOpen={false}>
          <ImplementationPlanView plan={analysisState!.implementationPlan} />
        </Section>
      )}

      {/* ─── Score Breakdown ─────────────────────────────────────────────── */}
      <Section title="Score Breakdown" icon={BarChart3} collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(decision.score.components).map(([key, value]) => (
            <div key={key} className="p-3 rounded-lg bg-accent/20 border border-border/20">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${Math.min(100, value)}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-foreground w-8 text-right">{value}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ─── Sticky Action Bar ───────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/40 bg-[#0a0a0f]/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[13px] font-semibold text-foreground truncate">
              &quot;{decision.primaryKeyword}&quot;
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${urgency.cls}`}>
              {urgency.label}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleDismiss}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-semibold transition-colors border border-zinc-700"
            >
              <XCircle className="w-4 h-4" />
              Dismiss
            </button>
            <button
              onClick={handleApprove}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold transition-colors"
            >
              {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Approve &amp; Execute
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
