"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAllSitesWithMentions, checkLlmMentions, type AeoCategoryScore } from "@/app/actions/llmMentions";
import { GsiMetrics } from "@/components/dashboard/GsiMetrics";
import { PromptSimulator } from "@/components/aeo/PromptSimulator";
import type { AeoResult } from "@/lib/aeo";
import { runAeoReport, getAeoReportStatus } from "@/app/actions/aeo";
import { generateAeoRecommendationFix, type AeoRecommendationFix } from "@/app/actions/aeoFix";
import Link from "next/link";
import {
    Bot, Zap, ChevronDown, ChevronUp, Lightbulb, Globe,
    TrendingUp, HelpCircle, BarChart2, BookOpen, Target,
    Users, Search, Wrench, Loader2, Copy, Check, AlertCircle,
    ArrowUpRight, Sparkles, Activity,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { BrandEntityPanel } from "@/components/aeo/BrandEntityPanel";
import { CitationGapPanel } from "@/components/aeo/CitationGapPanel";
import { CitationBreakdownPanel } from "@/components/aeo/CitationBreakdownPanel";
import { AeoScoreTrendChart } from "@/components/aeo/AeoScoreTrendChart";
import { VisibilityForecastPanel } from "@/components/aeo/VisibilityForecastPanel";
import { SemanticGapPanel } from "@/components/aeo/SemanticGapPanel";
import { GenerativeSOVPanel } from "@/components/dashboard/GenerativeSOVPanel";
import QueryLibraryPanel from "@/components/aeo/QueryLibraryPanel";
import { BacklinkPanel } from "@/components/dashboard/BacklinkPanel";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { PdfDownloadButton } from "@/components/PdfDownloadButton";

// ─── Score utilities ──────────────────────────────────────────────────────────

function scoreColor(score: number) {
    return score >= 65 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-rose-400";
}
function scoreBg(score: number) {
    return score >= 65 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-rose-500";
}
function scoreGlow(score: number) {
    return score >= 65
        ? "shadow-[0_0_20px_rgba(16,185,129,0.25)]"
        : score >= 40
            ? "shadow-[0_0_20px_rgba(245,158,11,0.25)]"
            : "shadow-[0_0_20px_rgba(239,68,68,0.25)]";
}
function gradeColor(grade: string) {
    const map: Record<string, string> = {
        A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        B: "text-blue-400   border-blue-500/30   bg-blue-500/10",
        C: "text-amber-400  border-amber-500/30  bg-amber-500/10",
        D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
        F: "text-rose-400   border-rose-500/30   bg-rose-500/10",
    };
    return map[grade] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10";
}

// PATCH: grade labels — "B" alone means nothing; add a one-liner so users know where they stand
const GRADE_LABELS: Record<string, string> = {
    A: "Excellent — AI frequently cites you",
    B: "Good foundations — needs content depth",
    C: "Moderate — AI rarely cites you",
    D: "Weak — AI mostly ignores you",
    F: "Critical — invisible to AI systems",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
    brand_authority: Globe,
    topic_coverage: TrendingUp,
    faq_readiness: HelpCircle,
    competitor_comparison: BarChart2,
    how_to_guidance: BookOpen,
};

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({
    rate, size = 64, strokeWidth = 6, showLabel = true,
}: {
    rate: number; size?: number; strokeWidth?: number; showLabel?: boolean;
}) {
    const r = size / 2 - strokeWidth;
    const circ = 2 * Math.PI * r;
    const dash = Math.min(rate / 100, 1) * circ;
    const color = rate >= 65 ? "#10b981" : rate >= 40 ? "#f59e0b" : "#ef4444";

    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke={color} strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: "stroke-dasharray 1.4s cubic-bezier(0.4,0,0.2,1)" }}
                />
            </svg>
            {showLabel && (
                <span
                    className={`absolute inset-0 flex items-center justify-center font-black rotate-90 tabular-nums ${scoreColor(rate)}`}
                    style={{ fontSize: size > 80 ? 28 : 13 }}
                >
                    {rate}
                </span>
            )}
        </div>
    );
}

// ─── Layer Score Pill ─────────────────────────────────────────────────────────

function LayerPill({
    label, score, icon: Icon,
}: {
    label: string; score: number | undefined; icon: React.ElementType;
}) {
    if (score === undefined || score < 0) return null;
    const cls =
        score >= 65
            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
            : score >= 40
                ? "text-amber-400 bg-amber-500/10 border-amber-500/25"
                : "text-rose-400 bg-rose-500/10 border-rose-500/25";
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
            <Icon className="w-2.5 h-2.5" />
            {label}&nbsp;{score}%
        </span>
    );
}

// ─── Category Bar ─────────────────────────────────────────────────────────────

