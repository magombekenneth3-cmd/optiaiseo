"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Sparkles, RefreshCw } from "lucide-react";

interface ForecastData {
    currentCitationRate: number;
    projected90DayCitationRate: number;
    trend: "improving" | "stable" | "declining";
    topCompetitorAdvantage: string;
    keyActionsToImprove: string[];
    forecastReasoning: string;
    historyWeeksUsed: number;
    dataSparse: boolean;
    trendConfidence: number;
}

interface SnapshotPoint {
    score: number;
    date: string;
}

const TREND_META = {
    improving: { icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", glow: "shadow-[0_0_24px_rgba(52,211,153,0.12)]" },
    stable:    { icon: Minus,      color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   glow: "" },
    declining: { icon: TrendingDown,color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/20",     glow: "shadow-[0_0_24px_rgba(244,63,94,0.12)]" },
};

const W = 320;
const H = 64;
const PAD = 4;

function MiniSparkline({ historical, projected }: { historical: number[]; projected: number }) {
    if (historical.length < 2) return null;

    const allVals = [...historical, projected];
    const min = Math.min(...allVals) - 2;
    const max = Math.max(...allVals) + 2;
    const range = max - min || 1;
    const totalPts = historical.length + 3;

    const toY = (v: number) => (H - PAD) - ((v - min) / range) * (H - 2 * PAD);
    const toX = (i: number) => PAD + (i / (totalPts - 1)) * (W - 2 * PAD);

    const histPts = historical.map((v, i) => ({ x: toX(i), y: toY(v) }));
    const lastHistPt = histPts[histPts.length - 1];

    const projPts = [
        lastHistPt,
        { x: toX(historical.length + 1), y: toY(projected * 0.7 + historical[historical.length - 1] * 0.3) },
        { x: toX(historical.length + 2), y: toY(projected) },
    ];

    const histPath = histPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const projPath = projPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

    const histArea = [
        ...histPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
        `L ${lastHistPt.x.toFixed(1)} ${H - PAD}`,
        `L ${histPts[0].x.toFixed(1)} ${H - PAD}`,
        "Z",
    ].join(" ");

    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
            <defs>
                <linearGradient id="fg-hist" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map(r => (
                <line key={r} x1={PAD} y1={PAD + r * (H - 2 * PAD)} x2={W - PAD} y2={PAD + r * (H - 2 * PAD)} stroke="rgba(255,255,255,.03)" strokeWidth={1} />
            ))}
            <path d={histArea} fill="url(#fg-hist)" />
            <path d={histPath} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={projPath} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" />
            {histPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={i === histPts.length - 1 ? 3.5 : 2} fill="#10b981" opacity={i === histPts.length - 1 ? 1 : 0.35} />
            ))}
            <circle cx={projPts[projPts.length - 1].x} cy={projPts[projPts.length - 1].y} r={3.5} fill="#6366f1" opacity={0.8} />
            <circle cx={projPts[projPts.length - 1].x} cy={projPts[projPts.length - 1].y} r={7} fill="#6366f1" opacity={0.15} />
        </svg>
    );
}

