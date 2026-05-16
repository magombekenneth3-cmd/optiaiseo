/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { runAeoShareOfVoiceCheck, getAeoShareOfVoiceMetrics } from "@/app/actions/aeoTrack";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from "recharts";
import { type AeoDiagnosis } from "@/lib/aeo/diagnosis";
import { AeoDiagnosisPanel } from "@/components/aeo/AeoDiagnosisPanel";
import { KeywordSiteSwitcher } from "@/components/dashboard/KeywordSiteSwitcher";
import { type VisibilityForecast } from "@/lib/aeo/visibility-forecast";

// FORECAST PANEL — Gap 4: surfaces dataSparse + trendConfidence from OLS regression

function ForecastPanel({ siteId }: { siteId: string }) {
    const [forecast, setForecast] = useState<VisibilityForecast | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        fetch(`/api/aeo/forecast?siteId=${encodeURIComponent(siteId)}`)
            .then(r => r.json())
            .then(d => {
                if (d.error) { setError(d.error); return; }
                const f = d.currentCitationRate !== undefined ? d : d.forecast;
                if (f) setForecast(f as VisibilityForecast);
                else setError("Forecast unavailable");
            })
            .catch(() => setError("Could not load forecast"))
            .finally(() => setLoading(false));
    }, [siteId]);

    if (loading) {
        return (
            <div className="card-surface p-5 rounded-2xl flex items-center gap-3 text-sm text-muted-foreground">
                <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating 90-day AI visibility forecast…
            </div>
        );
    }

    if (error || !forecast) {
        return (
            <div className="card-surface p-5 rounded-2xl text-sm text-muted-foreground">
                {error ?? "No forecast data yet — run at least one AEO check first."}
            </div>
        );
    }

    const trendColor = forecast.trend === "improving"
        ? "text-emerald-400" : forecast.trend === "declining"
        ? "text-rose-400" : "text-amber-400";
    const trendIcon  = forecast.trend === "improving" ? "↑" : forecast.trend === "declining" ? "↓" : "→";
    const r2Pct      = Math.round((forecast.trendConfidence ?? 0) * 100);
    const r2Color    = r2Pct >= 70 ? "bg-emerald-500" : r2Pct >= 40 ? "bg-amber-500" : "bg-rose-500";

    return (
        <div className="card-surface p-5 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-400" />
                    90-Day AI Visibility Forecast
                </h3>
                {forecast.dataSparse && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
                        ⚠ Sparse data — fewer than 4 weeks of history
                    </span>
                )}
            </div>

            {/* Main metrics row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/40 rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Now</span>
                    <span className="text-xl font-black text-foreground">{forecast.currentCitationRate}%</span>
                    <span className="text-[10px] text-muted-foreground">citation rate</span>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">+90 days</span>
                    <span className="text-xl font-black text-indigo-400">{forecast.projected90DayCitationRate}%</span>
                    <span className="text-[10px] text-muted-foreground">projected</span>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Trend</span>
                    <span className={`text-xl font-black ${trendColor}`}>
                        {trendIcon} {forecast.trend}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{forecast.historyWeeksUsed}w data</span>
                </div>
                <div className="bg-muted/40 rounded-xl p-3 flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence</span>
                    <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className={`h-full rounded-full ${r2Color} transition-all`} style={{ width: `${r2Pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-foreground">{r2Pct}%</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">R² signal quality</span>
                </div>
            </div>

            {/* Competitor advantage */}
            {forecast.topCompetitorAdvantage && (
                <div className="text-xs bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 flex gap-2.5">
                    <span className="text-rose-400 shrink-0">⚠</span>
                    <div>
                        <span className="font-semibold text-foreground">Competitor gap: </span>
                        <span className="text-muted-foreground">{forecast.topCompetitorAdvantage}</span>
                    </div>
                </div>
            )}

            {/* Key actions */}
            {(forecast.keyActionsToImprove ?? []).length > 0 && (
                <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Forecast Actions</p>
                    {forecast.keyActionsToImprove.map((action, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="w-4 h-4 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">{i + 1}</span>
                            <span className="text-muted-foreground leading-relaxed">{action}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Reasoning */}
            {forecast.forecastReasoning && (
                <p className="text-xs text-muted-foreground/70 italic border-t border-border pt-3 leading-relaxed">
                    {forecast.forecastReasoning}
                </p>
            )}
        </div>
    );
}

// HELPERS

function exportCSV(metrics: any[]) {
    const rows = [
        ["Keyword", "Mentioned", "Competitors Mentioned", "Model", "Date"].join(","),
        ...metrics.map((m) =>
            [
                `"${m.keyword}"`,
                m.brandMentioned ? "Yes" : "No",
                `"${(m.competitorsMentioned ?? []).join("; ")}"`,
                `"${m.model ?? "gemini"}"`,
                new Date(m.recordedAt).toISOString(),
            ].join(",")
        ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aeo-tracking-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function timeAgo(date: string | Date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// KPI CARD

function KpiCard({
    label, value, sub, icon, accentClass,
}: {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ReactNode;
    accentClass?: string;
}) {
    return (
        <div className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4 hover:border-violet-500/30 transition-colors group">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${accentClass ?? "bg-violet-500/10 text-violet-400"}`}>
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">{label}</p>
                <p className="text-2xl font-bold text-foreground leading-tight mt-0.5">{value}</p>
                {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

// PER-KEYWORD PROGRESS
// Simulates per-keyword progress using elapsed time vs estimated duration.
// Since the server action is opaque (no streaming), this gives users meaningful
// feedback instead of a generic spinner for a multi-minute operation.

function CheckProgress({ active, totalKeywords }: { active: boolean; totalKeywords: number }) {
    const [elapsed, setElapsed] = useState(0);
    const estimatedSeconds = Math.max(totalKeywords * 16, 30);

    useEffect(() => {
        if (!active) { setElapsed(0); return; }
        const id = setInterval(() => setElapsed((e) => e + 1), 1000);
        return () => clearInterval(id);
    }, [active]);

    if (!active) return null;

    const currentKw = Math.min(Math.floor(elapsed / 16) + 1, totalKeywords || 1);
    const pct = Math.min(Math.round((elapsed / estimatedSeconds) * 100), 95);

    return (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
                <span className="text-indigo-300 font-medium flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Querying Gemini — keyword {currentKw} of {totalKeywords || "…"}
                </span>
                <span className="text-indigo-400 font-mono text-xs">{pct}%</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <p className="text-[11px] text-muted-foreground">
                ~{Math.max(estimatedSeconds - elapsed, 0)}s remaining · Each keyword queries the AI model and parses the response
            </p>
        </div>
    );
}

// CUSTOM CHART TOOLTIP
// Exposes brandMentions / totalQueries so "4/7 keywords mentioned" is
// visible alongside the aggregated score percentage.

function CustomTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
        <div className="bg-zinc-900 border border-white/10 rounded-xl p-3 text-xs shadow-2xl min-w-[160px]">
            <p className="font-semibold text-white mb-2">{label}</p>
            <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Visibility</span>
                    <span className="font-bold text-violet-300">{d?.score ?? 0}%</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Mentioned</span>
                    <span className="font-bold text-emerald-300">
                        {d?.brandMentions ?? 0} / {d?.totalQueries ?? 0} kw
                    </span>
                </div>
            </div>
        </div>
    );
}

// COMPETITOR CHIPS
// Replaces the truncated `title` tooltip. Shows 2 chips inline; a toggle
// expands the rest. No data is ever hidden behind an unclickable ellipsis.

function CompetitorChips({ competitors }: { competitors: string[] }) {
    const [expanded, setExpanded] = useState(false);
    if (!competitors.length)
        return <span className="text-[11px] text-muted-foreground italic">none detected</span>;
    const visible = expanded ? competitors : competitors.slice(0, 2);
    return (
        <div className="flex flex-wrap gap-1 items-center">
            {visible.map((c) => (
                <span key={c} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-300 border border-white/10 rounded text-[10px] font-medium">
                    {c}
                </span>
            ))}
            {competitors.length > 2 && (
                <button
                    onClick={() => setExpanded((e) => !e)}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium"
                >
                    {expanded ? "less" : `+${competitors.length - 2} more`}
                </button>
            )}
        </div>
    );
}

// MODEL BADGE
// Forward-compatible: once callChatGPT() is added to aeoTrack.ts and
// aiShareOfVoice rows are stored with model = "chatgpt", this badge lights up
// automatically. Defaults to "gemini" for all existing rows.

function ModelBadge({ model = "gemini" }: { model?: string }) {
    if (model === "chatgpt")
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                ChatGPT
            </span>
        );
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold">
            Gemini
        </span>
    );
}

// FLAG BUTTON
// Gap 2: lets users flag incorrect mention detections. Visible on every row;
// especially useful for low-confidence rows. POSTs to /api/aeo/mention-flag.

function FlagButton({
    siteId, keyword, model, currentlyMentioned,
}: {
    siteId: string;
    keyword: string;
    model: string;
    currentlyMentioned: boolean;
}) {
    const [state, setState] = useState<"idle" | "loading" | "done">("idle");

    const handleFlag = async () => {
        setState("loading");
        try {
            await fetch("/api/aeo/mention-flag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    siteId,
                    keyword,
                    modelName: model ?? "gemini",
                    // Flagging means the current value is WRONG — flip it
                    correctValue: !currentlyMentioned,
                }),
            });
            setState("done");
        } catch {
            setState("idle");
        }
    };

    if (state === "done")
        return (
            <span className="text-[10px] text-emerald-400 font-medium italic">
                ✓ Flagged for review
            </span>
        );

    return (
        <button
            id={`flag-${keyword.replace(/\s+/g, "-")}`}
            onClick={handleFlag}
            disabled={state === "loading"}
            title="Flag incorrect mention detection"
            className="text-[10px] text-muted-foreground hover:text-amber-400 transition-colors disabled:opacity-40 flex items-center gap-1"
        >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H9.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
            {state === "loading" ? "…" : "Flag"}
        </button>
    );
}

// GUIDED EMPTY STATE
// Branches on whether seed keywords exist. Links to keyword setup if not,
// so users can never get stuck on this page with no path forward.

function EmptyState({
    hasSeedKeywords, onRunCheck, loading,
}: {
    hasSeedKeywords: boolean;
    onRunCheck: () => void;
    loading: boolean;
}) {
    return (
        <div className="card-surface rounded-2xl border border-dashed border-border p-12 flex flex-col items-center gap-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
            </div>
            <div>
                <h3 className="text-lg font-bold text-foreground">No visibility data yet</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    {hasSeedKeywords
                        ? "You have seed keywords ready. Run your first check to see how often Gemini mentions your brand."
                        : "You need seed keywords before tracking can begin. Add keywords that describe your product or service."}
                </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground bg-card border border-border rounded-xl px-4 py-3 max-w-sm">
                <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Each check queries Gemini for every seed keyword and records whether your brand appears in the response.
            </div>
            {hasSeedKeywords ? (
                <button
                    onClick={onRunCheck}
                    disabled={loading}
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold rounded-xl text-sm shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:opacity-90 disabled:opacity-50 transition-all"
                >
                    Run Your First Check
                </button>
            ) : (
                <Link
                    href="/dashboard/keywords"
                    className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold rounded-xl text-sm shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:opacity-90 transition-all"
                >
                    Set Up Seed Keywords →
                </Link>
            )}
        </div>
    );
}

// STATUS BANNER

function StatusBanner({ message, type }: { message: string; type: "info" | "success" | "error" }) {
    const styles = {
        info: "bg-indigo-500/10 border-indigo-500/20 text-indigo-300",
        success: "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
        error: "bg-red-500/10 border-red-500/20 text-red-300",
    };
    return (
        <div className={`text-sm p-4 rounded-xl border font-medium ${styles[type]}`}>
            {message}
        </div>
    );
}

// NO SITE SELECTED

function NoSiteSelected() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                </svg>
            </div>
            <div>
                <h2 className="text-xl font-bold mb-2">No Site Selected</h2>
                <p className="text-muted-foreground text-sm max-w-sm">
                    Select a site first to start tracking your AI Share of Voice.
                </p>
            </div>
            <Link
                href="/dashboard/sites"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 font-medium text-sm transition-all"
            >
                Go to My Sites
            </Link>
        </div>
    );
}

