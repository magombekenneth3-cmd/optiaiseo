"use client";

import { useState, useEffect } from "react";
import {
    TrendingUp,
    TrendingDown,
    Minus,
    Brain,
    Zap,
    HelpCircle,
    MapPin,
    Play,
    RefreshCw,
    AlertCircle,
    ChevronDown,
    ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SerpFeaturePoint {
    capturedAt: string; // ISO string — Date objects are serialized by JSON
    keyword: string;
    hasAiOverview: boolean;
    hasSnippet: boolean;
    hasPaa: boolean;
    hasLocalPack: boolean;
    hasVideo: boolean;
    brandInAio: boolean;
}

interface SerpFeatureHistoryEntry {
    keyword: string;
    /** Chronological oldest → newest (guaranteed by server action orderBy asc). */
    snapshots: SerpFeaturePoint[];
    /** +1 = gained, -1 = lost, 0 = unchanged vs first snapshot in window. */
    aiOverviewDelta: number;
    snippetDelta: number;
}

interface ApiResponse {
    history: SerpFeatureHistoryEntry[];
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } catch {
        return "—";
    }
}

/**
 * Build a compact timeline series for one feature across all snapshots.
 * Returns an array of { date, active } objects in chronological order.
 */
function buildSeries(
    snapshots: SerpFeaturePoint[],
    field: keyof Pick<SerpFeaturePoint, "hasAiOverview" | "hasSnippet" | "hasPaa" | "hasLocalPack" | "hasVideo" | "brandInAio">,
): { date: string; active: boolean }[] {
    return snapshots.map((s) => ({ date: s.capturedAt, active: s[field] }));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeatureCell({ active, label }: { active: boolean; label: string }) {
    return (
        <td className="px-4 py-3.5 text-center">
            <span
                title={label}
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors ${
                    active
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-zinc-800/50 text-zinc-600 border border-zinc-700/30"
                }`}
            >
                {active ? "✓" : "—"}
            </span>
        </td>
    );
}

function DeltaBadge({ delta }: { delta: number }) {
    if (delta === 0) return <Minus className="w-3.5 h-3.5 text-zinc-500" />;
    if (delta > 0)
        return (
            <span className="inline-flex items-center gap-0.5 text-emerald-400">
                <TrendingUp className="w-3 h-3" />
                <span className="text-[10px] font-bold">New</span>
            </span>
        );
    return (
        <span className="inline-flex items-center gap-0.5 text-red-400">
            <TrendingDown className="w-3 h-3" />
            <span className="text-[10px] font-bold">Lost</span>
        </span>
    );
}

/**
 * Inline timeline row — CSS-only dots, no charting library.
 * Each dot represents one weekly scan. Colour signals feature presence.
 * Only rendered when the row is expanded (entry has >= 2 snapshots).
 */
function TimelineRow({
    entry,
    colSpan,
}: {
    entry: SerpFeatureHistoryEntry;
    colSpan: number;
}) {
    const { snapshots } = entry;
    if (snapshots.length < 2) return null;

    const features: {
        field: keyof Pick<SerpFeaturePoint, "hasAiOverview" | "hasSnippet" | "hasPaa" | "hasLocalPack" | "hasVideo" | "brandInAio">;
        label: string;
        color: string;
    }[] = [
        { field: "hasAiOverview", label: "AI Overview", color: "#c084fc" },
        { field: "brandInAio",    label: "Brand AIO",   color: "#fbbf24" },
        { field: "hasSnippet",    label: "Snippet",      color: "#60a5fa" },
        { field: "hasPaa",        label: "PAA",          color: "#34d399" },
        { field: "hasLocalPack",  label: "Local",        color: "#f87171" },
        { field: "hasVideo",      label: "Video",        color: "#fb923c" },
    ];

    // Limit to most recent 13 snapshots (~3 months of weekly data) to keep the row compact
    const visible = snapshots.slice(-13);
    const firstDate = shortDate(visible[0].capturedAt);
    const lastDate  = shortDate(visible[visible.length - 1].capturedAt);

    return (
        <tr className="bg-[#070a0d]">
            <td colSpan={colSpan} className="px-5 pb-3 pt-1">
                <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.08em]">
                            Weekly Snapshot History
                        </span>
                        <span className="text-[10px] text-[#6e7681] tabular-nums">
                            {firstDate} → {lastDate} · {visible.length} scan{visible.length !== 1 ? "s" : ""}
                        </span>
                    </div>

                    {/* Feature rows */}
                    <div className="flex flex-col gap-1.5">
                        {features.map(({ field, label, color }) => {
                            const series = buildSeries(visible, field);
                            const currentlyActive = series[series.length - 1]?.active ?? false;
                            const firstActive = series[0]?.active ?? false;
                            const changed = currentlyActive !== firstActive;

                            return (
                                <div key={field} className="flex items-center gap-2">
                                    {/* Label */}
                                    <span
                                        className="text-[10px] font-medium tabular-nums shrink-0"
                                        style={{ color: "#6e7681", width: 72 }}
                                    >
                                        {label}
                                    </span>

                                    {/* Dots timeline */}
                                    <div className="flex items-center gap-[3px] flex-1">
                                        {series.map((pt, i) => (
                                            <span
                                                key={i}
                                                title={`${shortDate(pt.date)}: ${pt.active ? "present" : "absent"}`}
                                                style={{
                                                    display: "inline-block",
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: "50%",
                                                    backgroundColor: pt.active ? color : "#21262d",
                                                    border: pt.active ? `1px solid ${color}55` : "1px solid #30363d",
                                                    flexShrink: 0,
                                                    transition: "background-color 0.15s",
                                                }}
                                            />
                                        ))}
                                    </div>

                                    {/* Current state + change indicator */}
                                    <span
                                        className="text-[10px] font-bold shrink-0 tabular-nums"
                                        style={{
                                            color: currentlyActive ? color : "#6e7681",
                                            minWidth: 48,
                                            textAlign: "right",
                                        }}
                                    >
                                        {currentlyActive ? "Active" : "—"}
                                        {changed && (
                                            <span
                                                style={{
                                                    color: currentlyActive ? "#34d399" : "#f87171",
                                                    marginLeft: 4,
                                                }}
                                            >
                                                {currentlyActive ? "▲" : "▼"}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Legend */}
                    <div className="mt-2 pt-2 border-t border-[#21262d] flex items-center gap-4 flex-wrap">
                        <span className="flex items-center gap-1 text-[9px] text-[#6e7681]">
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: "#388bfd", border: "1px solid #388bfd55" }} />
                            Feature present in that scan
                        </span>
                        <span className="flex items-center gap-1 text-[9px] text-[#6e7681]">
                            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: "#21262d", border: "1px solid #30363d" }} />
                            Absent
                        </span>
                        <span className="text-[9px] text-[#6e7681] ml-auto">
                            ▲ = gained · ▼ = lost vs first scan in window
                        </span>
                    </div>
                </div>
            </td>
        </tr>
    );
}

function EmptyState() {
    return (
        <div className="py-10 flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                <Brain className="w-5 h-5 text-zinc-500" />
            </div>
            <div>
                <p className="text-sm font-semibold text-zinc-300">No SERP feature data yet</p>
                <p className="text-xs text-zinc-500 mt-1">
                    SERP feature snapshots are captured weekly. Check back after the first automated scan.
                </p>
            </div>
        </div>
    );
}

/** Single-point notice — data exists but no trend can be computed yet. */
function SinglePointNotice({ entry }: { entry: SerpFeatureHistoryEntry }) {
    if (entry.snapshots.length !== 1) return null;
    return (
        <span
            className="text-[10px] text-[#6e7681] ml-1 tabular-nums"
            title="Only one scan captured so far — trend will appear after the next weekly scan"
        >
            (1 scan — trend pending)
        </span>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
    siteId: string;
}

export function SerpFeatureHistoryPanel({ siteId }: Props) {
    const [history, setHistory] = useState<SerpFeatureHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState(90);
    const [refreshKey, setRefreshKey] = useState(0);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        setError(null);

        fetch(`/api/serp-features/history?siteId=${encodeURIComponent(siteId)}&days=${days}`)
            .then(async (res) => {
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                return res.json() as Promise<ApiResponse>;
            })
            .then(({ history: h }) => {
                setHistory(h);
                // Auto-expand keywords that have a non-zero delta and ≥2 snapshots
                setExpanded(new Set(
                    h
                        .filter((e) => e.snapshots.length >= 2 && (e.aiOverviewDelta !== 0 || e.snippetDelta !== 0))
                        .map((e) => e.keyword)
                ));
            })
            .catch((err: unknown) => setError((err as Error).message ?? "Unknown error"))
            .finally(() => setLoading(false));
    }, [siteId, days, refreshKey]);

    function latestOf(entry: SerpFeatureHistoryEntry) {
        return entry.snapshots.at(-1) ?? null;
    }

    function toggleExpand(keyword: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(keyword)) {
                next.delete(keyword);
            } else {
                next.add(keyword);
            }
            return next;
        });
    }

    const COL_SPAN = 9; // keyword + 6 feature cols + 2 delta cols + scans

    return (
        <div className="rounded-2xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d]">
                <div>
                    <h3 className="text-sm font-semibold text-[#e6edf3] flex items-center gap-2">
                        <Brain className="w-4 h-4 text-purple-400" />
                        SERP Feature Tracker
                    </h3>
                    <p className="text-[11px] text-[#6e7681] mt-0.5">
                        AI Overview, Featured Snippets &amp; other SERP features per keyword — updated weekly
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="text-[11px] bg-[#161b22] border border-[#30363d] text-[#8b949e] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-500/50"
                    >
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                    </select>
                    <button
                        onClick={() => setRefreshKey((k) => k + 1)}
                        disabled={loading}
                        title="Refresh"
                        className="p-1.5 rounded-lg border border-[#30363d] text-[#6e7681] hover:text-[#e6edf3] hover:border-[#6e7681] transition-colors disabled:opacity-40"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="px-5 py-10 flex items-center justify-center gap-2 text-[#6e7681] text-sm">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Loading SERP feature history…
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="px-5 py-6 flex items-start gap-2 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Failed to load: {error}</span>
                </div>
            )}

            {/* Empty */}
            {!loading && !error && history.length === 0 && <EmptyState />}

            {/* Data table */}
            {!loading && !error && history.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                        <thead className="bg-[#0a0d11] text-[10px] font-bold text-[#6e7681] uppercase tracking-wider border-b border-[#21262d]">
                            <tr>
                                <th className="px-5 py-3 text-left">Keyword</th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <Brain className="w-3.5 h-3.5 text-purple-400" />
                                        AI Overview
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                                        Brand AIO
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <Zap className="w-3.5 h-3.5 text-blue-400" />
                                        Snippet
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                                        PAA
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <MapPin className="w-3.5 h-3.5 text-rose-400" />
                                        Local
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">
                                    <span className="flex items-center justify-center gap-1">
                                        <Play className="w-3.5 h-3.5 text-orange-400" />
                                        Video
                                    </span>
                                </th>
                                <th className="px-4 py-3 text-center">AIO Δ</th>
                                <th className="px-4 py-3 text-center">Snippet Δ</th>
                                <th className="px-4 py-3 text-center">Scans</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#161b22]">
                            {history.map((entry) => {
                                const latest = latestOf(entry);
                                const isExpanded = expanded.has(entry.keyword);
                                const hasTimeline = entry.snapshots.length >= 2;

                                return (
                                    <>
                                        <tr
                                            key={entry.keyword}
                                            className={`transition-colors ${hasTimeline ? "cursor-pointer hover:bg-[#0a0d11]/80" : "hover:bg-[#0a0d11]/60"}`}
                                            onClick={hasTimeline ? () => toggleExpand(entry.keyword) : undefined}
                                            title={hasTimeline ? (isExpanded ? "Collapse timeline" : "Expand weekly history") : undefined}
                                        >
                                            {/* Keyword cell with expand chevron */}
                                            <td className="px-5 py-3.5 font-medium text-[#e6edf3] max-w-[200px]">
                                                <span className="flex items-center gap-1.5">
                                                    {hasTimeline ? (
                                                        isExpanded
                                                            ? <ChevronDown className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                                                            : <ChevronRight className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                                                    ) : (
                                                        <span className="w-3.5 shrink-0" />
                                                    )}
                                                    <span className="truncate" title={entry.keyword}>{entry.keyword}</span>
                                                    <SinglePointNotice entry={entry} />
                                                </span>
                                            </td>
                                            <FeatureCell active={latest?.hasAiOverview ?? false} label="AI Overview present" />
                                            <FeatureCell active={latest?.brandInAio ?? false}    label="Brand cited in AI Overview" />
                                            <FeatureCell active={latest?.hasSnippet ?? false}    label="Featured snippet present" />
                                            <FeatureCell active={latest?.hasPaa ?? false}        label="People Also Ask box present" />
                                            <FeatureCell active={latest?.hasLocalPack ?? false}  label="Local pack present" />
                                            <FeatureCell active={latest?.hasVideo ?? false}      label="Video results present" />
                                            <td className="px-4 py-3.5 text-center">
                                                <DeltaBadge delta={entry.aiOverviewDelta} />
                                            </td>
                                            <td className="px-4 py-3.5 text-center">
                                                <DeltaBadge delta={entry.snippetDelta} />
                                            </td>
                                            <td className="px-4 py-3.5 text-center text-[11px] text-[#6e7681] tabular-nums">
                                                {entry.snapshots.length}
                                            </td>
                                        </tr>
                                        {/* Expandable timeline sub-row */}
                                        {isExpanded && (
                                            <TimelineRow
                                                key={`${entry.keyword}__timeline`}
                                                entry={entry}
                                                colSpan={COL_SPAN + 1}
                                            />
                                        )}
                                    </>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="px-5 py-2.5 text-[10px] text-[#6e7681] border-t border-[#21262d]">
                        ✓ = feature detected in most recent scan · Δ = change vs. first scan in window · Updated weekly · Click a row to expand timeline
                    </p>
                </div>
            )}
        </div>
    );
}