export function VisibilityForecastCard({ siteId }: { siteId: string }) {
    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [snapshots, setSnapshots] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(false);
    const [showActions, setShowActions] = useState(false);

    const loadForecast = useCallback((refresh = false) => {
        const setter = refresh ? setRefreshing : setLoading;
        setter(true);
        setError(false);

        const forecastUrl = `/api/sites/${siteId}/aeo/forecast${refresh ? "?refresh=1" : ""}`;
        const snapshotUrl = `/api/sites/${siteId}/aeo/trend`;

        Promise.all([
            fetch(forecastUrl).then(r => r.json()),
            fetch(snapshotUrl).then(r => r.ok ? r.json() : { trend: [] }).catch(() => ({ trend: [] })),
        ])
            .then(([fData, sData]) => {
                if (fData.currentCitationRate !== undefined) {
                    setForecast(fData);
                } else {
                    setError(true);
                }
                const scores = (sData.trend ?? sData.snapshots ?? [])
                    .map((s: SnapshotPoint) => s.score)
                    .filter((v: number) => typeof v === "number");
                if (scores.length > 0) setSnapshots(scores);
            })
            .catch(() => setError(true))
            .finally(() => setter(false));
    }, [siteId]);

    useEffect(() => { loadForecast(); }, [loadForecast]);

    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-card p-6 animate-pulse">
                <div className="h-4 w-48 bg-muted rounded mb-4" />
                <div className="grid grid-cols-2 gap-3">
                    <div className="h-20 bg-muted rounded-lg" />
                    <div className="h-20 bg-muted rounded-lg" />
                </div>
                <div className="h-16 bg-muted rounded-lg mt-3" />
            </div>
        );
    }

    if (error || !forecast) return null;

    const { icon: TrendIcon, color: trendColor, bg: trendBg, glow } = TREND_META[forecast.trend];
    const delta = forecast.projected90DayCitationRate - forecast.currentCitationRate;
    const projColor = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-foreground";
    const confPct = Math.round(forecast.trendConfidence * 100);
    const confColor = confPct >= 70 ? "bg-emerald-500" : confPct >= 40 ? "bg-amber-500" : "bg-rose-500";

    return (
        <div className={`rounded-xl border border-border bg-card relative overflow-hidden ${glow}`}>
            <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-36 h-36 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />

            <div className="p-6 relative">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground text-sm">90-Day AI Visibility Forecast</h3>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Based on {forecast.historyWeeksUsed} week{forecast.historyWeeksUsed !== 1 ? "s" : ""} of AEO data
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border ${trendBg} ${trendColor} capitalize`}>
                            <TrendIcon className="w-3.5 h-3.5" />
                            {forecast.trend}
                        </span>
                        <button
                            onClick={() => loadForecast(true)}
                            disabled={refreshing}
                            title="Regenerate forecast"
                            className="p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                        >
                            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-muted/40 rounded-lg px-4 py-3 border border-border/60 text-center">
                        <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">Now</p>
                        <p className="text-2xl font-black tabular-nums text-foreground">
                            {forecast.currentCitationRate.toFixed(0)}
                            <span className="text-sm font-normal text-muted-foreground">%</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">AI citation rate</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg px-4 py-3 border border-border/60 text-center flex flex-col items-center justify-center">
                        <div className="flex items-baseline gap-1">
                            <span className={`text-sm font-bold ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                            </span>
                        </div>
                        <p className="text-[9px] text-muted-foreground mt-0.5">projected change</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg px-4 py-3 border border-border/60 relative text-center">
                        <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">90 Days</p>
                        <p className={`text-2xl font-black tabular-nums ${projColor}`}>
                            {forecast.projected90DayCitationRate.toFixed(0)}
                            <span className="text-sm font-normal text-muted-foreground">%</span>
                        </p>
                        {forecast.dataSparse && (
                            <span className="absolute top-1.5 right-1.5 text-[8px] text-amber-400 font-bold">±</span>
                        )}
                    </div>
                </div>

                {snapshots.length >= 2 && (
                    <div className="rounded-lg bg-muted/20 border border-border/40 overflow-hidden p-2 mb-4">
                        <MiniSparkline historical={snapshots} projected={forecast.projected90DayCitationRate} />
                        <div className="flex items-center justify-between px-1 mt-1.5">
                            <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    Historical
                                </span>
                                <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                    <span className="w-3 h-0 border-t border-dashed border-indigo-500 shrink-0" />
                                    Projected
                                </span>
                            </div>
                            <span className="text-[9px] text-muted-foreground/50">{snapshots.length} data points</span>
                        </div>
                    </div>
                )}

                {forecast.trendConfidence < 0.4 && (
                    <div className="flex items-center gap-2 mb-4 text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Low confidence — need more AEO history for a reliable projection.
                    </div>
                )}

                {forecast.topCompetitorAdvantage && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-500/5 border border-rose-500/15 mb-4">
                        <span className="text-rose-400 text-xs shrink-0 mt-0.5">⚠</span>
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-rose-300 mb-0.5">Top competitor advantage</p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">{forecast.topCompetitorAdvantage}</p>
                        </div>
                    </div>
                )}

                {forecast.keyActionsToImprove.length > 0 && (
                    <div>
                        <button
                            onClick={() => setShowActions(a => !a)}
                            className="w-full flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-2 hover:text-foreground transition-colors"
                        >
                            <span>Top actions to improve forecast ({forecast.keyActionsToImprove.length})</span>
                            <span className="text-[10px]">{showActions ? "▲" : "▼"}</span>
                        </button>
                        {showActions && (
                            <ol className="space-y-1.5">
                                {forecast.keyActionsToImprove.slice(0, 5).map((action, i) => (
                                    <li key={i} className="flex items-start gap-2 text-[12px] text-foreground/80">
                                        <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] flex items-center justify-center font-bold mt-0.5">
                                            {i + 1}
                                        </span>
                                        <span className="leading-snug">{action}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                )}

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Confidence</span>
                    <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[140px]">
                        <div
                            className={`h-full rounded-full ${confColor} transition-all duration-700`}
                            style={{ width: `${confPct}%` }}
                        />
                    </div>
                    <span className="font-semibold tabular-nums">{confPct}%</span>
                    <span className="text-muted-foreground/40 ml-auto">R² signal</span>
                </div>
            </div>
        </div>
    );
}
