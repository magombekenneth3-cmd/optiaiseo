"use client";

import { useState, useEffect, useCallback } from "react";
import type { CitationGap, CitationGapReport, GapReason } from "@/lib/aeo/citation-gap";

// ─── Display helpers ──────────────────────────────────────────────────────────

// Inlined here (not imported from @/lib/aeo/citation-gap which imports prisma)
const REASON_LABELS: Record<GapReason, string> = {
  missing_faq_schema:      "Missing FAQ Schema",
  no_definition_sentence:  "No Definition Sentence",
  content_too_thin:        "Content Too Thin",
  missing_structured_data: "Missing Structured Data",
  weak_authority_signals:  "Weak Authority Signals",
  poor_entity_coverage:    "Poor Entity Coverage",
  no_comparison_content:   "No Comparison Content",
  missing_stats_or_data:   "Missing Stats / Data",
};

const IMPACT_CONFIG = {
  high: { label: "High impact", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20" },
  medium: { label: "Medium impact", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  low: { label: "Low impact", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
};

function ImpactBadge({ impact }: { impact: CitationGap["impact"] }) {
  const cfg = IMPACT_CONFIG[impact];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border} shrink-0`}>
      {cfg.label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors shrink-0"
    >
      {copied ? "Copied" : "Copy fix"}
    </button>
  );
}

// ─── Gap card ─────────────────────────────────────────────────────────────────

function GapCard({ gap }: { gap: CitationGap }) {
  const [expanded, setExpanded] = useState(false);
  const topComp = gap.topCompetitorCiting;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors"
      >
        <ImpactBadge impact={gap.impact} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">"{gap.keyword}"</span>
            {topComp && (
              <span className="text-xs text-muted-foreground shrink-0">
                — {topComp.domain} cited
                {topComp.citationPosition ? ` at #${topComp.citationPosition}` : ""}
              </span>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {REASON_LABELS[gap.gapReason]}
            </span>
          </div>
        </div>
        <span className="text-muted-foreground text-xs shrink-0 mt-0.5">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-muted/20">
          {/* Why the gap exists */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Why this gap exists</p>
            <p className="text-sm leading-relaxed">{gap.explanation}</p>
          </div>

          {/* The fix */}
          <div className="bg-background rounded-lg p-3 border border-border">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-emerald-500">Recommended fix</p>
              <CopyButton text={gap.fix} />
            </div>
            <p className="text-sm leading-relaxed">{gap.fix}</p>
          </div>

          {/* Embedding gap signals — missing concepts from semantic analysis */}
          {gap.embeddingGapSignals && gap.embeddingGapSignals.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Missing concepts (semantic gap)</p>
              <div className="flex flex-wrap gap-1.5">
                {gap.embeddingGapSignals.map((signal) => (
                  <a
                    key={signal}
                    href={`/dashboard/blogs/new?addSection=${encodeURIComponent(signal)}&keyword=${encodeURIComponent(gap.keyword)}`}
                    className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full hover:bg-red-500/20 transition-colors"
                    title={`Click to open blog editor pre-seeded to add: ${signal}`}
                  >
                    {signal}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Top competitor */}
          {topComp && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Top competitor cited for this keyword
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{topComp.domain}</span>
                <div className="flex items-center gap-2">
                  {topComp.citationPosition && (
                    <span className="text-muted-foreground">Position #{topComp.citationPosition}</span>
                  )}
                  {topComp.citedUrl && (
                    <a
                      href={topComp.citedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      View page →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Citation status */}
          <div className="text-xs text-muted-foreground">
            {gap.yourPosition !== null ? (
              <span className="text-emerald-500">
                ✓ You appear at position #{gap.yourPosition} — but competitors rank higher.
              </span>
            ) : (
              <span className="text-rose-400">
                ✗ You are not cited for "{gap.keyword}" by any tracked AI engine.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type LoadState =
  | { status: "idle" }
  | { status: "loading-cached" }
  | { status: "running-full" }
  | { status: "done"; report: CitationGapReport; source: "live" | "cached" }
  | { status: "error"; message: string };

interface CitationGapPanelProps {
  siteId: string;
  /** Pre-check: does this site have competitors set up? */
  hasCompetitors: boolean;
}

export function CitationGapPanel({ siteId, hasCompetitors }: CitationGapPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  // Auto-load cached gaps on mount
  const loadCached = useCallback(async () => {
    setState({ status: "loading-cached" });
    try {
      const res = await fetch(`/api/aeo/citation-gap?siteId=${siteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");

      // Shape cached data into a minimal CitationGapReport
      setState({
        status: "done",
        source: "cached",
        report: {
          siteId,
          domain: data.domain ?? "",
          gapCount: data.gapCount ?? 0,
          gaps: (data.gaps ?? []).map(
            (g: { keyword: string; competitor: string; models: string[] }) => ({
              keyword: g.keyword,
              yourPosition: null,
              topCompetitorCiting: g.competitor
                ? { domain: g.competitor, citationPosition: null, citedUrl: `https://${g.competitor}` }
                : null,
              affectedModels: g.models ?? [],
              gapReason: "missing_faq_schema" as GapReason,
              explanation: "Run a full analysis to get detailed gap reasoning and a specific fix.",
              fix: "Run a full analysis to get a specific, actionable fix for this keyword.",
              searchVolume: 0,
              impact: "medium" as const,
              embeddingGapSignals: [] as string[],
              source: "cached" as const,
            })
          ),
          summary: {
            highImpactGaps: 0,
            topGapReason: null,
            topCompetitorWinning: null,
          },
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (e: unknown) {
      setState({ status: "error", message: (e as Error).message });
    }
  }, [siteId]);

  useEffect(() => {
    if (hasCompetitors) loadCached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const runFullAnalysis = async () => {
    setState({ status: "running-full" });
    try {
      const res = await fetch("/api/aeo/citation-gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, maxKeywords: 20 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");

      setState({ status: "done", source: "live", report: data as CitationGapReport });
    } catch (e: unknown) {
      setState({ status: "error", message: (e as Error).message });
    }
  };

  if (!hasCompetitors) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
        <p className="font-medium mb-2">Citation Gap Analysis</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Add competitors in the Competitors section to enable Citation Gap Analysis.
          We'll show you exactly which keywords your competitors are being cited for
          in AI engines — and you're not.
        </p>
      </div>
    );
  }

  const report = state.status === "done" ? state.report : null;
  const filteredGaps = report?.gaps.filter(
    (g) => filter === "all" || g.impact === filter
  ) ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Citation gap analysis</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Keywords where your competitors are cited by AI engines and you aren't.
          </p>
        </div>
        <button
          onClick={runFullAnalysis}
          disabled={state.status === "running-full" || state.status === "loading-cached"}
          className="shrink-0 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {state.status === "running-full"
            ? "Analysing…"
            : state.status === "done" && state.source === "live"
              ? "Re-run analysis"
              : "Run full analysis"}
        </button>
      </div>

      {/* Error state */}
      {state.status === "error" && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {/* Loading states */}
      {(state.status === "loading-cached" || state.status === "running-full") && (
        <div className="rounded-xl border bg-muted/20 p-8 text-center">
          <p className="text-sm font-medium">
            {state.status === "running-full"
              ? "Running full analysis — checking ~20 keywords across Perplexity and historical model data…"
              : "Loading cached gap data…"}
          </p>
          {state.status === "running-full" && (
            <p className="text-xs text-muted-foreground mt-2">
              This typically takes 60–90 seconds. Each keyword requires a live Perplexity check.
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {state.status === "done" && report && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-xl font-medium">{report.gapCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Citation gaps found
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-xl font-medium text-red-400">
                {report.summary.highImpactGaps}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                High-impact gaps
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-sm font-medium truncate">
                {report.summary.topCompetitorWinning ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Top competing domain
              </div>
            </div>
          </div>

          {/* Lift estimate */}
          {report.gapCount > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-xs font-medium text-emerald-500 mb-0.5">
                Estimated impact if fixed
              </p>
              <p className="text-sm">
                {report.summary.highImpactGaps > 0
                  ? `Fixing ${report.summary.highImpactGaps} high-impact gap${report.summary.highImpactGaps > 1 ? "s" : ""} could meaningfully improve your AI citation rate.`
                  : `${report.gapCount} citation gap${report.gapCount > 1 ? "s" : ""} found — run fixes to improve your AI visibility.`}
              </p>
            </div>
          )}

          {/* Source note */}
          {state.source === "cached" && report.gapCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Showing historical gaps from the last 30 days. Run a full analysis
              for detailed reasoning and specific fixes per keyword.
            </p>
          )}

          {/* No gaps found */}
          {report.gapCount === 0 && (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <p className="font-medium mb-1">No citation gaps detected</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Your site is holding its own against tracked competitors in AI engine
                citations. Run again next week to stay on top of any changes.
              </p>
            </div>
          )}

          {/* Filter bar */}
          {report.gapCount > 0 && (
            <div className="flex gap-2">
              {(["all", "high", "medium", "low"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={[
                    "text-xs px-3 py-1.5 rounded-lg border transition-colors capitalize",
                    filter === f
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted",
                  ].join(" ")}
                >
                  {f === "all" ? `All (${report.gapCount})` : f}
                </button>
              ))}
            </div>
          )}

          {/* Gap cards */}
          <div className="space-y-2">
            {filteredGaps.map((gap, i) => (
              <GapCard key={`${gap.keyword}-${i}`} gap={gap} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}