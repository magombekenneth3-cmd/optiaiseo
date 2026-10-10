"use client";

import Link from "next/link";
import { ArrowRight, TrendingUp, Info } from "lucide-react";

interface BlogData {
    id: string;
    title?: string;
    status: string;
    targetKeywords?: string[];
    validationScore?: number | null;
    evidenceCoverage?: number | null;
    citationScore?: number | null;
    validationErrors?: string[] | null;
    evidenceCount?: number | null;
    evidenceTotal?: number | null;
    missingEvidence?: string[] | null;
}

function scoreLabel(score: number | null): string {
    if (score == null) return "No data";
    if (score >= 80) return "Good";
    if (score >= 60) return "Needs improvement";
    return "Needs work";
}

function scoreColor(score: number | null): string {
    if (score == null) return "text-muted-foreground/40";
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-400";
}

function barColor(score: number | null): string {
    if (score == null) return "bg-muted-foreground/20";
    if (score >= 80) return "bg-emerald-500";
    if (score >= 60) return "bg-amber-500";
    return "bg-rose-500";
}

interface NextAction {
    type: string;
    title: string;
    blogId: string;
    detail: string;
    metric?: string;
    metricLabel?: string;
    ctaLabel: string;
    insight?: string;
}

function findNextAction(blogs: BlogData[]): NextAction | null {
    const failedBlog = blogs.find(b => b.status === "FAILED");
    if (failedBlog) return { type: "Generation failed", title: failedBlog.title || "Untitled article", blogId: failedBlog.id, detail: "Retry this article before continuing the content queue", ctaLabel: "Retry generation", insight: "Generation stopped before the article was completed. Open the article queue and retry it." };

    const evidenceReview = blogs.find(b => b.status === "EVIDENCE_REVIEW");
    if (evidenceReview) {
        const coverage = evidenceReview.evidenceCoverage != null ? Math.round(Number(evidenceReview.evidenceCoverage)) : null;
        const total = evidenceReview.evidenceTotal != null ? Number(evidenceReview.evidenceTotal) : 0;
        const count = evidenceReview.evidenceCount != null ? Number(evidenceReview.evidenceCount) : 0;
        const unsupported = total > 0 ? total - count : 0;
        const missing = Array.isArray(evidenceReview.missingEvidence) ? evidenceReview.missingEvidence.length : 0;
        const claimCount = missing || unsupported;
        return {
            type: "Evidence review required",
            title: evidenceReview.title || "Untitled article",
            blogId: evidenceReview.id,
            detail: claimCount > 0
                ? `${claimCount} claim${claimCount !== 1 ? "s" : ""} need supporting evidence`
                : "Claims need verification",
            metric: coverage != null ? `${coverage}%` : undefined,
            metricLabel: "Evidence coverage",
            ctaLabel: "Review evidence",
            insight: "The article is structurally strong, but evidence coverage is limiting its readiness. Open the evidence review to inspect unsupported claims and add source-backed evidence.",
        };
    }

    const needsReview = blogs.find(b =>
        b.status === "REVIEW" || b.status === "NEEDS_REVIEW" || b.status === "REJECTED"
    );
    if (needsReview) {
        const errorCount = Array.isArray(needsReview.validationErrors) ? needsReview.validationErrors.length : 0;
        return {
            type: "Content review required",
            title: needsReview.title || "Untitled article",
            blogId: needsReview.id,
            detail: errorCount > 0
                ? `${errorCount} issue${errorCount !== 1 ? "s" : ""} need attention`
                : "Article is awaiting editorial review",
            metric: needsReview.validationScore != null ? `${Math.round(Number(needsReview.validationScore))}` : undefined,
            metricLabel: "SEO score",
            ctaLabel: "Open review",
            insight: errorCount > 0
                ? "Validation found issues that should be resolved before publishing. Review the article to address structural or content problems."
                : "This article is awaiting your editorial review. Check the content and approve or request changes.",
        };
    }

    const drafts = blogs
        .filter(b =>
            b.status !== "GENERATING" && b.status !== "QUEUED" &&
            b.status !== "PENDING" && b.status !== "FAILED" &&
            b.status !== "PUBLISHED"
        )
        .filter(b => b.validationScore != null || b.evidenceCoverage != null || b.citationScore != null);

    if (drafts.length > 0) {
        const withAvg = drafts.map(b => {
            const parts: number[] = [];
            if (b.validationScore != null) parts.push(Number(b.validationScore));
            if (b.evidenceCoverage != null) parts.push(Number(b.evidenceCoverage));
            if (b.citationScore != null) parts.push(Number(b.citationScore));
            return { blog: b, avg: parts.length > 0 ? parts.reduce((a, c) => a + c, 0) / parts.length : 100 };
        });
        withAvg.sort((a, b) => a.avg - b.avg);
        const worst = withAvg[0];
        if (worst && worst.avg < 80) {
            const b = worst.blog;
            const seo = b.validationScore != null ? Math.round(Number(b.validationScore)) : null;
            const ev = b.evidenceCoverage != null ? Math.round(Number(b.evidenceCoverage)) : null;
            const ci = b.citationScore != null ? Math.round(Number(b.citationScore)) : null;

            let weakLabel = "SEO";
            let weakVal: number | null = seo;
            let weakSuffix = "";
            if (ev != null && (weakVal == null || ev < weakVal)) { weakLabel = "Evidence coverage"; weakVal = ev; weakSuffix = "%"; }
            if (ci != null && (weakVal == null || ci < weakVal)) { weakLabel = "AI citation"; weakVal = ci; weakSuffix = ""; }

            return {
                type: `${weakLabel} needs attention`,
                title: b.title || "Untitled article",
                blogId: b.id,
                detail: `${weakLabel} score is ${weakVal != null ? weakVal + weakSuffix : "unscored"}, limiting readiness`,
                metric: weakVal != null ? `${weakVal}${weakSuffix}` : undefined,
                metricLabel: weakLabel,
                ctaLabel: "Open inspector",
            };
        }
    }

    return null;
}