// MAIN COMPONENT

const PAGE_SIZE = 8;

export function AeoTrackerClient({
    siteId,
    activeDomain = "",
    userSites = [],
    seedKeywordCount = 0,
}: {
    siteId: string;
    activeDomain?: string;
    userSites?: { id: string; domain: string; grade?: string | null }[];
    seedKeywordCount?: number;
}) {
    const [loading, setLoading] = useState(false);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [chartData, setChartData] = useState<any[]>([]);
    const [status, setStatus] = useState("");
    const [statusType, setStatusType] = useState<"info" | "success" | "error">("info");
    const [diagnosis, setDiagnosis] = useState<AeoDiagnosis | null>(null);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    // table controls
    const [search, setSearch] = useState("");
    const [filterMentioned, setFilterMentioned] = useState<"all" | "mentioned" | "not_mentioned">("all");
    const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
    const [page, setPage] = useState(0);

    useEffect(() => {
        if (siteId) loadData();
    }, [siteId]);

    const loadData = async () => {
        const res = await getAeoShareOfVoiceMetrics(siteId);
        if (res.success) {
            setChartData(res.chartData ?? []);
            // Map keywordBreakdown into the metrics shape used by the table
            const mapped = (res.keywordBreakdown ?? []).map((kb) => ({
                keyword: kb.keyword,
                brandMentioned: kb.mentionRate > 0,
                mentionRate: kb.mentionRate,
                totalQueries: kb.totalQueries,
                competitorsMentioned: kb.topCompetitors.map((c) => c.name),
                topCompetitors: kb.topCompetitors,
                recordedAt: new Date().toISOString(),
                // Gap 2: surface low-confidence detections in the UI
                // mentionRate 1–39% on a keyword = borderline detection
                lowConfidence: kb.mentionRate > 0 && kb.mentionRate < 40,
            }));
            setMetrics(mapped);
        }
        try {
            const diagRes = await fetch(`/api/aeo/diagnosis?siteId=${siteId}`);
            if (diagRes.ok) setDiagnosis(await diagRes.json());
        } catch (err) {
            logger.error("Failed to load AEO diagnosis", { error: err });
        }
    };

    const handleRunCheck = async () => {
        setLoading(true);
        setStatus("");
        const res = await runAeoShareOfVoiceCheck(siteId);
        if (res.success) {
            setStatus("Check complete! Visibility data has been refreshed.");
            setStatusType("success");
            await loadData();
        } else {
            setStatus(`Error: ${res.error}`);
            setStatusType("error");
        }
        setLoading(false);
        setTimeout(() => setStatus(""), 7000);
    };


    const totalMentioned = metrics.filter((m) => m.brandMentioned).length;
    const visibilityScore =
        metrics.length > 0 ? Math.round((totalMentioned / metrics.length) * 100) : 0;
    const uniqueKeywords = metrics.length;
    const trackedKeywordCount = uniqueKeywords || 5;


    const filtered = useMemo(() => {
        let rows = [...metrics];
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter((m) => m.keyword.toLowerCase().includes(q));
        }
        if (filterMentioned === "mentioned") rows = rows.filter((m) => m.brandMentioned);
        if (filterMentioned === "not_mentioned") rows = rows.filter((m) => !m.brandMentioned);
        rows.sort((a, b) => {
            const diff = (b.mentionRate ?? 0) - (a.mentionRate ?? 0);
            return sortDir === "desc" ? diff : -diff;
        });
        return rows;
    }, [metrics, search, filterMentioned, sortDir]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    useEffect(() => setPage(0), [search, filterMentioned, sortDir]);

    if (!siteId) return <NoSiteSelected />;

    const hasData = metrics.length > 0;
    const hasSeedKeywords = seedKeywordCount > 0 || uniqueKeywords > 0;

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12 fade-in-up">

            {/* ── HEADER ─────────────────────────────────────────────────────── */}
            <div className="flex flex-wrap justify-between items-start gap-4 bg-card p-6 rounded-2xl border border-border">
                <div>
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-indigo-400">
                        AI Share of Voice Tracker
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Track how often{" "}
                        <span className="text-blue-400 font-medium">Gemini</span> mentions your
                        brand
                        {activeDomain && (
                            <> for <span className="text-foreground font-medium">{activeDomain}</span></>
                        )}
                        {" "}when users search your seed keywords.
                    </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Site switcher */}
                    {userSites.length > 0 && (
                        <KeywordSiteSwitcher
                            sites={userSites}
                            activeSiteId={siteId}
                        />
                    )}

                    {/* "Last checked X ago" */}
                    {lastChecked && (
                        <span className="text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-1.5">
                            Last checked{" "}
                            <span className="text-foreground font-medium">{timeAgo(lastChecked)}</span>
                        </span>
                    )}

                    {/* Export CSV button */}
                    {hasData && (
                        <button
                            onClick={() => exportCSV(metrics)}
                            className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Export CSV
                        </button>
                    )}

                    <button
                        onClick={handleRunCheck}
                        disabled={loading}
                        className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold rounded-xl text-sm transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading ? "Running…" : "Run Daily Check"}
                    </button>
                </div>
            </div>

            {/* ── KPI CARDS ──────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                    label="Visibility Score"
                    value={`${visibilityScore}%`}
                    sub="brand mention rate"
                    accentClass="bg-violet-500/10 text-violet-400"
                    icon={
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    }
                />
                <KpiCard
                    label="Mentions"
                    value={`${totalMentioned} / ${metrics.length}`}
                    sub="keyword checks run"
                    accentClass="bg-emerald-500/10 text-emerald-400"
                    icon={
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    }
                />
                <KpiCard
                    label="Keywords Tracked"
                    value={uniqueKeywords}
                    sub="unique seed keywords"
                    accentClass="bg-indigo-500/10 text-indigo-400"
                    icon={
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                    }
                />
                <KpiCard
                    label="Daily Snapshots"
                    value={chartData.length}
                    sub="checks completed"
                    accentClass="bg-blue-500/10 text-blue-400"
                    icon={
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    }
                />
            </div>

            {/* ── DIAGNOSIS PANEL ────────────────────────────────────────────── */}
            {diagnosis && hasData && (
                <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-bold text-foreground">Site Diagnosis</h2>
                    <AeoDiagnosisPanel diagnosis={diagnosis} />
                </div>
            )}

            {/* ── FORECAST PANEL — Gap 4 ─────────────────────────────────────── */}
            {hasData && siteId && (
                <ForecastPanel siteId={siteId} />
            )}

            {/* ── PER-KEYWORD PROGRESS ───────────────────────────────────────── */}
            <CheckProgress active={loading} totalKeywords={trackedKeywordCount} />

            {/* ── STATUS BANNER ──────────────────────────────────────────────── */}
            {status && <StatusBanner message={status} type={statusType} />}

            {/* ── CHART OR EMPTY STATE ───────────────────────────────────────── */}
            {chartData.length > 0 ? (
                <div className="card-surface p-6 rounded-2xl">
                    <h3 className="text-xs font-semibold mb-6 uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-violet-400" />
                        Brand Visibility Score Over Time
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                            <XAxis dataKey="date" stroke="#ffffff40" fontSize={11} tickMargin={15} />
                            <YAxis stroke="#ffffff40" fontSize={11} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="score"
                                stroke="#8b5cf6"
                                strokeWidth={2.5}
                                fill="url(#scoreGrad)"
                                dot={{ r: 4, fill: "#8b5cf6", strokeWidth: 0 }}
                                activeDot={{ r: 6, stroke: "#a78bfa", strokeWidth: 2 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <EmptyState
                    hasSeedKeywords={hasSeedKeywords}
                    onRunCheck={handleRunCheck}
                    loading={loading}
                />
            )}

            {/* ── KEYWORD MENTIONS TABLE ─────────────────────────────────────── */}
            {hasData && (
                <div className="card-surface p-6 rounded-2xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Keyword Mentions{" "}
                            <span className="text-foreground font-bold">{filtered.length}</span>
                        </h3>

                        {/* Search + filter + sort bar */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <input
                                    type="text"
                                    placeholder="Search keywords…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-7 pr-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50 w-40"
                                />
                            </div>

                            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                                {(["all", "mentioned", "not_mentioned"] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setFilterMentioned(f)}
                                        className={`px-3 py-1.5 transition-colors ${filterMentioned === f
                                            ? "bg-violet-500/20 text-violet-300 font-semibold"
                                            : "text-muted-foreground hover:text-foreground"
                                            }`}
                                    >
                                        {f === "not_mentioned" ? "Missed" : f === "all" ? "All" : "Mentioned"}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                                className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                            >
                                Date {sortDir === "desc" ? "↓" : "↑"}
                            </button>
                        </div>
                    </div>

                    {/* ROWS */}
                    <div className="space-y-2">
                        {pageRows.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic text-center py-6">
                                No results match your filters.
                            </p>
                        ) : (
                            pageRows.map((m) => (
                                <div
                                    key={m.id}
                                    className="flex flex-wrap items-start justify-between gap-3 p-4 bg-card rounded-xl border border-border hover:border-border/80 transition-colors"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-medium text-foreground text-sm">{m.keyword}</p>
                                            <ModelBadge model={m.model} />
                                            {/* Gap 2: low-confidence indicator */}
                                            {m.lowConfidence && (
                                                <span
                                                    title="Low-confidence detection — flag if incorrect"
                                                    className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded text-[9px] font-bold uppercase tracking-wide"
                                                >
                                                    ~uncertain
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-1">
                                            {new Date(m.recordedAt).toLocaleString(undefined, {
                                                month: "short", day: "numeric",
                                                hour: "2-digit", minute: "2-digit",
                                            })}
                                        </p>
                                        {!m.brandMentioned && (
                                            <div className="mt-2">
                                                <p className="text-[10px] text-muted-foreground mb-1">Instead recommended:</p>
                                                <CompetitorChips competitors={m.competitorsMentioned ?? []} />
                                            </div>
                                        )}
                                    </div>

                                    <div className="shrink-0 flex flex-col items-end gap-2">
                                        {m.brandMentioned ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[11px] font-bold uppercase tracking-wide">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                Recommended
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[11px] font-bold uppercase tracking-wide">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                                Not Mentioned
                                            </span>
                                        )}
                                        {/* Gap 2: flag button on every row */}
                                        <FlagButton
                                            siteId={siteId}
                                            keyword={m.keyword}
                                            model={m.model ?? "gemini"}
                                            currentlyMentioned={m.brandMentioned}
                                        />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* PAGINATION */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                            <span>
                                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                            </span>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="px-3 py-1.5 border border-border rounded-lg hover:text-foreground disabled:opacity-40 transition-colors"
                                >
                                    ← Prev
                                </button>
                                <button
                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="px-3 py-1.5 border border-border rounded-lg hover:text-foreground disabled:opacity-40 transition-colors"
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
