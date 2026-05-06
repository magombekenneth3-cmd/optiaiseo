"use client";

import type { SiteBenchmarkContext, MetricBenchmark, PercentileBand } from "@/app/actions/benchmarks";

const BAND_COLORS: Record<PercentileBand, { bar: string; text: string; bg: string; border: string }> = {
    top10:     { bar: "bg-emerald-500", text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    top25:     { bar: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/8",  border: "border-emerald-500/15" },
    above_avg: { bar: "bg-blue-400",    text: "text-blue-400",    bg: "bg-blue-500/8",     border: "border-blue-500/15"   },
    below_avg: { bar: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"  },
    bottom25:  { bar: "bg-red-400",     text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20"    },
};

function formatValue(value: number, unit: string): string {
    if (unit === "ms") return `${Math.round(value).toLocaleString()}ms`;
    if (unit === "%")  return `${Math.round(value)}%`;
    if (unit === "")   return value.toFixed(3);
    return String(Math.round(value));
}

function PercentileTrack({ metric, nicheLabel }: { metric: MetricBenchmark; nicheLabel: string }) {
    const colors    = BAND_COLORS[metric.band];
    const markerPct = metric.percentileExact;
    const fmt       = (v: number) => formatValue(v, metric.unit ?? "");

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{metric.label}</span>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{fmt(metric.yourValue)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                        {metric.bandLabel}
                    </span>
                </div>
            </div>

            <div className="relative h-6">
                <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-muted/60 overflow-hidden flex">
                    <div className="h-full bg-red-500/15"      style={{ width: "25%" }} />
                    <div className="h-full bg-amber-500/15"    style={{ width: "25%" }} />
                    <div className="h-full bg-blue-500/15"     style={{ width: "25%" }} />
                    <div className="h-full bg-emerald-500/20"  style={{ width: "25%" }} />
                </div>

                <div className="absolute inset-0 flex items-end">
                    {[
                        { pct: 25, label: "p25" },
                        { pct: 50, label: "avg" },
                        { pct: 75, label: "p75" },
                        { pct: 90, label: "p90" },
                    ].map(({ pct, label }) => (
                        <div
                            key={label}
                            className="absolute flex flex-col items-center"
                            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                        >
                            <div className="h-3 w-px bg-border" />
                            <span className="text-[9px] text-muted-foreground mt-0.5">{label}</span>
                        </div>
                    ))}
                </div>

                <div
                    className="absolute top-0 flex flex-col items-center"
                    style={{ left: `${Math.min(98, Math.max(2, markerPct))}%`, transform: "translateX(-50%)" }}
                >
                    <div className={`w-3 h-3 rounded-full border-2 border-background ${colors.bar} shadow-md z-10`} />
                    <div className={`h-3 w-px ${colors.bar} opacity-60`} />
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                {nicheLabel} median:{" "}
                <span className="font-medium">{fmt(metric.p50)}</span>
                {" · "}
                top 25%:{" "}
                <span className="font-medium">{fmt(metric.higherIsBetter ? metric.p75 : metric.p25)}</span>
                {" · "}
                <span className="text-muted-foreground/60">{metric.sampleSize.toLocaleString()} sites</span>
            </p>
        </div>
    );
}

interface BenchmarkPanelProps {
    context: SiteBenchmarkContext;
    metricsToShow?: string[];
    compact?: boolean;
}

export function BenchmarkPanel({ context, metricsToShow, compact = false }: BenchmarkPanelProps) {
    const metrics = metricsToShow
        ? context.metrics.filter((m) => metricsToShow.includes(m.metric))
        : context.metrics;

    if (metrics.length === 0) return null;

    const overallColors = BAND_COLORS[context.summary.overallBand];

    const overallLabel =
        context.summary.overallBand === "top10"     ? "top 10% overall" :
        context.summary.overallBand === "top25"     ? "top 25% overall" :
        context.summary.overallBand === "above_avg" ? "above average"   :
        context.summary.overallBand === "below_avg" ? "below average"   :
        "needs improvement";

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="font-medium">Industry benchmark</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        How you compare to {context.sampleSizeMin.toLocaleString()}+ {context.nicheLabel} on {context.techStackLabel}.
                    </p>
                </div>
                <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${overallColors.bg} ${overallColors.text} ${overallColors.border}`}>
                    {overallLabel}
                </span>
            </div>

            <div className={`rounded-lg border px-4 py-3 ${overallColors.bg} ${overallColors.border}`}>
                <p className={`text-sm font-medium ${overallColors.text}`}>
                    {context.summary.topInsight}
                </p>
            </div>

            {!compact && (
                <div className="space-y-5">
                    {metrics.map((m) => (
                        <PercentileTrack key={m.metric} metric={m} nicheLabel={context.nicheLabel} />
                    ))}
                </div>
            )}

            {compact && (
                <div className="flex flex-wrap gap-2">
                    {metrics.map((m) => {
                        const c = BAND_COLORS[m.band];
                        return (
                            <div key={m.metric} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
                                <span className="text-xs text-muted-foreground">{m.label}</span>
                                <span className={`text-xs font-bold ${c.text}`}>{formatValue(m.yourValue, m.unit ?? "")}</span>
                                <span className={`text-[10px] ${c.text}`}>{m.bandLabel}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {!compact && (context.summary.strongMetrics.length > 0 || context.summary.weakMetrics.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                    {context.summary.strongMetrics.length > 0 && (
                        <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3">
                            <p className="text-xs font-medium text-emerald-500 mb-1">Strengths</p>
                            <ul className="space-y-0.5">
                                {context.summary.strongMetrics.map((m) => (
                                    <li key={m} className="text-xs text-muted-foreground">✓ {m}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {context.summary.weakMetrics.length > 0 && (
                        <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
                            <p className="text-xs font-medium text-amber-500 mb-1">Priority gaps</p>
                            <ul className="space-y-0.5">
                                {context.summary.weakMetrics.map((m) => (
                                    <li key={m} className="text-xs text-muted-foreground">↑ {m}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {context.benchmarkUpdatedAt && (
                <p className="text-xs text-muted-foreground">
                    Benchmarks computed from {context.sampleSizeMin.toLocaleString()}+ sites ·{" "}
                    updated{" "}
                    {new Date(context.benchmarkUpdatedAt).toLocaleDateString("en-GB", {
                        day: "2-digit", month: "short", year: "numeric",
                    })}
                </p>
            )}
        </div>
    );
}

export function BenchmarkSummaryCard({ context }: { context: SiteBenchmarkContext }) {
    const colors = BAND_COLORS[context.summary.overallBand];
    const aeo    = context.metrics.find((m) => m.metric === "aeoScore");

    const overallLabel =
        context.summary.overallBand === "top10"     ? "Top 10%"       :
        context.summary.overallBand === "top25"     ? "Top 25%"       :
        context.summary.overallBand === "above_avg" ? "Above average" :
        context.summary.overallBand === "below_avg" ? "Below average" :
        "Needs work";

    return (
        <div className={`rounded-xl border p-4 ${colors.bg} ${colors.border}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <p className="text-xs font-medium text-muted-foreground">vs. {context.nicheLabel}</p>
                    <p className={`text-lg font-semibold mt-0.5 ${colors.text}`}>{overallLabel}</p>
                </div>
                {aeo && (
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">AEO</p>
                        <p className={`text-sm font-medium ${BAND_COLORS[aeo.band].text}`}>{aeo.bandLabel}</p>
                    </div>
                )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{context.summary.topInsight}</p>
        </div>
    );
}

export function BenchmarkPlaceholder({ niche, techStack }: { niche?: string | null; techStack?: string | null }) {
    if (!niche) {
        return (
            <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
                <p className="text-sm font-medium mb-1">No industry benchmark available</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Set your site&apos;s niche in Settings to unlock industry comparisons. We benchmark AEO score,
                    SEO score, and Core Web Vitals against thousands of similar sites.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <p className="text-sm font-medium mb-1">Benchmarks not available yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                We need at least 10 sites in your niche ({niche}) with {techStack} to compute reliable percentiles.
                Benchmarks update every Monday.
            </p>
        </div>
    );
}