function CategoryBar({ cat }: { cat: AeoCategoryScore }) {
    const Icon = CATEGORY_ICONS[cat.category] ?? Globe;
    return (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-muted/40 border border-border/60">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className={`p-1 rounded-md bg-muted ${scoreColor(cat.score)}`}>
                        <Icon className="w-3 h-3" />
                    </span>
                    <span className="text-xs font-medium text-foreground">{cat.label}</span>
                </div>
                <span className={`text-sm font-black tabular-nums ${scoreColor(cat.score)}`}>{cat.score}%</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-1000 ${scoreBg(cat.score)}`}
                    style={{ width: `${cat.score}%` }}
                />
            </div>
            <p className="text-[10px] text-muted-foreground">
                {cat.cited}/{cat.queriesRun} queries cited
            </p>
        </div>
    );
}

// ─── Recommendation Fix Panel ─────────────────────────────────────────────────

function RecommendationFixPanel({
    siteId, recommendation, competitors, category,
}: {
    siteId: string;
    recommendation: string;
    competitors: string[];
    category?: string;
}) {
    type State =
        | { status: "idle" }
        | { status: "loading" }
        | { status: "done"; result: AeoRecommendationFix }
        | { status: "error"; message: string };

    const [state, setState] = useState<State>({ status: "idle" });
    const [copied, setCopied] = useState(false);

    const handleFix = useCallback(async () => {
        setState({ status: "loading" });
        const res = await generateAeoRecommendationFix(siteId, recommendation, competitors, category);
        if (res.success) setState({ status: "done", result: res });
        else setState({ status: "error", message: res.error });
    }, [siteId, recommendation, competitors, category]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (state.status === "idle") {
        return (
            <button
                onClick={handleFix}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-lg
          bg-emerald-500/10 border border-emerald-500/25 text-emerald-400
          hover:bg-emerald-500/20 hover:border-emerald-500/50
          active:scale-95 transition-all shrink-0 whitespace-nowrap"
                title="Generate a targeted fix using competitor intelligence"
            >
                <Wrench className="w-3 h-3" />
                Fix this
            </button>
        );
    }
    if (state.status === "loading") {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" /> Generating…
            </span>
        );
    }
    if (state.status === "error") {
        return (
            <div className="mt-3 w-full flex items-start gap-2 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="flex-1">{state.message}</span>
                <button onClick={() => setState({ status: "idle" })} className="underline text-muted-foreground hover:text-foreground">
                    Retry
                </button>
            </div>
        );
    }

    const r = state.result;
    return (
        <div className="mt-3 w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col gap-3">
            {r.competitorInsight && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground italic border-l-2 border-blue-500/40 pl-3">
                    <Search className="w-3 h-3 shrink-0 mt-0.5 text-blue-400" />
                    <span><span className="font-semibold text-blue-300 not-italic">Competitor intel: </span>{r.competitorInsight}</span>
                </div>
            )}
            <div>
                <p className="text-sm font-bold text-emerald-400 mb-1">{r.headline}</p>
                <p className="text-xs text-foreground/80 leading-relaxed">{r.why}</p>
            </div>
            <ol className="space-y-2">
                {r.steps.map((step, si) => (
                    <li key={si} className="flex gap-2.5 items-start text-xs text-foreground/80">
                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black flex items-center justify-center shrink-0 mt-0.5">
                            {si + 1}
                        </span>
                        {step}
                    </li>
                ))}
            </ol>
            {r.copySnippet && (
                <div className="relative">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Ready-to-paste snippet
                    </p>
                    <pre className="text-xs text-zinc-300 bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3 pr-10 overflow-x-auto font-mono whitespace-pre-wrap">
                        {r.copySnippet}
                    </pre>
                    <button
                        onClick={() => handleCopy(r.copySnippet!)}
                        className="absolute top-7 right-2 p-1.5 rounded-lg bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors"
                    >
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                </div>
            )}
            <button onClick={() => setState({ status: "idle" })} className="self-end text-[10px] text-muted-foreground hover:text-foreground underline">
                Reset
            </button>
        </div>
    );
}

// ─── Scanning Spinner SVG ─────────────────────────────────────────────────────

function SpinnerSvg({ className }: { className?: string }) {
    return (
        <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

// ─── Site Row ─────────────────────────────────────────────────────────────────

function SiteRow({ siteId, domain, latest, onScan, onDeepScan }: {
    siteId: string;
    domain: string;
    latest: any;
    onScan: (siteId: string) => Promise<{ reportId: string } | { error: string } | null>;
    onDeepScan: (siteId: string) => Promise<{ reportId: string } | { error: string } | null>;
}) {
    const router = useRouter();
    const [scanning, setScanning] = useState(false);
    const [deepScanning, setDeepScanning] = useState(false);
    const [pollingStatus, setPollingStatus] = useState<"idle" | "polling" | "done" | "timeout">("idle");
    const [scanError, setScanError] = useState<string | null>(null);
    const [pendingReportId, setPendingReportId] = useState<string | null>(null);
    const [result, setResult] = useState<any>(latest);
    const [expanded, setExpanded] = useState(false);
    const [innerTab, setInnerTab] = useState<"trend" | "insights" | "raw">("trend");

    useEffect(() => { setResult(latest); }, [latest]);

    const handleScan = async () => {
        setScanning(true); setScanError(null);
        const res = await onScan(siteId);
        setScanning(false);
        if (res && "reportId" in res) { setPendingReportId(res.reportId); setPollingStatus("polling"); }
        else setScanError((res as any)?.error ?? "Scan failed to start. Check your API key or rate limit.");
    };

    const handleDeepScan = async () => {
        setDeepScanning(true); setScanError(null);
        const res = await onDeepScan(siteId);
        setDeepScanning(false);
        if (res && "reportId" in res) { setPendingReportId(res.reportId); setPollingStatus("polling"); }
        else setScanError((res as any)?.error ?? "Deep audit failed to start. Check your API key or rate limit.");
    };

    // Polling
    useEffect(() => {
        if (!pendingReportId || pollingStatus !== "polling") return;
        let attempts = 0;
        let timeoutId: ReturnType<typeof setTimeout>;
        const poll = async () => {
            attempts++;
            try {
                const status = await getAeoReportStatus(pendingReportId);
                if (status.done && status.report) {
                    setPollingStatus("done"); setScanError(null); setPendingReportId(null);
                    setResult(status.report); router.refresh();
                    setTimeout(() => setPollingStatus("idle"), 3000);
                    return;
                } else if (status.done && !status.report) {
                    setPollingStatus("timeout");
                    setScanError("Audit failed — please try again.");
                    setPendingReportId(null); router.refresh(); return;
                } else if (attempts >= 60) {
                    setPollingStatus("timeout");
                    setScanError("Still running in the background — refresh the page in a few minutes.");
                    setPendingReportId(null); return;
                }
            } catch { /* retry silently */ }
            timeoutId = setTimeout(poll, attempts <= 3 ? 5000 : 15000);
        };
        timeoutId = setTimeout(poll, 5000);
        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingReportId, pollingStatus]);

    const rate = result?.citationScore ?? result?.score ?? null;
    const checks = result?.checks as any;
    const isDeepAudit = Array.isArray(checks);
    const mentions: number | null = !isDeepAudit && typeof checks?.mentionCount === "number" ? checks.mentionCount : null;
    const total: number | null = !isDeepAudit && typeof checks?.totalQueries === "number" ? checks.totalQueries : null;
    const categoryScores: AeoCategoryScore[] = !isDeepAudit ? (checks?.categoryScores ?? []) : [];
    const responses: any[] = !isDeepAudit ? (checks?.responses ?? []) : [];
    const deepChecks: any[] = isDeepAudit ? checks : [];
    const recommendations: string[] = result?.topRecommendations ?? (!isDeepAudit ? checks?.recommendations : []) ?? [];
    const grade: string | null = result?.grade ?? null;
    const hasGsiData = !!(result?.multiEngineScore);
    const scoreDelta: number = latest?.scoreDelta ?? 0;
    const isPolling = pollingStatus === "polling";

    // PATCH: "Details" expand button label changes based on score — creates urgency for low scores
    const expandLabel = expanded
        ? "Collapse"
        : rate !== null && rate < 40
            ? "View Issues"
            : "Details";

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden transition-all duration-200 hover:border-[#484f58]">

            {/* ── Header row ── */}
            <div className="p-5 flex items-center justify-between gap-4 flex-wrap">

                {/* Left: ring + meta */}
                <div className="flex items-center gap-4 min-w-0">
                    {rate !== null ? (
                        <ScoreRing rate={rate} size={64} />
                    ) : (
                        <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                            <Activity className="w-5 h-5 text-muted-foreground/40" />
                        </div>
                    )}

                    <div className="min-w-0">
                        {/* Domain + badges */}
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="font-bold text-base tracking-tight truncate">{domain}</p>
                            {grade && (
                                <span className={`text-xs font-black px-2 py-0.5 rounded-lg border ${gradeColor(grade)}`}>
                                    Grade {grade}
                                </span>
                            )}
                            {scoreDelta !== 0 && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${scoreDelta > 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                                    }`}>
                                    {scoreDelta > 0 ? "↑" : "↓"} {Math.abs(scoreDelta)}%
                                </span>
                            )}
                        </div>

                        {/* Layer pills */}
                        {result?.layerScores && (
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <LayerPill label="AEO" score={result.layerScores.aeo} icon={Search} />
                                <LayerPill label="GEO" score={result.layerScores.geo} icon={Target} />
                                <LayerPill label="AIO" score={result.layerScores.aio} icon={Users} />
                            </div>
                        )}

                        {/* Status line */}
                        {isDeepAudit ? (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-blue-400" />
                                AI Deep Audit completed
                            </p>
                        ) : rate !== null && mentions !== null && total !== null ? (
                            <p className="text-xs text-muted-foreground">
                                Cited in <span className="text-foreground font-semibold">{mentions}/{total}</span> AI queries
                                {categoryScores.length > 0 && " across 5 categories"}
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">Not yet scanned — 15-query AEO audit</p>
                        )}
                        {result?.createdAt && (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                Updated {new Date(result.createdAt).toLocaleDateString()}
                            </p>
                        )}
                    </div>
                </div>

                {/* Right: actions */}
                {/*
                    PATCH: button hierarchy — was two equal-weight buttons side by side.
                    "AEO Scan" is the entry-level action (15 queries, fast, free tier).
                    "Deep Audit" is the advanced action (full GSI audit, costs credits).
                    Now: AEO Scan = solid primary CTA, Deep Audit = secondary ghost button.
                    When no scan exists, a "Start here" label guides new users.
                */}
                <div className="flex flex-col items-end gap-2">
                    {rate === null && !isPolling && (
                        <p className="text-[10px] text-muted-foreground">
                            ↓ Run your first scan to see AI visibility
                        </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                        {rate !== null && (
                            <button
                                onClick={() => setExpanded(e => !e)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/70 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border transition-all"
                            >
                                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                {expandLabel}
                            </button>
                        )}

                        {/* Primary: AEO Scan */}
                        <button
                            onClick={handleScan}
                            disabled={scanning || isPolling}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed
              bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50"
                        >
                            {scanning ? "Queuing…"
                                : isPolling ? <><SpinnerSvg className="w-3.5 h-3.5" /> Scanning…</>
                                    : pollingStatus === "done" ? "✅ Done"
                                        : <><Zap className="w-3.5 h-3.5" /> AEO Scan</>}
                        </button>

                        {/* Secondary: Deep Audit — visually quieter */}
                        <button
                            onClick={handleDeepScan}
                            disabled={deepScanning || isPolling}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed
              border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border"
                            title="Full Generative Search Intelligence audit — uses more credits"
                        >
                            {deepScanning ? "Queuing…"
                                : isPolling ? <><SpinnerSvg className="w-3.5 h-3.5" /> Running…</>
                                    : pollingStatus === "done" ? "✅ Done"
                                        : <><Sparkles className="w-3 h-3" /> Deep Audit</>}
                        </button>

                        {/* PDF Export — only when a report exists */}
                        {rate !== null && result?.id && (
                            <PdfDownloadButton
                                endpoint="/api/pdf/aeo"
                                params={{ reportId: result.id }}
                                label="PDF"
                                filename={`aeo-report-${domain}.pdf`}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* ── Error banner ── */}
            {scanError && (
                <div className="mx-5 mb-4 px-4 py-3 rounded-xl bg-rose-500/8 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {scanError}
                </div>
            )}

            {/* ── Polling progress banner ── */}
            {isPolling && !scanError && (
                <div className="mx-5 mb-4 px-4 py-3 rounded-xl bg-blue-500/8 border border-blue-500/20 text-blue-300 text-sm flex items-center gap-2.5">
                    <SpinnerSvg className="w-4 h-4 shrink-0" />
                    <span>Scan running — usually 1–3 minutes. Results will appear automatically.</span>
                </div>
            )}

            {/* ── Expanded detail panel (3-tab inner view) ── */}
            {expanded && (
                <div className="border-t border-[#21262d]">

                    {/* Inner tab bar */}
                    <div className="flex items-center gap-1 px-5 py-2.5 border-b border-[#21262d] bg-[#0a0d11] overflow-x-auto scrollbar-none">
                        {(["trend", "insights", "raw"] as const).map((t) => {
                            const labels = { trend: "Trend & Forecast", insights: "Insights", raw: "Raw Data" };
                            return (
                                <button
                                    key={t}
                                    onClick={() => setInnerTab(t)}
                                    className={`shrink-0 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                                        innerTab === t
                                            ? "bg-[#21262d] text-[#e6edf3]"
                                            : "text-[#6e7681] hover:text-[#c9d1d9]"
                                    }`}
                                >
                                    {labels[t]}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-6 flex flex-col gap-8">

                        {/* ── TAB 1: Trend & Forecast ── */}
                        {innerTab === "trend" && (<>
                        <AeoScoreTrendChart siteId={siteId} domain={domain} />
                        <div className="border-t border-[#21262d] pt-6">
                            <VisibilityForecastPanel siteId={siteId} />
                        </div>

                        {/* Category scores — end of Tab 1 */}
                        {categoryScores.length > 0 && (
                            <section>
                                <SectionLabel icon={TrendingUp} label="AEO Category Scores" />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                    {categoryScores.map(cat => <CategoryBar key={cat.category} cat={cat} />)}
                                </div>
                            </section>
                        )}
                        </>)}

                        {/* ── TAB 2: Insights ── */}
                        {innerTab === "insights" && (<>

                        {/* Semantic Gap */}
                        {result?.semanticGaps && result.semanticGaps.length > 0 && (
                            <SemanticGapPanel gaps={result.semanticGaps} />
                        )}

                        {/* Prompt Simulator */}
                        <PromptSimulator siteId={siteId} domain={domain} />

                        {/* Recommendations */}
                        {recommendations.length > 0 && (
                            <section>
                                <SectionLabel icon={Lightbulb} label="Actionable Recommendations" accent="amber" />
                                <div className="flex flex-col gap-4 mt-4">
                                    {recommendations.map((rec, i) => {
                                        const competitorDomains: string[] = responses
                                            .filter((r: any) => !r.cited && r.excerpt)
                                            .flatMap((r: any) => ((r.excerpt as string).match(/\b([a-z0-9-]+\.(?:com|org|net|io|co|ai|app|dev))\b/gi) ?? []))
                                            .filter((d: string) => !d.includes(domain));
                                        const uniqueCompetitors = [...new Set(competitorDomains)].slice(0, 3);
                                        const catKeys = ["brand_authority", "industry", "services", "geography", "legitimacy"];
                                        return (
                                            <div key={i} className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
                                                <div className="flex items-start gap-3">
                                                    <span className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                                                        {i + 1}
                                                    </span>
                                                    <p className="text-sm text-[#c9d1d9] leading-relaxed flex-1">{rec}</p>
                                                    <RecommendationFixPanel
                                                        siteId={siteId}
                                                        recommendation={rec}
                                                        competitors={uniqueCompetitors}
                                                        category={catKeys[i]}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* AIO Brand Intelligence */}
                        {checks?.aiExcerpt && (
                            <section>
                                <SectionLabel icon={Users} label="What AI Knows About Your Brand" accent="amber" />
                                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 flex flex-col gap-4">
                                    <p className="text-sm text-[#c9d1d9] leading-relaxed italic">&ldquo;{checks.aiExcerpt}&rdquo;</p>
                                    {Array.isArray(checks.benchmarkChecks) && checks.benchmarkChecks.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {checks.benchmarkChecks.map((bc: any) => (
                                                <div key={bc.id} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-xs ${bc.passed ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300" : "bg-rose-500/5 border-rose-500/20 text-rose-300"}`}>
                                                    <span className="mt-0.5">{bc.passed ? "✅" : "❌"}</span>
                                                    <div>
                                                        <p className="font-semibold">{bc.label}</p>
                                                        <p className="text-[10px] text-[#6e7681] mt-0.5">{bc.detail}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Schema Gaps */}
                        {result?.schemaGaps?.length > 0 && (
                            <section>
                                <SectionLabel icon={AlertCircle} label="Missing Schema" accent="amber" />
                                <div className="flex flex-col gap-2 mt-4">
                                    {result.schemaGaps.map((gap: string, i: number) => (
                                        <div key={i} className="flex items-start gap-2.5 text-sm p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                            <span className="text-amber-400 text-base mt-0.5">⚠</span>
                                            <span className="text-[#c9d1d9]">{gap}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                        </>)}

                        {/* ── TAB 3: Raw Data ── */}
                        {innerTab === "raw" && (<>

                        {/* Multi-model citation comparison */}
                        {result?.multiModelResults?.models && (
                            <section>
                                <SectionLabel icon={BarChart2} label="Model Citation Comparison" />
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                                    {result.multiModelResults.models.map((m: any) => (
                                        <div key={m.modelName} className="p-4 rounded-xl bg-[#161b22] border border-[#30363d]">
                                            <div className="flex items-center justify-between mb-3">
                                                <p className="font-semibold capitalize text-sm text-[#e6edf3]">{m.modelName}</p>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${m.citationRate >= 50 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                                                    {m.citationRate}%
                                                </span>
                                            </div>
                                            <div className="h-1.5 bg-[#21262d] rounded-full overflow-hidden mb-2">
                                                <div className={`h-full rounded-full transition-all duration-700 ${m.citationRate >= 50 ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${m.citationRate}%` }} />
                                            </div>
                                            <p className="text-[10px] text-[#6e7681]">{m.citationCount}/{m.queriesRun} queries</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* GSI Metrics */}
                        {hasGsiData && <GsiMetrics result={result as AeoResult} />}

                        {/* Query responses */}
                        {responses.length > 0 && (
                            <section>
                                <SectionLabel icon={Search} label={`AI Query Results (${responses.length})`} />
                                <div className="flex flex-col gap-2 mt-4">
                                    {responses.map((r: any, i: number) => {
                                        const categoryLabels: Record<string, string> = {
                                            aio_brand: "AIO — Brand", brand_authority: "Brand Authority",
                                            topic_coverage: "Topic Coverage", faq_readiness: "FAQ Readiness",
                                            competitor_comparison: "Competitors", how_to_guidance: "How-To",
                                            geo_recommendation: "GEO — Recommendation",
                                        };
                                        const categoryLabel = r.category ? (categoryLabels[r.category] ?? r.category.replace(/_/g, " ")) : null;
                                        const queryLabel = r.query && r.query !== `AEO batch analysis for ${r.category}` ? r.query : null;
                                        return (
                                            <div key={i} className={`p-3.5 rounded-xl text-xs border ${r.cited ? "bg-emerald-500/5 border-emerald-500/15" : "bg-[#161b22] border-[#30363d]"}`}>
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    <span className={`font-bold px-2 py-0.5 rounded-lg border text-[11px] ${r.cited ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
                                                        {r.cited ? "✅ Cited" : "❌ Not cited"}
                                                    </span>
                                                    {categoryLabel && (
                                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#21262d] border border-[#30363d] text-[#6e7681]">
                                                            {categoryLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                {queryLabel && <p className="font-semibold text-[#e6edf3] mb-1.5">&ldquo;{queryLabel}&rdquo;</p>}
                                                {r.excerpt
                                                    ? <p className="text-[#8b949e] leading-relaxed">{r.excerpt}</p>
                                                    : <p className="text-[#6e7681] italic">No excerpt available.</p>
                                                }
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* Citation Breakdown */}
                        {responses.length > 0 && (
                            <section>
                                <CitationBreakdownPanel responses={responses} domain={domain} multiModel={result?.multiModelResults?.models} />
                            </section>
                        )}

                        {/* Deep Audit checks grouped by layer */}
                        {deepChecks.length > 0 && (() => {
                            const layerGroups = [
                                { key: "aeo", label: "AEO — Answer Engine", color: "text-blue-400", icon: Search, cats: ["schema", "eeat", "content", "technical", "citation"] },
                                { key: "geo", label: "GEO — Generative Recommendation", color: "text-purple-400", icon: Target, cats: ["geo"] },
                                { key: "aio", label: "AIO — Brand Understanding", color: "text-amber-400", icon: Users, cats: ["aio"] },
                            ];
                            return (
                                <div className="flex flex-col gap-8">
                                    {layerGroups.map(({ key, label, color, icon: LIcon, cats }) => {
                                        const groupChecks = deepChecks.filter((c: any) => cats.includes(c.category));
                                        if (!groupChecks.length) return null;
                                        const passed = groupChecks.filter((c: any) => c.passed).length;
                                        return (
                                            <section key={key}>
                                                <div className={`flex items-center gap-2 mb-4 ${color}`}>
                                                    <LIcon className="w-4 h-4" />
                                                    <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                                                    <span className="text-[#6e7681] font-normal normal-case tracking-normal text-xs">— {passed}/{groupChecks.length} passed</span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    {groupChecks.map((c: any) => (
                                                        <div key={c.id} className={`p-4 rounded-xl border flex flex-col gap-2 ${c.passed ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"}`}>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <p className="font-semibold text-sm text-[#e6edf3]">{c.passed ? "✅" : "❌"} {c.label}</p>
                                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase shrink-0 ${c.impact === "high" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : c.impact === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"}`}>{c.impact}</span>
                                                            </div>
                                                            <p className="text-xs text-[#8b949e] leading-relaxed flex-grow">{c.detail}</p>
                                                            {!c.passed && c.recommendation && (
                                                                <div className="mt-1 p-3 bg-[#161b22] rounded-xl border border-[#30363d]">
                                                                    <p className="text-[10px] font-bold text-[#6e7681] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                                                        <Lightbulb className="w-3 h-3 text-amber-400" /> How to fix
                                                                    </p>
                                                                    <p className="text-xs text-[#8b949e] leading-relaxed">{c.recommendation}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                        </>)}

                    </div>
                </div>
            )}

        </div>
    );
}
// ─── Section Label ────────────────────────────────────────────────────────────

function SectionLabel({
    icon: Icon, label, accent,
}: {
    icon: React.ElementType; label: string; accent?: "amber" | "blue" | "emerald";
}) {
    const color =
        accent === "amber" ? "text-amber-400"
            : accent === "blue" ? "text-blue-400"
                : accent === "emerald" ? "text-emerald-400"
                    : "text-muted-foreground";
    return (
        <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
    );
}

// ─── Intelligence Tab Panel ───────────────────────────────────────────────────
/*
    PATCH: Intelligence panels (BrandEntity, CitationGap, GenerativeSOV,
    QueryLibrary) were stacked sequentially below the SummaryHero.
    Now wrapped in a tab bar — only one panel visible at a time.
    Tab order: Brand → Citations → Share of Voice → Query Library
*/

const INTEL_TABS = [
    { id: "brand", label: "Brand Entity" },
    { id: "citations", label: "Citation Gaps" },
    { id: "sov", label: "Share of Voice" },
    { id: "queries", label: "Query Library" },
    { id: "backlinks", label: "Backlinks" },
] as const;

type IntelTabId = typeof INTEL_TABS[number]["id"];

function IntelligenceTabs({
    siteId,
    domain,
    brandFacts,
    competitorDomains,
    hasCompetitors,
}: {
    siteId: string;
    domain: string;
    brandFacts: { factType: string; value: string; verified: boolean }[];
    competitorDomains: string[];
    hasCompetitors: boolean;
}) {
    const [activeTab, setActiveTab] = useState<IntelTabId>("brand");

    return (
        <div className="card-surface overflow-hidden">
            {/* Tab bar */}
            <div className="flex overflow-x-auto border-b border-border scrollbar-none">
                {INTEL_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                            "shrink-0 px-5 py-3.5 text-sm font-medium transition-colors whitespace-nowrap",
                            "border-b-2 -mb-px",
                            activeTab === tab.id
                                ? "border-[var(--brand)] text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                        ].join(" ")}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Panel content */}
            <div className="p-5">
                {activeTab === "brand" && (
                    <PanelErrorBoundary fallbackTitle="Brand Entity panel failed to load">
                        <BrandEntityPanel
                            siteId={siteId}
                            domain={domain}
                            brandFacts={brandFacts}
                            competitorDomains={competitorDomains}
                        />
                    </PanelErrorBoundary>
                )}
                {activeTab === "citations" && (
                    <PanelErrorBoundary fallbackTitle="Citation Gap panel failed to load">
                        <CitationGapPanel siteId={siteId} hasCompetitors={hasCompetitors} />
                    </PanelErrorBoundary>
                )}
                {activeTab === "sov" && (
                    <PanelErrorBoundary fallbackTitle="Share of Voice panel failed to load">
                        <GenerativeSOVPanel siteId={siteId} />
                    </PanelErrorBoundary>
                )}
                {activeTab === "queries" && (
                    <PanelErrorBoundary fallbackTitle="Query Library panel failed to load">
                        <QueryLibraryPanel siteId={siteId} />
                    </PanelErrorBoundary>
                )}
                {activeTab === "backlinks" && (
                    <PanelErrorBoundary fallbackTitle="Backlinks panel failed to load">
                        <BacklinkPanel siteId={siteId} competitorDomains={competitorDomains} />
                    </PanelErrorBoundary>
                )}
            </div>
        </div>
    );
}

// ─── Summary hero card ────────────────────────────────────────────────────────

function SummaryHero({ sites, scannedSites, avgRate, topGrade }: {
    sites: any[];
    scannedSites: any[];
    avgRate: number | null;
    topGrade: string | null;
}) {
    const recs = scannedSites[0]?.latest?.topRecommendations ?? [];
    const fallbackRecs = [
        "Create a comprehensive 'About Us' page to establish brand entity.",
        "Add Organization and LocalBusiness schema to your homepage.",
        "Publish comparison pages to capture GEO recommendation traffic.",
    ];
    const displayRecs = recs.length > 0 ? recs.slice(0, 3) : fallbackRecs;
    const isReal = recs.length > 0;

    // PATCH: first site's siteId for RecommendationFixPanel inside hero
    const heroSiteId = scannedSites[0]?.site?.id ?? "";
    const heroCompetitors: string[] = (scannedSites[0]?.site?.competitors ?? [])
        .map((c: { domain: string }) => c.domain).slice(0, 3);
    const catKeys = ["brand_authority", "industry", "services"];

    return (
        <div className="card-surface overflow-hidden">
            <div className="flex flex-col sm:flex-row">

                {/* Score column */}
                <div className="sm:w-64 p-8 border-b sm:border-b-0 sm:border-r border-border bg-muted/20 flex flex-col items-center justify-center text-center gap-4">
                    <div className={`relative rounded-full ${avgRate !== null ? scoreGlow(avgRate ?? 0) : ""}`}>
                        {avgRate !== null ? (
                            <ScoreRing rate={avgRate} size={120} strokeWidth={8} />
                        ) : (
                            <div className="w-[120px] h-[120px] rounded-full border-[8px] border-border flex items-center justify-center">
                                <span className="text-muted-foreground text-2xl font-black">–</span>
                            </div>
                        )}
                    </div>
                    <div>
                        <p className="text-xl font-black text-foreground tabular-nums">
                            {avgRate !== null ? `${avgRate}%` : "–"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Avg. AI Visibility</p>
                        {/* PATCH: zero score gets an explanatory line, not just "1 site scanned" */}
                        {avgRate === 0 ? (
                            <p className="text-[10px] text-rose-400/80 mt-1 max-w-[140px] mx-auto leading-relaxed">
                                AI models aren&apos;t citing you yet — run a scan for a full diagnosis
                            </p>
                        ) : (
                            <p className="text-[10px] text-muted-foreground/60 mt-1">
                                {scannedSites.length} site{scannedSites.length !== 1 ? "s" : ""} scanned
                            </p>
                        )}
                    </div>
                </div>

                {/* Right panel */}
                <div className="flex-1 p-6 sm:p-8 flex flex-col gap-6">
                    {topGrade && (
                        <div className="flex items-center gap-3">
                            <span className={`text-xl font-black px-4 py-2 rounded-xl border ${gradeColor(topGrade)}`}>
                                {topGrade}
                            </span>
                            <div>
                                {/* PATCH: grade label now explains what it means, not just "Highest network grade" */}
                                <p className="font-bold text-sm text-foreground">
                                    Grade {topGrade}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {GRADE_LABELS[topGrade] ?? "Highest network grade"}
                                </p>
                            </div>
                        </div>
                    )}

                    <div>
                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                            Priority Actions
                        </p>
                        {/*
                            PATCH: priority actions now include "Fix this" button when real data exists.
                            Mirrors the RecommendationFixPanel used in SiteRow's expanded view.
                            Fallback (no scan yet) stays muted and actionless — no point offering
                            fixes for generic placeholder recommendations.
                        */}
                        <ul className="space-y-3">
                            {displayRecs.map((rec: string, i: number) => (
                                <li key={i} className="flex gap-3 items-start">
                                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${isReal
                                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                        : "bg-muted text-muted-foreground/60"
                                        }`}>{i + 1}</span>
                                    <span className={`text-sm leading-relaxed flex-1 ${isReal ? "text-foreground/85" : "text-muted-foreground/50"}`}>
                                        {rec}
                                    </span>
                                    {isReal && heroSiteId && (
                                        <RecommendationFixPanel
                                            siteId={heroSiteId}
                                            recommendation={rec}
                                            competitors={heroCompetitors}
                                            category={catKeys[i]}
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Score by layer strip */}
            <div className="border-t border-[#21262d] bg-[#0a0d11]">
                <div className="flex items-center gap-2 px-4 pt-3 pb-1 col-span-full sm:col-span-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6e7681]">Score by layer</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#21262d]">
                    {[
                    { step: "AEO", color: "text-blue-400", bg: "bg-blue-500/10", icon: Search, desc: "Get cited in AI answers", scoreKey: "aeo" },
                    { step: "GEO", color: "text-purple-400", bg: "bg-purple-500/10", icon: Target, desc: "Get recommended as the best", scoreKey: "geo" },
                    { step: "AIO", color: "text-amber-400", bg: "bg-amber-500/10", icon: Users, desc: "Get understood by AI", scoreKey: "aio" },
                ].map(item => {
                    const layerScore = scannedSites[0]?.latest?.layerScores?.[item.scoreKey];
                    return (
                        <div key={item.step} className="p-4 flex items-center gap-3">
                            <span className={`w-7 h-7 rounded-lg ${item.bg} ${item.color} flex items-center justify-center shrink-0`}>
                                <item.icon className="w-3.5 h-3.5" />
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className={`text-xs font-bold ${item.color}`}>{item.step}</p>
                                    {/* PATCH: show actual score in strip when available */}
                                    {typeof layerScore === "number" && layerScore >= 0 && (
                                        <span className={`text-[10px] font-black tabular-nums ${scoreColor(layerScore)}`}>
                                            {layerScore}%
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">{item.desc}</p>
                            </div>
                        </div>
                    );
                })}
                </div>
            </div>
        </div>
    );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SiteRowSkeleton() {
    return (
        <div className="card-surface p-5">
            <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full shimmer shrink-0" />
                <div className="flex-1 flex flex-col gap-2">
                    <div className="h-4 w-32 rounded shimmer" />
                    <div className="h-3 w-48 rounded shimmer" />
                    <div className="h-2.5 w-24 rounded shimmer" />
                </div>
                <div className="flex gap-2">
                    <div className="h-9 w-24 rounded-xl shimmer" />
                    <div className="h-9 w-28 rounded-xl shimmer" />
                </div>
            </div>
        </div>
    );
}

// ─── Main inner page ──────────────────────────────────────────────────────────

function AeoRankPageInner() {
    const [sites, setSites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [primaryBrandFacts, setPrimaryBrandFacts] = useState<{ factType: string; value: string; verified: boolean }[]>([]);
    const searchParams = useSearchParams();
    const urlSiteId = searchParams.get("siteId");

    useEffect(() => {
        getAllSitesWithMentions().then(res => {
            setLoading(false);
            if (res.success) setSites(res.sites);
        });
    }, []);

    const activeSiteEntry = sites.find(s => s.site?.id === urlSiteId) ?? sites[0];
    const activeSite = activeSiteEntry?.site;

    useEffect(() => {
        if (!activeSite?.id) return;
        fetch(`/api/entity-panel?siteId=${activeSite.id}`)
            .then(r => r.json())
            .then(data => setPrimaryBrandFacts(data.brandFacts ?? []))
            .catch(() => { });
    }, [activeSite?.id]);

    const handleScan = async (siteId: string) => {
        try {
            const res = await checkLlmMentions(siteId);
            if (res.success && res.reportId) return { reportId: res.reportId };
            if (!res.success) return { error: (res as any).error ?? "Scan failed" };
        } catch (e: unknown) {
            return { error: (e as Error)?.message ?? "Network error — please try again." };
        }
        return null;
    };

    const handleDeepScan = async (siteId: string) => {
        try {
            const res = await runAeoReport(siteId);
            if (res.success && res.reportId) return { reportId: res.reportId };
            if (!res.success) return { error: (res as any).error ?? "Deep audit failed" };
        } catch (e: unknown) {
            return { error: (e as Error)?.message ?? "Network error — please try again." };
        }
        return null;
    };

    const scannedSites = sites.filter(s => s.latest);
    const avgRate = scannedSites.length > 0
        ? Math.round(scannedSites.reduce((sum, s) => sum + (s.latest?.citationScore ?? 0), 0) / scannedSites.length)
        : null;
    const topGrade = scannedSites.length > 0
        ? ["A", "B", "C", "D", "F"].find(g => scannedSites.some(s => s.latest?.grade === g)) ?? null
        : null;

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto pb-12 fade-in-up">
            <PageHeader
                title="AEO · GEO · AIO Optimizer"
                description="Three-layer AI visibility: AEO (get cited in answers) · GEO (get chosen as the recommendation) · AIO (get your brand understood by AI)."
            />

            {/* Summary hero */}
            {!loading && sites.length > 0 && (
                <SummaryHero sites={sites} scannedSites={scannedSites} avgRate={avgRate} topGrade={topGrade} />
            )}

            {/* PATCH: Intelligence panels now in a tabbed card instead of stacked */}
            {!loading && activeSite && (
                <IntelligenceTabs
                    siteId={activeSite.id ?? ""}
                    domain={activeSite.domain ?? ""}
                    brandFacts={primaryBrandFacts}
                    competitorDomains={activeSite.competitors?.map((c: { domain: string }) => c.domain) ?? []}
                    hasCompetitors={(activeSite.competitors?.length ?? 0) > 0}
                />
            )}

            {/* Loading skeletons */}
            {loading && (
                <div className="flex flex-col gap-4">
                    <SiteRowSkeleton />
                    <SiteRowSkeleton />
                </div>
            )}

            {/* Empty state */}
            {!loading && sites.length === 0 && (
                <div className="card-surface p-16 text-center flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
                        <Bot className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold mb-2">No sites registered yet</h2>
                        <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
                            Register a site first, then run a 15-query AEO audit to see how AI models rank your content.
                        </p>
                    </div>
                    <Link
                        href="/dashboard/sites/new"
                        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all"
                    >
                        Register a site <ArrowUpRight className="w-4 h-4" />
                    </Link>
                </div>
            )}

            {/* Site rows */}
            {!loading && sites.length > 0 && (
                <section>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Registered Sites
                    </p>
                    <div className="flex flex-col gap-4">
                        {sites.map(({ site, latest }) => (
                            <PanelErrorBoundary key={site.id} fallbackTitle={`AEO data for ${site.domain} failed to load`}>
                                <SiteRow
                                    siteId={site.id}
                                    domain={site.domain}
                                    latest={latest}
                                    onScan={handleScan}
                                    onDeepScan={handleDeepScan}
                                />
                            </PanelErrorBoundary>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

// ─── Suspense shell ───────────────────────────────────────────────────────────

export default function AeoRankPage() {
    return (
        <Suspense fallback={null}>
            <AeoRankPageInner />
        </Suspense>
    );
}