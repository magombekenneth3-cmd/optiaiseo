"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Sparkles } from "lucide-react";

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

export function VisibilityForecastCard({ siteId }: { siteId: string }) {
    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        fetch(`/api/sites/${siteId}/aeo/forecast`)
            .then(r => r.json())
            .then(d => {
                if (d.currentCitationRate !== undefined) setForecast(d);
                else setError(true);
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [siteId]);

    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-card p-6 animate-pulse">
                <div className="h-4 w-48 bg-muted rounded mb-4" />
                <div className="grid grid-cols-2 gap-3">
                    <div className="h-20 bg-muted rounded-lg" />
                    <div className="h-20 bg-muted rounded-lg" />
                </div>
            </div>
        );
    }

    if (error || !forecast) return null;

    const TrendIcon =
        forecast.trend === "improving" ? TrendingUp
            : forecast.trend === "declining" ? TrendingDown
                : Minus;

    const trendColor =
        forecast.trend === "improving" ? "text-emerald-400"
            : forecast.trend === "declining" ? "text-red-400"
                : "text-muted-foreground";

    const projColor =
        forecast.projected90DayCitationRate > forecast.currentCitationRate
            ? "text-emerald-400"
            : forecast.projected90DayCitationRate < forecast.currentCitationRate
                ? "text-red-400"
                : "text-foreground";

    const delta = forecast.projected90DayCitationRate - forecast.currentCitationRate;

    return (
        <div className="rounded-xl border border-border bg-card p-6 relative overflow-hidden">
            {/* Subtle glow */}
            <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

            <div className="flex items-center justify-between mb-5 relative">
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
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${trendColor} capitalize`}>
                    <TrendIcon className="w-3.5 h-3.5" />
                    {forecast.trend}
                </div>
            </div>

            {/* Metric cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-muted/40 rounded-lg px-4 py-3 border border-border/60">
                    <p className="text-[11px] text-muted-foreground mb-1 font-medium">Today</p>
                    <p className="text-2xl font-bold text-foreground">
                        {forecast.currentCitationRate.toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">AI citation rate</p>
                </div>
                <div className="bg-muted/40 rounded-lg px-4 py-3 border border-border/60 relative">
                    <p className="text-[11px] text-muted-foreground mb-1 font-medium">In 90 days</p>
                    <div className="flex items-end gap-2">
                        <p className={`text-2xl font-bold ${projColor}`}>
                            {forecast.projected90DayCitationRate.toFixed(1)}%
                        </p>
                        {delta !== 0 && (
                            <span className={`text-xs font-semibold mb-1 ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                            </span>
                        )}
                    </div>
                    {forecast.dataSparse && (
                        <span className="absolute top-2 right-2 text-[10px] text-amber-400 font-medium">low confidence</span>
                    )}
                </div>
            </div>

            {/* Confidence warning */}
            {forecast.trendConfidence < 0.4 && (
                <div className="flex items-center gap-2 mb-4 text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    Low confidence — need more AEO history for a reliable projection.
                </div>
            )}

            {/* Top actions */}
            {forecast.keyActionsToImprove.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold text-muted-foreground mb-2">Top actions to improve forecast</p>
                    <ol className="space-y-1.5">
                        {forecast.keyActionsToImprove.slice(0, 3).map((action, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                                <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] flex items-center justify-center font-bold mt-0.5">
                                    {i + 1}
                                </span>
                                <span className="leading-snug">{action}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* Confidence meter */}
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>Confidence</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[120px]">
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.round(forecast.trendConfidence * 100)}%` }}
                    />
                </div>
                <span className="font-medium">{Math.round(forecast.trendConfidence * 100)}%</span>
            </div>
        </div>
    );
}
