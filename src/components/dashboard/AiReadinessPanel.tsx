"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Globe,
  Loader2,
  Microscope,
  Shield,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

interface PlatformScores {
  perplexity: number;
  chatgpt: number;
  claude: number;
  googleAio: number;
  grok: number;
  copilot: number;
}

interface Dimensions {
  technicalReadiness: number | null;
  contentReadiness: number | null;
  aiVisibility: number | null;
  citationQuality: number | null;
}

interface Confidence {
  level: string | null;
  score: number | null;
  successfulProviders: number | null;
  totalProviders: number | null;
}

interface TrendPoint {
  score: number;
  citationScore: number;
  technicalReadiness: number | null;
  contentReadiness: number | null;
  aiVisibility: number | null;
  citationQuality: number | null;
  createdAt: string;
}

interface AiReadinessData {
  aeoReport: {
    score: number;
    grade: string;
    citationScore: number;
    citationLikelihood: number;
    generativeShareOfVoice: number;
    schemaTypes: string[];
    topRecommendations: string[];
    layerScores: { aeo?: number; geo?: number; aio?: number } | null;
    dimensions: Dimensions | null;
    confidence: Confidence | null;
    createdAt: string;
  } | null;
  snapshot: {
    score: number;
    grade: string;
    citationScore: number;
    generativeShareOfVoice: number;
    citationLikelihood: number;
    platforms: PlatformScores;
    dimensions: Dimensions;
    confidence: Confidence;
    failedChecks: unknown;
    createdAt: string;
  } | null;
  citations: { thisMonth: number; total: number };
  trend: TrendPoint[];
  diagnosticReadiness: { unresolvedAiFindings: number } | null;
  siteId: string | null;
  domain: string | null;
}

function scoreColor(s: number) {
  return s >= 65 ? "text-emerald-400" : s >= 40 ? "text-amber-400" : "text-rose-400";
}

function scoreBg(s: number) {
  return s >= 65 ? "bg-emerald-500" : s >= 40 ? "bg-amber-500" : "bg-rose-500";
}

function gradeStyle(g: string) {
  const map: Record<string, string> = {
    A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    F: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  };
  return map[g] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10";
}

function confidenceLabel(level: string | null) {
  if (!level) return "Unknown";
  const map: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
  return map[level] ?? level;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="h-3 w-24 rounded bg-muted/40 mb-3" />
      <div className="h-6 w-16 rounded bg-muted/30 mb-2" />
      <div className="h-2 w-full rounded bg-muted/20" />
    </div>
  );
}

