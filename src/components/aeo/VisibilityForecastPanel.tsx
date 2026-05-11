"use client";

/**
 * VisibilityForecastPanel
 * ───────────────────────
 * Surfaces the existing /api/aeo/forecast endpoint inside the AEO expanded
 * SiteRow. Shows projected 90-day citation rate, trend badge, confidence bar,
 * top competitor advantage, ranked action list, and Gemini reasoning.
 *
 * Gated to PRO/AGENCY — tier is self-fetched from /api/credits/balance so
 * no prop is required from the parent client component.
 * No credits consumed — forecast uses cached AeoSnapshot history.
 */

import { useEffect, useState, useCallback } from "react";
import {
    TrendingUp, TrendingDown, Minus, Loader2,
    Lock, Sparkles, Target, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";

interface VisibilityForecast {
    currentCitationRate:        number;
    projected90DayCitationRate: number;
    trend:                      "improving" | "stable" | "declining";
    topCompetitorAdvantage:     string;
    keyActionsToImprove:        string[];
    forecastReasoning:          string;
    generatedAt:                string;
    historyWeeksUsed:           number;
    dataSparse:                 boolean;
    trendConfidence:            number;
}

interface Props {
    siteId: string;
}

const TREND_META = {
    improving: {
        icon:  TrendingUp,
        color: "text-emerald-400",
        badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        label: "Improving",
    },
    stable: {
        icon:  Minus,
        color: "text-amber-400",
        badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        label: "Stable",
    },
    declining: {
        icon:  TrendingDown,
        color: "text-rose-400",
        badge: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        label: "Declining",
    },
};

const GATED_TIERS = new Set(["PRO", "AGENCY"]);

export function VisibilityForecastPanel({ siteId }: Props) {
    const [forecast,     setForecast]     = useState<VisibilityForecast | null>(null);
    const [loading,      setLoading]      = useState(false);
    const [error,        setError]        = useState<string | null>(null);
    const [expanded,     setExpanded]     = useState(false);
    const [showReasoning, setShowReasoning] = useState(false);
    const [userTier,     setUserTier]     = useState<string | null>(null); // null = loading

    // Fetch tier from the same balance endpoint used by CreditUsagePanel
    useEffect(() => {
        fetch("/api/credits/balance")
            .then(r => r.ok ? r.json() : null)
            .then(d => setUserTier(d?.subscriptionTier ?? "FREE"))
            .catch(() => setUserTier("FREE"));
    }, []);

    const isGated = userTier !== null && !GATED_TIERS.has(userTier);

    const loadForecast = useCallback((refresh = false) => {
        if (userTier === null || isGated) return;
        setLoading(true);
        setError(null);
        const url = `/api/aeo/forecast?siteId=${siteId}${refresh ? "&refresh=1" : ""}`;
        fetch(url)
            .then(r => r.json())
            .then(data => {
                if (data.error) setError(data.error);
                else setForecast(data);
            })
            .catch(() => setError("Failed to load forecast."))
            .finally(() => setLoading(false));
    }, [siteId, isGated, userTier]);

    useEffect(() => {
        loadForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, isGated, userTier]);

    if (userTier !== null && isGated) {
        return (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-5 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">90-Day AI Visibility Forecast</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Upgrade to <strong className="text-foreground">PRO or Agency</strong> to see where your AI citation rate is heading.
                    </p>
                </div>
                <a
                    href="/dashboard/billing"
                    className="shrink-0 text-xs font-bold px-3.5 py-2 rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
                >
                    Upgrade →
                </a>
            </div>
        );
    }

    if (userTier === null || loading) {
        return (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                {userTier === null ? "Checking access…" : "Generating 90-day visibility forecast…"}
            </div>
        );
    }

    if (error || !forecast) {
        return (
            <p className="text-xs text-muted-foreground/60 italic py-2">
                {error ?? "Run an AEO scan to generate your forecast."}
            </p>
        );
    }

    // First-run onboarding: library is complete but no audit data yet
    if (forecast.historyWeeksUsed === 0) {
        return (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-5 flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">90-Day AI Visibility Forecast</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Run your first <strong className="text-foreground">AEO Deep Audit</strong> to generate a
                    baseline. The forecast engine will project your 90-day AI citation trajectory once at
                    least one audit snapshot is saved.
                </p>
                <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground/60">Steps: AEO Scan → Deep Audit → return here</span>
                </div>
            </div>
        );
    }

    const { icon: TrendIcon, color: trendColor, badge: trendBadge, label: trendLabel } =
        TREND_META[forecast.trend];

    const delta    = forecast.projected90DayCitationRate - forecast.currentCitationRate;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(0)}%` : `${delta.toFixed(0)}%`;

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">90-Day AI Visibility Forecast</p>
                    <p className="text-[11px] text-muted-foreground">
                        Based on {forecast.historyWeeksUsed} weeks of AEO history
                        {forecast.dataSparse && " · limited data — confidence low"}
                    </p>
                </div>
                {/* Refresh button — busts Redis cache */}
                <button
                    onClick={() => loadForecast(true)}
                    disabled={loading}
                    title="Regenerate forecast (ignores 15-min cache)"
                    className="shrink-0 p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Metric row */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-muted/20 border border-border/50 p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Now</p>
                    <p className="text-2xl font-black tabular-nums text-foreground">
                        {forecast.currentCitationRate.toFixed(0)}
                        <span className="text-sm font-normal text-muted-foreground">%</span>
                    </p>
                </div>

                <div className="rounded-xl bg-muted/20 border border-border/50 p-3 flex flex-col items-center justify-center gap-1">
                    <span className={`flex items-center gap-1 text-sm font-bold px-2 py-0.5 rounded-lg border ${trendBadge}`}>
                        <TrendIcon className="w-3.5 h-3.5" />
                        {trendLabel}
                    </span>
                    <span className={`text-xs font-semibold tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {deltaStr} in 90d
                    </span>
                </div>

                <div className="rounded-xl bg-muted/20 border border-border/50 p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">90 Days</p>
                    <p className={`text-2xl font-black tabular-nums ${trendColor}`}>
                        {forecast.projected90DayCitationRate.toFixed(0)}
                        <span className="text-sm font-normal text-muted-foreground">%</span>
                    </p>
                </div>
            </div>

            {/* Confidence bar */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">Forecast confidence</span>
                    <span className="text-[10px] font-semibold text-foreground tabular-nums">
                        {Math.round(forecast.trendConfidence * 100)}%
                    </span>
                </div>
                <div className="w-full h-1 bg-muted/40 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${
                            forecast.trendConfidence >= 0.7 ? "bg-emerald-500"
                            : forecast.trendConfidence >= 0.4 ? "bg-amber-500"
                            : "bg-rose-500"
                        }`}
                        style={{ width: `${forecast.trendConfidence * 100}%` }}
                    />
                </div>
            </div>

            {/* Top competitor advantage */}
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/15">
                <Target className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                    <p className="text-[11px] font-semibold text-rose-300 mb-0.5">Top competitor advantage</p>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{forecast.topCompetitorAdvantage}</p>
                </div>
            </div>

            {/* Key actions — collapsible */}
            {forecast.keyActionsToImprove.length > 0 && (
                <div>
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="w-full flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors mb-2"
                    >
                        Key actions to improve ({forecast.keyActionsToImprove.length})
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {expanded && (
                        <ul className="space-y-1.5">
                            {forecast.keyActionsToImprove.map((action, i) => (
                                <li key={i} className="flex items-start gap-2.5 text-[12px] text-muted-foreground">
                                    <span className="w-4 h-4 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-[9px] font-bold text-violet-400 shrink-0 mt-0.5">
                                        {i + 1}
                                    </span>
                                    {action}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Gemini reasoning — collapsed by default */}
            {forecast.forecastReasoning && (
                <div>
                    <button
                        onClick={() => setShowReasoning(r => !r)}
                        className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                        <Sparkles className="w-3 h-3" />
                        {showReasoning ? "Hide" : "Show"} Gemini reasoning
                    </button>
                    {showReasoning && (
                        <p className="mt-2 text-[11px] text-muted-foreground/70 leading-relaxed border-l-2 border-violet-500/30 pl-3 italic">
                            {forecast.forecastReasoning}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
