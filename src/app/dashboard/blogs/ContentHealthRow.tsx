"use client";

import { TrendingUp } from "lucide-react";

interface HealthMetric {
    label: string;
    value: number | null;
    suffix?: string;
    color: string;
    barColor: string;
}

export function ContentHealthRow({
    blogs,
}: {
    blogs: {
        status: string;
        validationScore?: number | null;
        evidenceCoverage?: number | null;
        citationScore?: number | null;
        validationErrors?: string[] | null;
    }[];
}) {
    // Only compute metrics from non-generating, non-failed blogs
    const scored = blogs.filter(
        b => b.status !== "GENERATING" && b.status !== "QUEUED" &&
             b.status !== "PENDING" && b.status !== "FAILED"
    );

    const avg = (fn: (b: typeof scored[0]) => number | null | undefined): number | null => {
        const vals = scored.map(fn).filter((v): v is number => v != null && !Number.isNaN(v));
        if (vals.length === 0) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const contentReadiness = avg(b => b.validationScore);
    const seoAvg = avg(b => b.validationScore);
    const evidenceAvg = avg(b => b.evidenceCoverage);
    const aiReadiness = avg(b => b.citationScore);

    // Originality: % of scored blogs without fabrication-related errors
    const origCount = scored.filter(b => {
        if (!Array.isArray(b.validationErrors)) return true;
        return !b.validationErrors.some(
            (e: string) => e.toLowerCase().includes("fabricat") ||
                           e.toLowerCase().includes("plagiar") ||
                           e.toLowerCase().includes("copied")
        );
    }).length;
    const originality = scored.length > 0
        ? Math.round((origCount / scored.length) * 100)
        : null;

    const metrics: HealthMetric[] = [
        {
            label: "Content Readiness",
            value: contentReadiness,
            suffix: "%",
            color: "text-emerald-400",
            barColor: "bg-emerald-500",
        },
        {
            label: "SEO Avg. Score",
            value: seoAvg,
            suffix: "",
            color: "text-blue-400",
            barColor: "bg-blue-500",
        },
        {
            label: "Evidence Coverage",
            value: evidenceAvg,
            suffix: "%",
            color: "text-emerald-400",
            barColor: "bg-emerald-500",
        },
        {
            label: "Originality Score",
            value: originality,
            suffix: "",
            color: "text-purple-400",
            barColor: "bg-purple-500",
        },
        {
            label: "AI Readiness",
            value: aiReadiness,
            suffix: "",
            color: "text-violet-400",
            barColor: "bg-violet-500",
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map(metric => (
                <div
                    key={metric.label}
                    className="group rounded-xl border border-border bg-card/40 px-4 py-3 transition-colors hover:bg-card/60"
                >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                        {metric.label}
                    </p>
                    <div className="mt-1.5 flex items-end justify-between gap-2">
                        <span className={`text-2xl font-bold tracking-tight ${
                            metric.value != null ? metric.color : "text-muted-foreground/30"
                        }`}>
                            {metric.value != null ? `${metric.value}${metric.suffix}` : "—"}
                        </span>
                        {metric.value != null && (
                            <span className="mb-1 flex items-center gap-0.5 text-[10px] font-medium text-emerald-400/60">
                                <TrendingUp className="h-3 w-3" />
                            </span>
                        )}
                    </div>
                    {/* Mini progress bar */}
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/30">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${metric.barColor}`}
                            style={{ width: `${metric.value ?? 0}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