export function ContentHealthRow({ blogs }: { blogs: BlogData[] }) {
    const scored = blogs.filter(
        b => b.status !== "GENERATING" && b.status !== "QUEUED" &&
             b.status !== "PENDING" && b.status !== "FAILED"
    );

    const avg = (fn: (b: BlogData) => number | null | undefined): number | null => {
        const vals = scored.map(fn).filter((v): v is number => v != null && !Number.isNaN(v));
        if (vals.length === 0) return null;
        return Math.round(vals.reduce((a, c) => a + c, 0) / vals.length);
    };

    const seoAvg = avg(b => b.validationScore);
    const evidenceAvg = avg(b => b.evidenceCoverage);
    const aiCitation = avg(b => b.citationScore);

    const parts: { value: number; weight: number }[] = [];
    if (seoAvg != null) parts.push({ value: seoAvg, weight: 0.4 });
    if (evidenceAvg != null) parts.push({ value: evidenceAvg, weight: 0.35 });
    if (aiCitation != null) parts.push({ value: aiCitation, weight: 0.25 });
    const contentReadiness = parts.length > 0
        ? Math.round(parts.reduce((sum, p) => sum + p.value * (p.weight / parts.reduce((s, q) => s + q.weight, 0)), 0))
        : null;

    const nba = findNextAction(blogs);

    const drivers = [
        { label: "SEO", value: seoAvg, suffix: "" },
        { label: "Evidence", value: evidenceAvg, suffix: "%" },
        { label: "AI Citation", value: aiCitation, suffix: "" },
    ];

    return (
        <section className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-2xl border border-white/10 bg-card/60 p-5 backdrop-blur-xl shadow-xl flex items-center justify-between gap-6">
                    <div className="flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">
                            Content Readiness & Radar
                        </p>
                        <div className="mt-2 flex items-baseline gap-2">
                            <span className={`text-4xl font-extrabold tracking-tight ${scoreColor(contentReadiness)}`}>
                                {contentReadiness ?? "—"}
                            </span>
                            <span className="text-xs font-semibold text-muted-foreground">/100</span>
                            <span className={`ml-2 text-xs font-semibold ${scoreColor(contentReadiness)}`}>
                                {scoreLabel(contentReadiness)}
                            </span>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                            {drivers.map(d => (
                                <div key={d.label} className="rounded-xl border border-white/5 bg-background/40 p-2.5">
                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                        {d.label}
                                    </p>
                                    <p className={`mt-1 text-lg font-bold tracking-tight ${scoreColor(d.value)}`}>
                                        {d.value != null ? `${d.value}${d.suffix}` : "—"}
                                    </p>
                                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border/30">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${barColor(d.value)}`}
                                            style={{ width: `${d.value ?? 0}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Radial SVG Meter Gauge */}
                    <div className="hidden sm:flex relative items-center justify-center shrink-0">
                        <svg height={88} width={88} className="-rotate-90 transform drop-shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                            <circle
                                stroke="rgba(255, 255, 255, 0.08)"
                                fill="transparent"
                                strokeWidth={7}
                                r={36}
                                cx={44}
                                cy={44}
                            />
                            <circle
                                stroke={contentReadiness != null && contentReadiness >= 80 ? "#10b981" : contentReadiness != null && contentReadiness >= 60 ? "#f59e0b" : "#f43f5e"}
                                fill="transparent"
                                strokeWidth={7}
                                strokeDasharray={`${2 * Math.PI * 36} ${2 * Math.PI * 36}`}
                                style={{ strokeDashoffset: 2 * Math.PI * 36 - ((contentReadiness ?? 0) / 100) * (2 * Math.PI * 36) }}
                                strokeLinecap="round"
                                r={36}
                                cx={44}
                                cy={44}
                                className="transition-all duration-700 ease-out"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className={`text-xl font-mono font-bold ${scoreColor(contentReadiness)}`}>
                                {contentReadiness ?? "—"}
                            </span>
                        </div>
                    </div>
                </div>

                {nba ? (
                    <div className="flex flex-col rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.04] to-card p-5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">
                            Next Best Action
                        </p>
                        <h3 className="mt-3 text-lg font-bold leading-snug text-foreground">
                            {nba.type}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground/80">
                            {nba.title}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {nba.metricLabel && nba.metric && (
                                <>
                                    <span>{nba.metricLabel} {nba.metric}</span>
                                    <span className="text-border">·</span>
                                </>
                            )}
                            <span>{nba.detail}</span>
                        </div>
                        <Link
                            href={`/dashboard/blogs?review=${nba.blogId}`}
                            className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                        >
                            {nba.ctaLabel}
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/20 p-5 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-foreground">All caught up</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            No articles need immediate attention.
                        </p>
                    </div>
                )}
            </div>

            {nba?.insight && (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/30 px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">
                                Why this is blocked
                            </p>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                {nba.insight}
                            </p>
                        </div>
                    </div>
                    <Link
                        href={`/dashboard/blogs?review=${nba.blogId}`}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                    >
                        Open inspector
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            )}
        </section>
    );
}
