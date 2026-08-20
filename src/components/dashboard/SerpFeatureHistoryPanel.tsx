"use client";

import React from "react";
import { Bot, Zap, HelpCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { AiOverviewStats, SerpFeatureHistory } from "@/app/actions/serp-features";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
    siteId: string;
    stats: AiOverviewStats | null;
    history: SerpFeatureHistory[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
    if (delta > 0) return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
            <TrendingUp className="w-2.5 h-2.5" />+{delta}
        </span>
    );
    if (delta < 0) return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
            <TrendingDown className="w-2.5 h-2.5" />{delta}
        </span>
    );
    return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400 bg-slate-500/10 border border-slate-500/20 px-1.5 py-0.5 rounded">
            <Minus className="w-2.5 h-2.5" />—
        </span>
    );
}

/** Renders a mini grid of dots: one per snapshot, filled = feature present */
function PresenceDots({ snapshots, field }: {
    snapshots: SerpFeatureHistory["snapshots"];
    field: "hasAiOverview" | "hasSnippet" | "hasPaa" | "hasLocalPack" | "hasVideo";
}) {
    const visible = snapshots.slice(-12); // show last 12 weeks max
    return (
        <div className="flex items-center gap-0.5">
            {visible.map((s, i) => (
                <span
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${s[field] ? "bg-emerald-400" : "bg-slate-700"}`}
                    title={`${new Date(s.capturedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}: ${s[field] ? "✓" : "✗"}`}
                />
            ))}
        </div>
    );
}

/** Stat summary tile */
function StatTile({
    icon: Icon,
    label,
    value,
    subLabel,
    color,
}: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    subLabel?: string;
    color: string;
}) {
    return (
        <div className="flex flex-col gap-1 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${color} opacity-80`}>
                <Icon className="w-3 h-3" />
                {label}
            </div>
            <div className={`text-xl font-extrabold tabular-nums ${color}`}>
                {typeof value === "number" ? `${value}%` : value}
            </div>
            {subLabel && (
                <div className="text-[10px] text-slate-400 leading-tight">{subLabel}</div>
            )}
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SerpFeatureHistoryPanel({ siteId, stats, history }: Props) {
    const hasStats = stats && stats.totalTracked > 0;
    const hasHistory = history.length > 0;

    // Empty state
    if (!hasStats && !hasHistory) {
        return (
            <div className="card-surface p-6">
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-cyan-400" />
                    </div>
                    <h2 className="text-sm font-semibold">SERP Feature History</h2>
                </div>
                <div className="py-6 text-center text-xs text-slate-400 space-y-1">
                    <div className="text-2xl mb-2">📡</div>
                    <p className="font-medium text-slate-300">No SERP feature data yet</p>
                    <p>Tracking starts automatically once keywords are added and the weekly snapshot cron runs.</p>
                    <Link
                        href={`/dashboard/keywords?siteId=${siteId}`}
                        className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                        Add keywords to track →
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="card-surface p-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                        <Bot className="w-3.5 h-3.5 text-cyan-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold leading-tight">SERP Feature History</h2>
                        <p className="text-[10px] text-slate-400 leading-tight">AI Overview · Snippet · PAA · 90-day window</p>
                    </div>
                </div>
                <Link
                    href={`/dashboard/keywords?siteId=${siteId}`}
                    className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                    All keywords →
                </Link>
            </div>

            {/* Summary Tiles */}
            {hasStats && (
                <div className="grid grid-cols-2 gap-2">
                    <StatTile
                        icon={Bot}
                        label="AI Overview"
                        value={stats.aioRate}
                        subLabel={`${stats.withAiOverview} of ${stats.totalTracked} keywords`}
                        color="text-cyan-400"
                    />
                    <StatTile
                        icon={Zap}
                        label="Brand in AIO"
                        value={stats.brandAioRate}
                        subLabel={`Brand cited in ${stats.brandInAio} AIO${stats.brandInAio !== 1 ? "s" : ""}`}
                        color="text-emerald-400"
                    />
                    <StatTile
                        icon={HelpCircle}
                        label="Feat. Snippet"
                        value={stats.totalTracked > 0 ? Math.round((stats.withSnippet / stats.totalTracked) * 100) : 0}
                        subLabel={`${stats.withSnippet} keywords have snippets`}
                        color="text-purple-400"
                    />
                    <StatTile
                        icon={HelpCircle}
                        label="PAA"
                        value={stats.totalTracked > 0 ? Math.round((stats.withPaa / stats.totalTracked) * 100) : 0}
                        subLabel={`${stats.withPaa} keywords trigger PAA`}
                        color="text-amber-400"
                    />
                </div>
            )}

            {/* Per-Keyword History Table */}
            {hasHistory && (
                <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Per-Keyword Trend (dots = weekly snapshots)
                    </p>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 mb-0.5">
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Keyword</span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider text-center w-24">AIO</span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider text-center w-24">Snippet</span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider text-right w-10">Δ</span>
                    </div>

                    <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-0.5">
                        {history.slice(0, 10).map((kw) => (
                            <div
                                key={kw.keyword}
                                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
                            >
                                {/* Keyword */}
                                <span
                                    className="text-xs font-medium text-slate-200 truncate"
                                    title={kw.keyword}
                                >
                                    {kw.keyword}
                                </span>

                                {/* AIO presence dots */}
                                <div className="w-24">
                                    <PresenceDots snapshots={kw.snapshots} field="hasAiOverview" />
                                </div>

                                {/* Snippet presence dots */}
                                <div className="w-24">
                                    <PresenceDots snapshots={kw.snapshots} field="hasSnippet" />
                                </div>

                                {/* Net delta (AIO + Snippet combined) */}
                                <div className="w-10 flex justify-end">
                                    <DeltaBadge delta={kw.aiOverviewDelta + kw.snippetDelta} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Present
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-slate-700 inline-block" /> Absent
                        </span>
                        <span className="ml-auto">Δ = net change (AIO + Snippet)</span>
                    </div>
                </div>
            )}

            {/* Feature breakdown for current snapshot */}
            {hasStats && stats.keywords.length > 0 && (
                <div className="pt-3 border-t border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Latest snapshot — feature presence
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                        {[
                            { label: "AI Overview", icon: Bot, count: stats.withAiOverview, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
                            { label: "Featured Snippet", icon: Zap, count: stats.withSnippet, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
                            { label: "People Also Ask", icon: HelpCircle, count: stats.withPaa, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                        ].map(({ label, icon: Icon, count, color, bg }) => (
                            <div key={label} className={`flex flex-col items-center gap-1 p-2 rounded-lg border ${bg}`}>
                                <Icon className={`w-3.5 h-3.5 ${color}`} />
                                <span className={`text-sm font-bold tabular-nums ${color}`}>{count}</span>
                                <span className="text-slate-400 text-center leading-tight">{label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
