"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { retryFailedBlog } from "@/app/actions/blog";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Loader2,
    RotateCcw,
    Sparkles,
} from "lucide-react";

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
    if (score == null) return "text-muted-foreground/50";
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
    tone: "danger" | "warning";
    actionKind: "retry" | "review";
    type: string;
    title: string;
    blogId: string;
    detail: string;
    metric?: string;
    metricLabel?: string;
    ctaLabel: string;
}

function findNextAction(blogs: BlogData[]): NextAction | null {
    const failedBlog = blogs.find((b) => b.status === "FAILED");
    if (failedBlog) {
        const firstErr =
            Array.isArray(failedBlog.validationErrors) && failedBlog.validationErrors[0]
                ? failedBlog.validationErrors[0]
                : null;
        return {
            tone: "danger",
            actionKind: "retry",
            type: "Generation failed",
            title: failedBlog.title || "Untitled article",
            blogId: failedBlog.id,
            detail: firstErr
                ? firstErr
                : "Generation stopped before completion. Retry to resume the content queue.",
            ctaLabel: "Retry generation",
        };
    }

    const evidenceReview = blogs.find((b) => b.status === "EVIDENCE_REVIEW");
    if (evidenceReview) {
        const coverage =
            evidenceReview.evidenceCoverage != null
                ? Math.round(Number(evidenceReview.evidenceCoverage))
                : null;
        const total = evidenceReview.evidenceTotal != null ? Number(evidenceReview.evidenceTotal) : 0;
        const count = evidenceReview.evidenceCount != null ? Number(evidenceReview.evidenceCount) : 0;
        const unsupported = total > 0 ? total - count : 0;
        const missing = Array.isArray(evidenceReview.missingEvidence)
            ? evidenceReview.missingEvidence.length
            : 0;
        const claimCount = missing || unsupported;
        return {
            tone: "warning",
            actionKind: "review",
            type: "Evidence review required",
            title: evidenceReview.title || "Untitled article",
            blogId: evidenceReview.id,
            detail:
                claimCount > 0
                    ? `${claimCount} claim${claimCount !== 1 ? "s" : ""} need source-backed evidence before publishing.`
                    : "Claims need verification before publishing.",
            metric: coverage != null ? `${coverage}%` : undefined,
            metricLabel: "Evidence",
            ctaLabel: "Review evidence",
        };
    }

    const needsReview = blogs.find(
        (b) => b.status === "REVIEW" || b.status === "NEEDS_REVIEW" || b.status === "REJECTED"
    );
    if (needsReview) {
        const errorCount = Array.isArray(needsReview.validationErrors)
            ? needsReview.validationErrors.length
            : 0;
        return {
            tone: needsReview.status === "REJECTED" ? "danger" : "warning",
            actionKind: "review",
            type: "Editorial review required",
            title: needsReview.title || "Untitled article",
            blogId: needsReview.id,
            detail:
                errorCount > 0
                    ? `${errorCount} validation issue${errorCount !== 1 ? "s" : ""} should be resolved before publishing.`
                    : "Ready for final editorial approval before publishing.",
            metric:
                needsReview.validationScore != null
                    ? `${Math.round(Number(needsReview.validationScore))}`
                    : undefined,
            metricLabel: "SEO score",
            ctaLabel: "Open review",
        };
    }

    const drafts = blogs
        .filter(
            (b) =>
                b.status !== "GENERATING" &&
                b.status !== "QUEUED" &&
                b.status !== "PENDING" &&
                b.status !== "FAILED" &&
                b.status !== "PUBLISHED"
        )
        .filter(
            (b) => b.validationScore != null || b.evidenceCoverage != null || b.citationScore != null
        );

    if (drafts.length > 0) {
        const withAvg = drafts.map((b) => {
            const parts: number[] = [];
            if (b.validationScore != null) parts.push(Number(b.validationScore));
            parts.push(b.evidenceCoverage != null ? Number(b.evidenceCoverage) : 0);
            if (b.citationScore != null) parts.push(Number(b.citationScore));
            return {
                blog: b,
                avg: parts.length > 0 ? parts.reduce((a, c) => a + c, 0) / parts.length : 100,
            };
        });
        withAvg.sort((a, b) => a.avg - b.avg);
        const worst = withAvg[0];
        if (worst && worst.avg < 80) {
            const b = worst.blog;
            const seo = b.validationScore != null ? Math.round(Number(b.validationScore)) : null;
            const ev = b.evidenceCoverage != null ? Math.round(Number(b.evidenceCoverage)) : 0;
            const ci = b.citationScore != null ? Math.round(Number(b.citationScore)) : null;

            let weakLabel = "SEO";
            let weakVal: number | null = seo;
            let weakSuffix = "";
            if (ev != null && (weakVal == null || ev < weakVal)) {
                weakLabel = "Evidence coverage";
                weakVal = ev;
                weakSuffix = "%";
            }
            if (ci != null && (weakVal == null || ci < weakVal)) {
                weakLabel = "AI citation";
                weakVal = ci;
                weakSuffix = "";
            }

            return {
                tone: "warning",
                actionKind: "review",
                type: `${weakLabel} needs attention`,
                title: b.title || "Untitled article",
                blogId: b.id,
                detail: `${weakLabel} is ${weakVal != null ? weakVal + weakSuffix : "unscored"}, limiting readiness.`,
                metric: weakVal != null ? `${weakVal}${weakSuffix}` : undefined,
                metricLabel: weakLabel,
                ctaLabel: "Open inspector",
            };
        }
    }

    return null;
}

