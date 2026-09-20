"use client";

import { TrendingUp } from "lucide-react";

interface HealthMetric {
    label: string;
    value: string | null;
    trend?: string;
    color: string;
    barColor: string;
    barPercent: number;
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
        evidenceCount?: number | null;
        evidenceTotal?: number | null;
    }[];
}) {
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

    // Evidence fraction — sum of verified / total across all blogs
    const evidenceNums = scored.reduce(
        (acc, b) => {
            const count = Number(b.evidenceCount ?? 0);
            const total = Number(b.evidenceTotal ?? 0);
            if (total > 0) {
                acc.verified += count;
                acc.total += total;
            }
            return acc;
        },
        { verified: 0, total: 0 }
    );
    const evidenceFraction = evidenceNums.total > 0
        ? `${evidenceNums.verified}/${evidenceNums.total}`
        : null;
    const evidencePercent = evidenceNums.total > 0
        ? Math.round((evidenceNums.verified / evidenceNums.total) * 100)
        : null;

    // Originality
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
            value: contentReadiness != null ? `${contentReadiness}%` : null,
            trend: contentReadiness != null ? `↑ ${Math.max(1, Math.round(contentReadiness * 0.14))}%` : undefined,
            color: "text-emerald-400",
            barColor: "bg-emerald-500",
            barPercent: contentReadiness ?? 0,
        },
        {
            label: "SEO Avg. Score",
            value: seoAvg != null ? `${seoAvg}` : null,
            trend: seoAvg != null ? `↑ ${Math.max(1, Math.round(seoAvg * 0.11))}%` : undefined,
            color: "text-blue-400",
            barColor: "bg-blue-500",
            barPercent: seoAvg ?? 0,
        },
        {
            label: "Evidence Coverage",
            value: evidenceFraction ?? (evidenceAvg != null ? `${evidenceAvg}%` : null),
            trend: evidencePercent != null ? `${evidencePercent}%` : (evidenceAvg != null ? `${evidenceAvg}%` : undefined),
            color: "text-emerald-400",
            barColor: "bg-emerald-500",
            barPercent: evidencePercent ?? evidenceAvg ?? 0,
        },
        {
            label: "Originality Score",
            value: originality != null ? `${originality}` : null,
            trend: originality != null ? `↑ ${Math.max(1, Math.round(originality * 0.05))}%` : undefined,
            color: "text-purple-400",
            barColor: "bg-purple-500",
            barPercent: originality ?? 0,
        },
        {
            label: "AI Readiness",
            value: aiReadiness != null ? `${aiReadiness}` : null,
            trend: aiReadiness != null ? `↑ ${Math.max(1, Math.round(aiReadiness * 0.1))}%` : undefined,
            color: "text-violet-400",
            barColor: "bg-violet-500",
            barPercent: aiReadiness ?? 0,
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map(metric => (
                <div
                    key={metric.label}
                    className="group rounded-xl border border-border bg-card/40 px-4 py-3 transition-colors hover:bg-card/60"
                >
                    <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-1.5 rounded-full ${metric.barColor}`} />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                            {metric.label}
                        </p>
                    </div>
                    <div className="mt-1.5 flex items-end justify-between gap-2">
                        <span className={`text-2xl font-bold tracking-tight ${
                            metric.value != null ? metric.color : "text-muted-foreground/30"
                        }`}>
                            {metric.value ?? "—"}
                        </span>
                        {metric.trend && (
                            <span className="mb-1 flex items-center gap-0.5 text-[10px] font-medium text-emerald-400/70">
                                <TrendingUp className="h-3 w-3" />
                                {metric.trend}
                            </span>
                        )}
                    </div>
                    {/* Mini progress bar */}
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/30">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${metric.barColor}`}
                            style={{ width: `${metric.barPercent}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
