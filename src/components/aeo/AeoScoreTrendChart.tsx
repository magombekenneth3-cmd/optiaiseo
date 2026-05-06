"use client";

/**
 * AeoScoreTrendChart
 * ──────────────────
 * Renders a pure-SVG sparkline of AEO score over time (last 12 reports)
 * plus a citation score line overlay.
 *
 * No external chart library — keeps bundle size zero.
 * Loads lazily on expand — no server round-trip until needed.
 */

import { useEffect, useState } from "react";
import { getAeoScoreTrend, type AeoTrendPoint } from "@/app/actions/llmMentions";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

interface Props {
    siteId: string;
    domain: string;
}

const W = 340;
const H = 80;
const PAD = 6;

function Sparkline({ points, color, label }: {
    points: { x: number; y: number }[];
    color: string;
    label: string;
}) {
    if (points.length < 2) return null;
    const pathD = points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
    const areaD = [
        ...points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
        `L ${points[points.length - 1].x.toFixed(1)} ${H - PAD}`,
        `L ${points[0].x.toFixed(1)} ${H - PAD}`,
        "Z",
    ].join(" ");

    return (
        <g aria-label={label}>
            <defs>
                <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={areaD} fill={`url(#grad-${label})`} />
            <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} opacity={i === points.length - 1 ? 1 : 0.3} />
            ))}
        </g>
    );
}

function toPlotPoints(data: AeoTrendPoint[], key: "score" | "citationScore"): { x: number; y: number }[] {
    if (data.length === 0) return [];
    const values = data.map(d => d[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return data.map((d, i) => ({
        x: PAD + (i / Math.max(data.length - 1, 1)) * (W - 2 * PAD),
        y: (H - PAD) - ((d[key] - min) / range) * (H - 2 * PAD),
    }));
}

function delta(trend: AeoTrendPoint[]): number {
    if (trend.length < 2) return 0;
    return trend[trend.length - 1].score - trend[0].score;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AeoScoreTrendChart({ siteId, domain }: Props) {
    const [trend, setTrend]   = useState<AeoTrendPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]   = useState<string | null>(null);

    useEffect(() => {
        getAeoScoreTrend(siteId).then(res => {
            if (res.success) setTrend(res.trend ?? []);
            else setError(res.error ?? "Failed to load");
            setLoading(false);
        });
    }, [siteId]);

    if (loading) return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading score trend…
        </div>
    );

    if (error || trend.length === 0) return (
        <p className="text-xs text-muted-foreground/50 italic py-2">
            {trend.length === 0 ? "Run at least 2 AEO scans to see the trend." : error}
        </p>
    );

    const scorePts   = toPlotPoints(trend, "score");
    const citePts    = toPlotPoints(trend, "citationScore");
    const d          = delta(trend);
    const latest     = trend[trend.length - 1];
    const first      = trend[0];

    return (
        <div className="flex flex-col gap-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <div>
                        <p className="text-[11px] text-muted-foreground">AEO Score Trend</p>
                        <p className="text-xs text-muted-foreground/50">{domain} · last {trend.length} scans</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-xl font-black tabular-nums text-foreground">{latest.score}</p>
                        <p className="text-[10px] text-muted-foreground">from {first.score}</p>
                    </div>
                    <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg border ${
                        d > 0  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : d < 0 ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        :         "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                    }`}>
                        {d > 0 ? <TrendingUp className="w-3 h-3" /> : d < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {d > 0 ? `+${d}` : d}
                    </span>
                </div>
            </div>

            {/* SVG Chart */}
            <div className="rounded-xl bg-muted/20 border border-border/40 overflow-hidden p-3">
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    width="100%"
                    height={H}
                    className="overflow-visible"
                    aria-label={`AEO score trend for ${domain}`}
                >
                    {/* Grid lines at 25%, 50%, 75% */}
                    {[25, 50, 75].map(y => (
                        <line
                            key={y}
                            x1={PAD} y1={H - PAD - (y / 100) * (H - 2 * PAD)}
                            x2={W - PAD} y2={H - PAD - (y / 100) * (H - 2 * PAD)}
                            stroke="rgba(255,255,255,.04)" strokeWidth={1}
                        />
                    ))}
                    <Sparkline points={scorePts}  color="#10b981" label="score" />
                    <Sparkline points={citePts}   color="#6366f1" label="citation" />
                </svg>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-2 px-1">
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        AEO Score
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                        Citation Score
                    </span>
                </div>
            </div>

            {/* Date labels */}
            <div className="flex justify-between text-[9px] text-muted-foreground/50 px-1">
                <span>{formatDate(first.date)}</span>
                <span>{formatDate(latest.date)}</span>
            </div>
        </div>
    );
}