export function ContentHealthRow({
    blogs,
    aiOpportunityCount = 0,
}: {
    blogs: BlogData[];
    aiOpportunityCount?: number;
}) {
    const router = useRouter();
    const [retryingId, setRetryingId] = useState<string | null>(null);

    const scored = blogs.filter(
        (b) =>
            b.status !== "GENERATING" &&
            b.status !== "QUEUED" &&
            b.status !== "PENDING" &&
            b.status !== "FAILED"
    );

    const avg = (fn: (b: BlogData) => number | null | undefined): number | null => {
        const vals = scored.map(fn).filter((v): v is number => v != null && !Number.isNaN(v));
        if (vals.length === 0) return null;
        return Math.round(vals.reduce((a, c) => a + c, 0) / vals.length);
    };

    const seoAvg = avg((b) => b.validationScore);
    const evidenceAvg = avg((b) => b.evidenceCoverage ?? 0);
    const aiCitation = avg((b) => b.citationScore);

    const parts: { value: number; weight: number }[] = [];
    if (seoAvg != null) parts.push({ value: seoAvg, weight: 0.4 });
    if (evidenceAvg != null) parts.push({ value: evidenceAvg, weight: 0.35 });
    if (aiCitation != null) parts.push({ value: aiCitation, weight: 0.25 });
    const contentReadiness =
        parts.length > 0
            ? Math.round(
                  parts.reduce(
                      (sum, p) => sum + p.value * (p.weight / parts.reduce((s, q) => s + q.weight, 0)),
                      0
                  )
              )
            : null;

    const nba = findNextAction(blogs);
    const hasAiCard = aiOpportunityCount > 0;

    const drivers = [
        { label: "SEO", value: seoAvg, suffix: "" },
        { label: "Evidence", value: evidenceAvg, suffix: "%" },
        { label: "AI Citation", value: aiCitation, suffix: "" },
    ];

    const handleDirectRetry = async (blogId: string) => {
        if (retryingId) return;
        setRetryingId(blogId);
        const toastId = toast.loading("Queuing retry…");
        try {
            const result = await retryFailedBlog(blogId);
            if (result && "success" in result && result.success) {
                toast.success("Retry queued! Generation will begin shortly.", { id: toastId });
                router.refresh();
            } else {
                const errMsg = result && "error" in result ? result.error : "Retry failed.";
                toast.error(errMsg ?? "Retry failed.", { id: toastId });
            }
        } catch {
            toast.error("Failed to queue retry.", { id: toastId });
        } finally {
            setRetryingId(null);
        }
    };

    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const gaugeColor =
        contentReadiness != null && contentReadiness >= 80
            ? "#10b981"
            : contentReadiness != null && contentReadiness >= 60
              ? "#f59e0b"
              : "#f43f5e";

    return (
        <section className="grid gap-3 lg:grid-cols-12">
            {/* ── Card 1: Content Readiness ──────────────────────── */}
            <div
                className={`${
                    hasAiCard ? "lg:col-span-5" : "lg:col-span-6"
                } flex flex-col justify-between rounded-xl border border-border bg-card/70 p-4`}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                            Content Readiness
                        </p>
                        <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
                            <span className={`text-3xl font-extrabold tracking-tight tabular-nums ${scoreColor(contentReadiness)}`}>
                                {contentReadiness ?? "—"}
                            </span>
                            <span className="text-xs font-medium text-muted-foreground">/100</span>
                            <span className={`ml-1.5 text-xs font-semibold ${scoreColor(contentReadiness)}`}>
                                {scoreLabel(contentReadiness)}
                            </span>
                        </div>
                    </div>

                    <div className="hidden sm:flex relative items-center justify-center shrink-0" aria-hidden="true">
                        <svg height={64} width={64} className="-rotate-90 transform">
                            <circle
                                stroke="rgba(255, 255, 255, 0.08)"
                                fill="transparent"
                                strokeWidth={6}
                                r={radius}
                                cx={32}
                                cy={32}
                            />
                            <circle
                                stroke={gaugeColor}
                                fill="transparent"
                                strokeWidth={6}
                                strokeDasharray={`${circumference} ${circumference}`}
                                style={{
                                    strokeDashoffset:
                                        circumference - ((contentReadiness ?? 0) / 100) * circumference,
                                }}
                                strokeLinecap="round"
                                r={radius}
                                cx={32}
                                cy={32}
                                className="transition-all duration-700 ease-out"
                            />
                        </svg>
                        <span className={`absolute text-sm font-mono font-bold tabular-nums ${scoreColor(contentReadiness)}`}>
                            {contentReadiness ?? "—"}
                        </span>
                    </div>
                </div>

                <div className="mt-3.5 grid grid-cols-3 gap-2">
                    {drivers.map((d) => (
                        <div key={d.label} className="rounded-lg border border-border/50 bg-background/50 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-1">
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 truncate">
                                    {d.label}
                                </span>
                                <span className={`text-xs font-bold tabular-nums ${scoreColor(d.value)}`}>
                                    {d.value != null ? `${d.value}${d.suffix}` : "—"}
                                </span>
                            </div>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border/40">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${barColor(d.value)}`}
                                    style={{ width: `${d.value ?? 0}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Card 2: Next Best Action (Semantic Status) ─────── */}
            {nba ? (
                <div
                    className={`${
                        hasAiCard ? "lg:col-span-4" : "lg:col-span-6"
                    } flex flex-col justify-between rounded-xl border p-4 ${
                        nba.tone === "danger"
                            ? "border-rose-500/30 bg-rose-500/[0.04]"
                            : "border-amber-500/25 bg-amber-500/[0.03]"
                    }`}
                >
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <span
                                className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                                    nba.tone === "danger" ? "text-rose-400" : "text-amber-400"
                                }`}
                            >
                                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                Next Best Action
                            </span>
                            {nba.metricLabel && nba.metric && (
                                <span className="text-[11px] font-mono font-semibold text-muted-foreground">
                                    {nba.metricLabel}: {nba.metric}
                                </span>
                            )}
                        </div>

                        <h3 className="mt-2 text-base font-bold leading-snug text-foreground">
                            {nba.type}
                        </h3>
                        <p className="mt-1 line-clamp-1 text-xs font-semibold text-foreground/85" title={nba.title}>
                            {nba.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {nba.detail}
                        </p>
                    </div>

                    <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
                        {nba.actionKind === "retry" ? (
                            <button
                                type="button"
                                onClick={() => void handleDirectRetry(nba.blogId)}
                                aria-disabled={retryingId === nba.blogId}
                                aria-busy={retryingId === nba.blogId}
                                className="inline-flex items-center gap-1.5 min-h-8 rounded-lg border border-rose-500/35 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                            >
                                {retryingId === nba.blogId ? (
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                ) : (
                                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                )}
                                {retryingId === nba.blogId ? "Retrying…" : nba.ctaLabel}
                            </button>
                        ) : (
                            <Link
                                href={`/dashboard/blogs?review=${nba.blogId}`}
                                className="inline-flex items-center gap-1.5 min-h-8 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                            >
                                {nba.ctaLabel}
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                        )}
                    </div>
                </div>
            ) : (
                <div
                    className={`${
                        hasAiCard ? "lg:col-span-4" : "lg:col-span-6"
                    } flex flex-col justify-center rounded-xl border border-border bg-card/50 p-4`}
                >
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground">Queue healthy</p>
                            <p className="text-xs text-muted-foreground">
                                No blocked or failing articles right now.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Card 3: AI Visibility Opportunity (Integrated, conditional) ─ */}
            {hasAiCard && (
                <div className="lg:col-span-3 flex flex-col justify-between rounded-xl border border-border bg-card/70 p-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
                                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">
                                AI Visibility
                            </span>
                        </div>

                        <h3 className="mt-2.5 text-sm font-bold text-foreground">
                            {aiOpportunityCount} article{aiOpportunityCount !== 1 ? "s" : ""} ready for AEO lift
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            Strengthen answer structure, entities, and citations to improve AI search visibility.
                        </p>
                    </div>

                    <Link
                        href="/dashboard/aeo"
                        className="mt-3.5 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 rounded"
                    >
                        Review opportunities
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                </div>
            )}
        </section>
    );
}