function DimensionRow({ label, value }: { label: string; value: number | null }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold w-28 shrink-0 text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreBg(value)}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums w-10 text-right ${scoreColor(value)}`}>
        {value}%
      </span>
    </div>
  );
}

function PlatformBadge({ name, score }: { name: string; score: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 px-2.5 py-1.5">
      <span className="text-[11px] font-medium text-muted-foreground capitalize">{name}</span>
      <span className={`text-xs font-bold tabular-nums ${scoreColor(score)}`}>{score}%</span>
    </div>
  );
}

function MiniSparkline({ data, height = 28 }: { data: number[]; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="text-emerald-400">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiReadinessPanel({ siteId }: { siteId: string | null }) {
  const [data, setData] = useState<AiReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`/api/diagnostics/ai-readiness?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <section
        aria-labelledby="ai-readiness-title"
        id="ai-readiness-panel"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            AI Readiness
          </p>
          <h2 id="ai-readiness-title" className="mt-1 text-sm font-semibold text-foreground">
            Loading AI readiness data…
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 sm:p-5">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-labelledby="ai-readiness-title"
        id="ai-readiness-panel"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="px-4 py-5 sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">AI readiness unavailable</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
              <button
                onClick={fetchData}
                className="mt-2 text-xs font-semibold text-brand hover:text-brand/80 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const report = data?.aeoReport;
  const snap = data?.snapshot;
  const hasAnyData = report || snap;

  if (!hasAnyData) {
    return (
      <section
        aria-labelledby="ai-readiness-title"
        id="ai-readiness-panel"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            AI Readiness
          </p>
          <h2 id="ai-readiness-title" className="mt-1 text-sm font-semibold text-foreground">
            No AI visibility data recorded
          </h2>
        </div>
        <div className="flex items-start gap-3 px-4 py-5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Run an AEO scan first</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              AI readiness metrics will appear once you run an AEO visibility scan.
              This panel consolidates your AI search presence across platforms.
            </p>
            <Link
              href="/dashboard/aeo"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand/80 transition-colors"
            >
              Go to AEO <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const score = report?.score ?? snap?.score ?? 0;
  const grade = report?.grade ?? snap?.grade ?? null;
  const dims = snap?.dimensions ?? report?.dimensions ?? null;
  const layers = report?.layerScores;
  const platforms = snap?.platforms;
  const conf = snap?.confidence ?? report?.confidence ?? null;
  const trendData = data?.trend ?? [];
  const trendScores = trendData.map((t) => t.score);
  const unresolvedAi = data?.diagnosticReadiness?.unresolvedAiFindings ?? 0;

  const lastScan = report?.createdAt ?? snap?.createdAt ?? null;
  const lastScanDate = lastScan
    ? new Date(lastScan).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <section
      aria-labelledby="ai-readiness-title"
      id="ai-readiness-panel"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            AI Readiness
          </p>
          <h2 id="ai-readiness-title" className="mt-1 text-sm font-semibold text-foreground">
            AI visibility overview
            {data?.domain && <span className="text-muted-foreground font-normal"> · {data.domain}</span>}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Existing AEO scores and per-platform AI search visibility.
            {lastScanDate && ` Last scan: ${lastScanDate}.`}
          </p>
        </div>
        <Link
          href="/dashboard/aeo"
          className="inline-flex shrink-0 items-center gap-1 self-start text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:self-center"
        >
          Full AEO report
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="p-4 sm:p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                AEO Score
              </span>
              {grade && (
                <span className={`ml-auto text-[10px] font-black px-1.5 py-0.5 rounded-md border ${gradeStyle(grade)}`}>
                  {grade}
                </span>
              )}
            </div>
            <div className="flex items-end gap-3">
              <p className={`text-2xl font-bold tabular-nums ${scoreColor(score)}`}>{score}</p>
              {trendScores.length >= 2 && <MiniSparkline data={trendScores} />}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">out of 100</p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Citations
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">{data?.citations.thisMonth ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              this month · {data?.citations.total ?? 0} total
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Share of Voice
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {report?.generativeShareOfVoice ?? snap?.generativeShareOfVoice ?? 0}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">generative search</p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Confidence
              </span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {confidenceLabel(conf?.level ?? null)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {conf?.successfulProviders !== null && conf?.totalProviders !== null
                ? `${conf?.successfulProviders}/${conf?.totalProviders} providers`
                : "Audit confidence level"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dims && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span className="text-xs font-semibold text-foreground">Readiness Dimensions</span>
              </div>
              <div className="space-y-2">
                <DimensionRow label="Technical" value={dims.technicalReadiness} />
                <DimensionRow label="Content" value={dims.contentReadiness} />
                <DimensionRow label="AI Visibility" value={dims.aiVisibility} />
                <DimensionRow label="Citation Quality" value={dims.citationQuality} />
              </div>
            </div>
          )}

          {layers && (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Microscope className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                <span className="text-xs font-semibold text-foreground">Layer Scores</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {layers.aeo !== undefined && (
                  <div className="text-center">
                    <p className={`text-lg font-bold tabular-nums ${scoreColor(layers.aeo!)}`}>{layers.aeo}%</p>
                    <p className="text-[10px] text-muted-foreground">AEO</p>
                  </div>
                )}
                {layers.geo !== undefined && (
                  <div className="text-center">
                    <p className={`text-lg font-bold tabular-nums ${scoreColor(layers.geo!)}`}>{layers.geo}%</p>
                    <p className="text-[10px] text-muted-foreground">GEO</p>
                  </div>
                )}
                {layers.aio !== undefined && (
                  <div className="text-center">
                    <p className={`text-lg font-bold tabular-nums ${scoreColor(layers.aio!)}`}>{layers.aio}%</p>
                    <p className="text-[10px] text-muted-foreground">AIO</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {platforms && (
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold text-foreground">Per-Platform Visibility</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <PlatformBadge name="Perplexity" score={platforms.perplexity} />
              <PlatformBadge name="ChatGPT" score={platforms.chatgpt} />
              <PlatformBadge name="Claude" score={platforms.claude} />
              <PlatformBadge name="Google AIO" score={platforms.googleAio} />
              <PlatformBadge name="Grok" score={platforms.grok} />
              <PlatformBadge name="Copilot" score={platforms.copilot} />
            </div>
          </div>
        )}

        {unresolvedAi > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-400">
                  {unresolvedAi} unresolved AI-related diagnostic finding{unresolvedAi !== 1 ? "s" : ""}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  These may affect your AI search visibility. View diagnostics for details.
                </p>
              </div>
              <Link
                href="/dashboard/diagnostics"
                className="shrink-0 text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
              >
                View <ArrowRight className="inline h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
