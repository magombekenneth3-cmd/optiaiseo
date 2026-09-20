"use client";

import { logger } from "@/lib/logger";
import {
    AlertTriangle,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleDot,
    Clock3,
    ExternalLink,
    Eye,
    FileText,
    Filter,
    Hash,
    Link as LinkIcon,
    Loader2,
    MoreHorizontal,
    RefreshCw,
    Search,
    Shield,
    Sparkles,
    X,
    Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBlogModal } from "./ReviewBlogModal";
import { InternalLinksModal } from "./InternalLinksModal";
import { RepurposeTab } from "@/components/blog/RepurposeTab";
import { toast } from "sonner";
import {
    HashnodeIcon,
    MediumIcon,
    WordPressIcon,
    GhostIcon,
} from "@/components/icons/platforms";

type BlogStatus =
    | "PUBLISHED"
    | "DRAFT"
    | "REVIEW"
    | "NEEDS_REVIEW"
    | "EVIDENCE_REVIEW"
    | "REJECTED"
    | "GENERATING"
    | "QUEUED"
    | "PENDING"
    | "FAILED"
    | string;

type Blog = {
    id: string;
    siteId?: string;
    title?: string;
    slug?: string;
    content?: string;
    status: BlogStatus;
    createdAt: string | Date;
    updatedAt?: string | Date;
    targetKeywords?: string[];
    validationScore?: number | null;
    validationErrors?: string[] | null;
    citationScore?: number | null;
    citationCriteria?: unknown;
    /** 0–100 evidence coverage %, populated by evidence-extractor */
    evidenceCoverage?: number | null;
    /** Unsourced claim descriptions (subset of validationErrors) */
    missingEvidence?: string[] | null;
    hashnodeUrl?: string | null;
    mediumUrl?: string | null;
    wordPressUrl?: string | null;
    ghostUrl?: string | null;
    [key: string]: any;
};

type FilterStatus =
    | "ALL"
    | "DRAFT"
    | "REVIEW"
    | "PUBLISHED"
    | "FAILED"
    | "GENERATING"
    | "WRITING"
    | "EVIDENCE"
    | "READY"
    | "ISSUES";

type SortOption =
    | "UPDATED_DESC"
    | "CREATED_DESC"
    | "CREATED_ASC"
    | "SCORE_DESC";

const PAGE_SIZE = 10;
const TEN_MINUTES_MS = 10 * 60 * 1000;

function formatDate(value?: string | Date) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function formatRelativeDate(value?: string | Date) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const diff = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "Just now";
    if (diff < hour) {
        const minutes = Math.floor(diff / minute);
        return `${minutes}m ago`;
    }
    if (diff < day) {
        const hours = Math.floor(diff / hour);
        return `${hours}h ago`;
    }
    if (diff < 7 * day) {
        const days = Math.floor(diff / day);
        return `${days}d ago`;
    }
    return formatDate(value);
}

function isReviewStatus(status: BlogStatus) {
    return status === "REVIEW" || status === "NEEDS_REVIEW" || status === "EVIDENCE_REVIEW";
}

function isEditorialRejection(status: BlogStatus) {
    return status === "REJECTED";
}

function isGeneratingStatus(status: BlogStatus) {
    return status === "GENERATING" || status === "QUEUED" || status === "PENDING";
}

function isStuckBlog(blog: Blog) {
    if (blog.status !== "GENERATING" && blog.status !== "QUEUED") return false;
    const createdAt = new Date(blog.createdAt).getTime();
    if (Number.isNaN(createdAt)) return false;
    return Date.now() - createdAt > TEN_MINUTES_MS;
}

function getBlogUrl(blog: Blog) {
    if (blog.status !== "PUBLISHED") return null;
    return blog.hashnodeUrl || blog.mediumUrl || null;
}

function getQualityState(blog: Blog) {
    const score = blog.validationScore == null ? null : Number(blog.validationScore);
    const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
    if (hasErrors || (score != null && score < 60)) return "attention";
    if (score != null && score < 80) return "improve";
    if (score != null) return "strong";
    return "unknown";
}

function computeHealthScore(blog: Blog): number | null {
    const seo = blog.validationScore == null ? null : Number(blog.validationScore);
    const evidence = blog.evidenceCoverage == null ? null : Number(blog.evidenceCoverage);
    const citation = blog.citationScore == null ? null : Number(blog.citationScore);

    const parts: { value: number; weight: number }[] = [];
    if (seo != null && !Number.isNaN(seo)) parts.push({ value: seo, weight: 0.4 });
    if (evidence != null && !Number.isNaN(evidence)) parts.push({ value: evidence, weight: 0.35 });
    if (citation != null && !Number.isNaN(citation)) parts.push({ value: citation, weight: 0.25 });

    if (parts.length === 0) return null;

    // Normalize weights to sum to 1
    const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
    const score = parts.reduce((sum, p) => sum + p.value * (p.weight / totalWeight), 0);
    return Math.max(0, Math.min(100, Math.round(score)));
}

function getStatusConfig(blog: Blog) {
    if (blog.status === "PUBLISHED") {
        return {
            label: "Published",
            className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
            dot: "bg-emerald-400",
        };
    }
    if (blog.status === "DRAFT") {
        return {
            label: "Draft",
            className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
            dot: "bg-amber-400",
        };
    }
    if (blog.status === "EVIDENCE_REVIEW") {
        return {
            label: "Evidence review",
            className: "border-violet-500/20 bg-violet-500/10 text-violet-400",
            dot: "bg-violet-400",
        };
    }
    if (isEditorialRejection(blog.status)) {
        return {
            label: "Rejected",
            className: "border-red-500/20 bg-red-500/10 text-red-400",
            dot: "bg-red-400",
        };
    }
    if (isReviewStatus(blog.status)) {
        return {
            label: "Needs review",
            className: "border-orange-500/20 bg-orange-500/10 text-orange-400",
            dot: "bg-orange-400",
        };
    }
    if (blog.status === "FAILED") {
        return {
            label: "Failed",
            className: "border-red-500/20 bg-red-500/10 text-red-400",
            dot: "bg-red-400",
        };
    }
    if (isGeneratingStatus(blog.status)) {
        if (isStuckBlog(blog)) {
            return {
                label: "Paused",
                className: "border-amber-500/20 bg-amber-500/10 text-amber-400",
                dot: "bg-amber-400",
            };
        }
        return {
            label: "Writing",
            className: "border-blue-500/20 bg-blue-500/10 text-blue-400",
            dot: "bg-blue-400",
        };
    }
    return {
        label: blog.status
            ? blog.status.charAt(0) + blog.status.slice(1).toLowerCase()
            : "Unknown",
        className: "border-border bg-muted text-muted-foreground",
        dot: "bg-muted-foreground",
    };
}

function StatusBadge({ blog }: { blog: Blog }) {
    const config = getStatusConfig(blog);
    const generating = isGeneratingStatus(blog.status) && !isStuckBlog(blog);
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
        >
            {generating ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
            )}
            {config.label}
        </span>
    );
}

function QualityScore({ blog }: { blog: Blog }) {
    const score =
        blog.validationScore == null
            ? null
            : Math.max(0, Math.min(100, Number(blog.validationScore)));
    const state = getQualityState(blog);

    if (score == null) {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/40">
                    <span className="text-[10px]">—</span>
                </div>
                <div className="hidden lg:block">
                    <div className="font-medium text-muted-foreground">Not scored</div>
                    <div className="text-[11px]">Awaiting validation</div>
                </div>
            </div>
        );
    }

    const ring =
        state === "attention"
            ? "border-red-500/40 text-red-400"
            : state === "improve"
              ? "border-amber-500/40 text-amber-400"
              : "border-emerald-500/40 text-emerald-400";

    const label =
        state === "attention" ? "Attention" : state === "improve" ? "Improve" : "Strong";

    return (
        <div
            className="flex items-center gap-2"
            title={
                Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0
                    ? blog.validationErrors.slice(0, 3).join(" · ")
                    : `${score}/100`
            }
        >
            <div
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold ${ring}`}
            >
                <span>{score}</span>
            </div>
            <div className="hidden lg:block">
                <div className="text-xs font-semibold text-foreground">{label}</div>
                <div className="text-[11px] text-muted-foreground">SEO score</div>
            </div>
        </div>
    );
}

/**
 * Evidence Coverage Badge — shows how well the blog's claims are sourced.
 * Coverage % is read from blog.evidenceCoverage (0–100).
 * Falls back gracefully for older blogs that predate the evidence pipeline.
 */
function EvidenceBadge({ blog }: { blog: Blog }) {
    const [expanded, setExpanded] = useState(false);

    // Derive coverage from stored field or infer from status
    const coverage: number | null =
        blog.evidenceCoverage != null
            ? Math.max(0, Math.min(100, Number(blog.evidenceCoverage)))
            : blog.status === "EVIDENCE_REVIEW"
              ? 35 // evidence gate blocked — coverage was below threshold
              : null;

    // Unsourced claims — from missingEvidence field or parsed from validationErrors
    const missing: string[] = (
        blog.missingEvidence ??
        (Array.isArray(blog.validationErrors)
            ? blog.validationErrors.filter((e: string) =>
                  e.toLowerCase().includes("unsourced") ||
                  e.toLowerCase().includes("evidence") ||
                  e.toLowerCase().includes("statistic")
              )
            : [])
    ).slice(0, 5);

    if (coverage === null) {
        return (
            <span
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/40"
                title="Evidence coverage not yet computed"
            >
                <Shield className="h-3 w-3" />
                <span className="hidden lg:inline">—</span>
            </span>
        );
    }

    const tier =
        coverage >= 80 ? "strong" : coverage >= 42 ? "partial" : "weak";

    const tierConfig = {
        strong: {
            bar: "bg-emerald-500",
            text: "text-emerald-400",
            border: "border-emerald-500/30",
            bg: "bg-emerald-500/10",
            label: "Sourced",
        },
        partial: {
            bar: "bg-amber-500",
            text: "text-amber-400",
            border: "border-amber-500/30",
            bg: "bg-amber-500/10",
            label: "Partial",
        },
        weak: {
            bar: "bg-rose-500",
            text: "text-rose-400",
            border: "border-rose-500/30",
            bg: "bg-rose-500/10",
            label: "Weak",
        },
    }[tier];

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                title={`Evidence coverage: ${coverage}%`}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors hover:opacity-80 ${tierConfig.border} ${tierConfig.bg} ${tierConfig.text}`}
            >
                <Shield className="h-3 w-3 shrink-0" />
                <span>{coverage}%</span>
                {/* Mini progress bar */}
                <span className="hidden lg:flex h-1 w-10 overflow-hidden rounded-full bg-white/10">
                    <span
                        className={`h-full rounded-full ${tierConfig.bar} transition-all`}
                        style={{ width: `${coverage}%` }}
                    />
                </span>
            </button>

            {/* Expanded popover — unsourced claims list */}
            {expanded && (
                <div
                    className="absolute left-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
                    onMouseLeave={() => setExpanded(false)}
                >
                    <div className={`flex items-center justify-between border-b border-border px-3 py-2 ${tierConfig.bg}`}>
                        <div className="flex items-center gap-1.5">
                            <Shield className={`h-3.5 w-3.5 ${tierConfig.text}`} />
                            <span className={`text-xs font-bold ${tierConfig.text}`}>
                                Evidence Coverage · {coverage}%
                            </span>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tierConfig.bg} ${tierConfig.border} border ${tierConfig.text}`}>
                            {tierConfig.label}
                        </span>
                    </div>

                    {/* Coverage bar */}
                    <div className="px-3 pt-3 pb-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                            <div
                                className={`h-full rounded-full transition-all ${tierConfig.bar}`}
                                style={{ width: `${coverage}%` }}
                            />
                        </div>
                    </div>

                    {missing.length > 0 ? (
                        <div className="px-3 py-2">
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                Unsourced claims
                            </p>
                            <ul className="space-y-1">
                                {missing.map((claim, i) => (
                                    <li
                                        key={i}
                                        className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"
                                    >
                                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                                        <span className="line-clamp-2">{claim}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="px-3 py-2 text-[11px] text-muted-foreground">
                            {coverage >= 80
                                ? "All tracked claims are sourced. "
                                : "No specific unsourced claims recorded."}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function DistributionLinks({
    blog,
    onHashnodeSync,
    syncing,
}: {
    blog: Blog;
    onHashnodeSync: (id: string) => void;
    syncing: boolean;
}) {
    const hasDistribution =
        blog.hashnodeUrl || blog.mediumUrl || blog.wordPressUrl || blog.ghostUrl;

    if (!hasDistribution && blog.status !== "PUBLISHED") {
        return <span className="text-xs text-muted-foreground">—</span>;
    }

    return (
        <div className="flex items-center gap-1.5">
            {blog.hashnodeUrl ? (
                <a
                    href={blog.hashnodeUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Hashnode"
                    aria-label="View on Hashnode"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-blue-400 transition-colors hover:bg-blue-500/10 hover:text-blue-300"
                >
                    <HashnodeIcon className="h-4 w-4" />
                </a>
            ) : blog.status === "PUBLISHED" ? (
                <button
                    type="button"
                    onClick={() => onHashnodeSync(blog.id)}
                    disabled={syncing}
                    title="Sync to Hashnode"
                    aria-label="Sync to Hashnode"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-400 disabled:cursor-wait disabled:opacity-50"
                >
                    {syncing ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                        <HashnodeIcon className="h-4 w-4" />
                    )}
                </button>
            ) : null}

            {blog.mediumUrl ? (
                <a
                    href={blog.mediumUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Medium"
                    aria-label="View on Medium"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
                >
                    <MediumIcon className="h-4 w-4" />
                </a>
            ) : blog.status === "PUBLISHED" ? (
                <span
                    title="Not synced to Medium"
                    className="flex h-7 w-7 items-center justify-center text-muted-foreground/30"
                >
                    <MediumIcon className="h-4 w-4" />
                </span>
            ) : null}

            {blog.wordPressUrl && (
                <a
                    href={blog.wordPressUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View on WordPress"
                    aria-label="View on WordPress"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-blue-400 transition-colors hover:bg-blue-500/10 hover:text-blue-300"
                >
                    <WordPressIcon className="h-4 w-4" />
                </a>
            )}

            {blog.ghostUrl && (
                <a
                    href={blog.ghostUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Ghost"
                    aria-label="View on Ghost"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-yellow-400 transition-colors hover:bg-yellow-500/10 hover:text-yellow-300"
                >
                    <GhostIcon className="h-4 w-4" />
                </a>
            )}
        </div>
    );
}

function EmptyState({
    searchActive,
    onClearSearch,
}: {
    searchActive: boolean;
    onClearSearch: () => void;
}) {
    return (
        <div className="rounded-2xl border border-border bg-card/30 px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/50">
                {searchActive ? (
                    <Search className="h-6 w-6 text-muted-foreground" />
                ) : (
                    <FileText className="h-6 w-6 text-muted-foreground" />
                )}
            </div>
            <h3 className="text-sm font-semibold text-foreground">
                {searchActive ? "No content matches your search" : "No SEO content yet"}
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                {searchActive
                    ? "Try a different title, keyword, or status filter."
                    : "Generate your first optimized post and manage your entire content workflow from here."}
            </p>
            {searchActive && (
                <button
                    type="button"
                    onClick={onClearSearch}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                >
                    <X className="h-3.5 w-3.5" />
                    Clear filters
                </button>
            )}
        </div>
    );
}

function SnippetOptimizeButton({
    blogId,
    keyword,
}: {
    blogId: string;
    keyword?: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{
        format: string;
        currentSnippet: string | null;
        optimizedBlock: string;
        insertionGuidance: string;
    } | null>(null);

    const open = async () => {
        setIsOpen(true);
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch(`/api/blogs/${blogId}/snippet-optimize`, {
                method: "POST",
            });
            if (res.ok) {
                setResult(await res.json());
            } else {
                toast.error("Snippet optimizer failed — try again.");
            }
        } catch {
            toast.error("Network error — could not reach snippet optimizer.");
        } finally {
            setLoading(false);
        }
    };

    const close = () => {
        if (!loading) {
            setIsOpen(false);
            setResult(null);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={open}
                title="Optimize for Featured Snippet"
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:border-amber-500/30 hover:bg-amber-500/15"
            >
                <Zap className="h-3.5 w-3.5" />
                Snippet
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) close();
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Snippet optimizer"
                >
                    <div className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                                        <Sparkles className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-foreground">
                                            Snippet Optimizer
                                        </h3>
                                        {keyword && (
                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                Target:{" "}
                                                <span className="text-amber-400">{keyword}</span>
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                disabled={loading}
                                aria-label="Close snippet optimizer"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="max-h-[calc(90vh-73px)] overflow-y-auto p-5">
                            {loading && (
                                <div className="flex flex-col items-center justify-center py-14 text-center">
                                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
                                        <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                                    </div>
                                    <p className="text-sm font-medium text-foreground">
                                        Analyzing your snippet
                                    </p>
                                    <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                                        Fetching the current result and generating an optimized
                                        content block.
                                    </p>
                                </div>
                            )}

                            {result && !loading && (
                                <div className="space-y-5">
                                    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                Detected format
                                            </p>
                                            <p className="mt-1 text-sm font-semibold text-foreground">
                                                {result.format}
                                            </p>
                                        </div>
                                        <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                            Featured snippet
                                        </div>
                                    </div>

                                    {result.currentSnippet && (
                                        <div>
                                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                Current result
                                            </p>
                                            <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">
                                                {result.currentSnippet}
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                                                AI recommendation
                                            </p>
                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                        </div>
                                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 font-mono text-xs leading-6 text-foreground">
                                            <pre className="whitespace-pre-wrap break-words font-inherit">
                                                {result.optimizedBlock}
                                            </pre>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                                        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-blue-400">
                                            Placement
                                        </p>
                                        <p className="text-xs leading-5 text-muted-foreground">
                                            {result.insertionGuidance}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(
                                                    result.optimizedBlock
                                                );
                                                toast.success("Optimized block copied!");
                                            } catch {
                                                toast.error(
                                                    "Could not copy the optimized block."
                                                );
                                            }
                                        }}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 py-2.5 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/20"
                                    >
                                        <Check className="h-4 w-4" />
                                        Copy optimized block
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function ActionMenu({
    blog,
    onReview,
    onRepurpose,
    onLinks,
    onDelete,
    onSnippet,
}: {
    blog: Blog;
    onReview: () => void;
    onRepurpose: () => void;
    onLinks: () => void;
    onDelete: () => void;
    onSnippet: () => void;
}) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-blog-action-menu]")) setOpen(false);
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [open]);

    const canReview = blog.status === "DRAFT" || isReviewStatus(blog.status) || isEditorialRejection(blog.status);
    const canPublishActions = blog.status === "PUBLISHED";
    const stuck = isStuckBlog(blog);
    const failed = blog.status === "FAILED";

    return (
        <div className="relative" data-blog-action-menu>
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-label={`Actions for ${blog.title || "blog"}`}
                aria-expanded={open}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                    open
                        ? "border-border bg-muted text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                }`}
            >
                <MoreHorizontal className="h-4 w-4" />
            </button>

            {open && (
                <div className="absolute right-0 top-10 z-40 w-52 overflow-hidden rounded-xl border border-border bg-background p-1.5 shadow-xl">
                    {canReview && (
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onReview();
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                            <Eye className="h-3.5 w-3.5 text-primary" />
                            {isReviewStatus(blog.status) || isEditorialRejection(blog.status)
                                ? "Review & Fix"
                                : "Review & Publish"}
                        </button>
                    )}

                    {canPublishActions && (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onRepurpose();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <Zap className="h-3.5 w-3.5 text-amber-400" />
                                Repurpose
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onLinks();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <LinkIcon className="h-3.5 w-3.5 text-emerald-400" />
                                Internal links
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onSnippet();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <Zap className="h-3.5 w-3.5 text-amber-300" />
                                Optimize snippet
                            </button>
                        </>
                    )}

                    {(failed || stuck) && (
                        <>
                            <div className="my-1 border-t border-border" />
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onDelete();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
                            >
                                <X className="h-3.5 w-3.5" />
                                Delete
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export function BlogList({
    blogs,
    success,
    initialReviewId,
    pipelineFilter,
}: {
    blogs: Blog[];
    success: boolean;
    initialReviewId?: string;
    pipelineFilter?: string;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [previewBlog, setPreviewBlog] = useState<Blog | null>(null);
    const [linkModalBlog, setLinkModalBlog] = useState<Blog | null>(null);
    const [repurposeBlog, setRepurposeBlog] = useState<Blog | null>(null);
    const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
    const [healthFilter, setHealthFilter] = useState("ALL");
    const [sort, setSort] = useState<SortOption>("UPDATED_DESC");
    const [page, setPage] = useState(1);
    const [showSort, setShowSort] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [dismissedRepurposeId, setDismissedRepurposeId] = useState<string | null>(
        () => {
            if (typeof window === "undefined") return null;
            return localStorage.getItem("repurpose_banner_dismissed") ?? null;
        }
    );

    const pendingRefreshRef = useRef(false);
    const pollCountRef = useRef(0);
    const hasOpenedReviewRef = useRef(false);
    const sortRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (hasOpenedReviewRef.current) return;
        const reviewId = initialReviewId ?? searchParams.get("review");
        if (!reviewId || !blogs?.length) return;
        const target = blogs.find((blog) => blog.id === reviewId);
        if (target) {
            hasOpenedReviewRef.current = true;
            setPreviewBlog(target);
        }
    }, [initialReviewId, searchParams, blogs]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter, sort]);

    // Sync external pipeline filter → internal statusFilter
    useEffect(() => {
        if (!pipelineFilter) return;
        const map: Record<string, FilterStatus> = {
            ALL: "ALL",
            WRITING: "WRITING",
            EVIDENCE: "EVIDENCE",
            REVIEW: "REVIEW",
            READY: "READY",
            PUBLISHED: "PUBLISHED",
            ISSUES: "ISSUES",
        };
        const mapped = map[pipelineFilter];
        if (mapped) setStatusFilter(mapped);
    }, [pipelineFilter]);

    useEffect(() => {
        if (!showSort) return;
        const handler = (e: MouseEvent) => {
            if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
                setShowSort(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showSort]);

    const handlePublish = useCallback(
        async (id: string) => {
            try {
                const res = await fetch(`/api/blogs/${id}/publish`, { method: "POST" });
                const data = await res.json();
                if (res.ok && data.success) {
                    toast.success(
                        <div className="flex flex-col gap-1">
                            <span className="font-semibold">Blog published successfully</span>
                            {data.mediumUrl && (
                                <a
                                    href={data.mediumUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-emerald-400 hover:underline"
                                >
                                    View on Medium →
                                </a>
                            )}
                            {data.hashnodeUrl && (
                                <a
                                    href={data.hashnodeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-400 hover:underline"
                                >
                                    View on Hashnode →
                                </a>
                            )}
                            {data.wordPressUrl && (
                                <a
                                    href={data.wordPressUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-sky-400 hover:underline"
                                >
                                    View on WordPress →
                                </a>
                            )}
                            {data.ghostUrl && (
                                <a
                                    href={data.ghostUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-yellow-400 hover:underline"
                                >
                                    View on Ghost →
                                </a>
                            )}
                        </div>,
                        { duration: 5000 }
                    );
                    pendingRefreshRef.current = true;
                    return { success: true, mediumUrl: data.mediumUrl, hashnodeUrl: data.hashnodeUrl };
                }
                toast.error(data.error || "Failed to publish blog.");
                return { success: false };
            } catch (error) {
                logger.error("[BlogList] Unexpected error:", {
                    error: (error as any)?.message || error,
                });
                toast.error("A network error occurred.");
                return { success: false };
            }
        },
        []
    );

    const handleDeleteStuck = useCallback(
        async (id: string) => {
            try {
                const res = await fetch(`/api/blogs/${id}`, { method: "DELETE" });
                if (!res.ok) throw new Error("Delete request failed");
                toast.success("Blog removed.");
                router.refresh();
            } catch {
                toast.error("Failed to remove blog.");
            }
        },
        [router]
    );

    const handleHashnodeSync = useCallback(
        async (id: string) => {
            setSyncingIds((previous) => new Set([...previous, id]));
            try {
                const res = await fetch(`/api/blogs/${id}/hashnode-sync`, { method: "POST" });
                const data = await res.json();
                if (res.ok && data.success) {
                    toast.success(
                        <div className="flex flex-col gap-1">
                            <span className="font-semibold">Synced to Hashnode</span>
                            {data.hashnodeUrl && (
                                <a
                                    href={data.hashnodeUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-400 hover:underline"
                                >
                                    View on Hashnode →
                                </a>
                            )}
                        </div>,
                        { duration: 6000 }
                    );
                    router.refresh();
                } else {
                    toast.error(data.error || "Hashnode sync failed.");
                }
            } catch {
                toast.error("Network error — could not sync to Hashnode.");
            } finally {
                setSyncingIds((previous) => {
                    const next = new Set(previous);
                    next.delete(id);
                    return next;
                });
            }
        },
        [router]
    );

    const hasActiveBlog = useMemo(
        () =>
            blogs?.some((blog) => {
                if (blog.status !== "GENERATING" && blog.status !== "QUEUED") return false;
                const createdAt = new Date(blog.createdAt).getTime();
                if (Number.isNaN(createdAt)) return false;
                return Date.now() - createdAt < TEN_MINUTES_MS;
            }) ?? false,
        [blogs]
    );

    useEffect(() => {
        if (!hasActiveBlog) {
            pollCountRef.current = 0;
            return;
        }
        const interval = setInterval(() => {
            if (pollCountRef.current >= 30) {
                clearInterval(interval);
                pollCountRef.current = 0;
                return;
            }
            if (document.visibilityState !== "visible") return;
            if (previewBlog || linkModalBlog || repurposeBlog) return;
            pollCountRef.current += 1;
            router.refresh();
        }, 8000);
        return () => clearInterval(interval);
    }, [hasActiveBlog, previewBlog, linkModalBlog, repurposeBlog, router]);

    const filteredBlogs = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        const result = [...(blogs ?? [])].filter((blog) => {
            if (statusFilter === "DRAFT" && blog.status !== "DRAFT") return false;
            if (statusFilter === "REVIEW" && !isReviewStatus(blog.status) && !isEditorialRejection(blog.status)) return false;
            if (statusFilter === "PUBLISHED" && blog.status !== "PUBLISHED") return false;
            if (statusFilter === "FAILED" && blog.status !== "FAILED") return false;
            if (statusFilter === "GENERATING" && !isGeneratingStatus(blog.status)) return false;
            // Pipeline-specific states
            if (statusFilter === "WRITING" && !(isGeneratingStatus(blog.status) || blog.status === "DRAFT")) return false;
            if (statusFilter === "EVIDENCE" && blog.status !== "EVIDENCE_REVIEW") return false;
            if (statusFilter === "READY" && !(blog.status === "DRAFT" && blog.validationScore != null && Number(blog.validationScore) >= 60)) return false;
            if (statusFilter === "ISSUES") {
                const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                const lowScore = blog.validationScore != null && Number(blog.validationScore) < 60;
                if (!(hasErrors || lowScore || blog.status === "FAILED" || isEditorialRejection(blog.status))) return false;
            }
            if (!normalizedSearch) {
                // Health filter
                if (healthFilter !== "ALL") {
                    const hs = computeHealthScore(blog);
                    if (hs == null) return false;
                    if (healthFilter === "STRONG" && hs < 80) return false;
                    if (healthFilter === "NEEDS_WORK" && (hs < 60 || hs >= 80)) return false;
                    if (healthFilter === "CRITICAL" && hs >= 60) return false;
                }
                return true;
            }
            // Health filter on search results too
            if (healthFilter !== "ALL") {
                const hs = computeHealthScore(blog);
                if (hs == null) return false;
                if (healthFilter === "STRONG" && hs < 80) return false;
                if (healthFilter === "NEEDS_WORK" && (hs < 60 || hs >= 80)) return false;
                if (healthFilter === "CRITICAL" && hs >= 60) return false;
            }
            const title = blog.title?.toLowerCase() ?? "";
            const keyword = blog.targetKeywords?.join(" ").toLowerCase() ?? "";
            const slug = blog.slug?.toLowerCase() ?? "";
            return (
                title.includes(normalizedSearch) ||
                keyword.includes(normalizedSearch) ||
                slug.includes(normalizedSearch)
            );
        });

        result.sort((a, b) => {
            if (sort === "SCORE_DESC") {
                const scoreA = a.validationScore == null ? -1 : Number(a.validationScore);
                const scoreB = b.validationScore == null ? -1 : Number(b.validationScore);
                return scoreB - scoreA;
            }
            if (sort === "CREATED_ASC") {
                return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            }
            if (sort === "CREATED_DESC") {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            const updatedA = new Date(a.updatedAt ?? a.createdAt).getTime();
            const updatedB = new Date(b.updatedAt ?? b.createdAt).getTime();
            return updatedB - updatedA;
        });

        return result;
    }, [blogs, search, statusFilter, healthFilter, sort]);

    const totalPages = Math.max(1, Math.ceil(filteredBlogs.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);

    const paginatedBlogs = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredBlogs.slice(start, start + PAGE_SIZE);
    }, [filteredBlogs, currentPage]);

    const stats = useMemo(() => {
        const all = blogs ?? [];
        return {
            total: all.length,
            draft: all.filter((blog) => blog.status === "DRAFT").length,
            review: all.filter((blog) => isReviewStatus(blog.status) || isEditorialRejection(blog.status)).length,
            published: all.filter((blog) => blog.status === "PUBLISHED").length,
            generating: all.filter((blog) => isGeneratingStatus(blog.status)).length,
            issues: all.filter((blog) => {
                const hasErrors =
                    Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                const lowScore =
                    blog.validationScore != null && Number(blog.validationScore) < 60;
                return hasErrors || lowScore || blog.status === "FAILED" || isEditorialRejection(blog.status);
            }).length,
        };
    }, [blogs]);

    const repurposeBannerBlog =
        blogs?.find(
            (blog) => blog.status === "PUBLISHED" && blog.id !== dismissedRepurposeId
        ) ?? null;

    const activeFilterCount = (statusFilter !== "ALL" ? 1 : 0) + (healthFilter !== "ALL" ? 1 : 0) + (search.trim() ? 1 : 0);

    const clearFilters = useCallback(() => {
        setSearch("");
        setStatusFilter("ALL");
        setHealthFilter("ALL");
        setPage(1);
    }, []);

    const toggleSelect = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        const pageIds = paginatedBlogs.map((b) => b.id);
        const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
        setSelected((prev) => {
            const next = new Set(prev);
            pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
            return next;
        });
    }, [paginatedBlogs, selected]);

    const getPageNumbers = () => {
        if (totalPages <= 5) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }
        if (currentPage <= 3) return [1, 2, 3, 4, totalPages];
        if (currentPage >= totalPages - 2) {
            return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        }
        return [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
    };

    const sortOptions: { key: SortOption; label: string }[] = [
        { key: "UPDATED_DESC", label: "Recently updated" },
        { key: "CREATED_DESC", label: "Newest first" },
        { key: "CREATED_ASC", label: "Oldest first" },
        { key: "SCORE_DESC", label: "Highest score" },
    ];

    return (
        <>
            <div className="space-y-4">
                {repurposeBannerBlog && (
                    <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-background to-background">
                        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
                                <Zap className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-foreground">
                                    Your latest post is live
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {repurposeBannerBlog.title}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setRepurposeBlog(repurposeBannerBlog)}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/20"
                                >
                                    Repurpose content
                                    <span aria-hidden>→</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDismissedRepurposeId(repurposeBannerBlog.id);
                                        localStorage.setItem(
                                            "repurpose_banner_dismissed",
                                            repurposeBannerBlog.id
                                        );
                                    }}
                                    aria-label="Dismiss repurpose suggestion"
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
                    <div className="flex flex-col gap-3 border-b border-border px-5 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div>
                                <h2 className="text-sm font-bold text-foreground">Content Library</h2>
                                <p className="text-[11px] text-muted-foreground">
                                    Your AI-powered articles, ready for review, publishing or optimization.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search articles..."
                                    className="h-8 w-56 rounded-lg border border-border bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                {search && (
                                    <button
                                        type="button"
                                        onClick={() => setSearch("")}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            {activeFilterCount > 0 && (
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <X className="h-3 w-3" />
                                    Clear
                                </button>
                            )}

                            {/* Status filter */}
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="ALL">Status</option>
                                <option value="DRAFT">Draft</option>
                                <option value="GENERATING">Writing</option>
                                <option value="REVIEW">Review</option>
                                <option value="PUBLISHED">Published</option>
                                <option value="FAILED">Failed</option>
                            </select>

                            {/* Health filter */}
                            <select
                                value={healthFilter}
                                onChange={(e) => setHealthFilter(e.target.value)}
                                className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="ALL">Health</option>
                                <option value="STRONG">Strong (80+)</option>
                                <option value="NEEDS_WORK">Needs work (60-79)</option>
                                <option value="CRITICAL">Critical (&lt;60)</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                {filteredBlogs.length}{" "}
                                {filteredBlogs.length === 1 ? "result" : "results"}
                            </span>
                            <div ref={sortRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowSort(!showSort)}
                                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">
                                        {sortOptions.find((s) => s.key === sort)?.label}
                                    </span>
                                </button>
                                {showSort && (
                                    <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                                        {sortOptions.map((opt) => (
                                            <button
                                                type="button"
                                                key={opt.key}
                                                onClick={() => {
                                                    setSort(opt.key);
                                                    setShowSort(false);
                                                }}
                                                className={`flex w-full px-3 py-2 text-xs font-medium transition-colors hover:bg-accent ${
                                                    sort === opt.key
                                                        ? "text-foreground"
                                                        : "text-muted-foreground"
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="md:hidden divide-y divide-border">
                        {paginatedBlogs.length > 0 ? (
                            paginatedBlogs.map((blog) => {
                                const blogUrl = getBlogUrl(blog);
                                return (
                                    <div key={blog.id} className="space-y-3 p-4">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="flex-1 text-sm font-medium leading-snug line-clamp-2">
                                                {blogUrl ? (
                                                    <a
                                                        href={blogUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-1 hover:text-primary"
                                                    >
                                                        {blog.title}
                                                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-40" />
                                                    </a>
                                                ) : (
                                                    blog.title
                                                )}
                                            </p>
                                            <StatusBadge blog={blog} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                                                {blog.targetKeywords?.[0] || "Auto-assigned"}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <EvidenceBadge blog={blog} />
                                                <QualityScore blog={blog} />
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <DistributionLinks
                                                blog={blog}
                                                onHashnodeSync={handleHashnodeSync}
                                                syncing={syncingIds.has(blog.id)}
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                {formatRelativeDate(blog.updatedAt ?? blog.createdAt)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-end border-t border-border pt-2">
                                            <ActionMenu
                                                blog={blog}
                                                onReview={() => setPreviewBlog(blog)}
                                                onRepurpose={() => setRepurposeBlog(blog)}
                                                onLinks={() => setLinkModalBlog(blog)}
                                                onDelete={() => handleDeleteStuck(blog.id)}
                                                onSnippet={() => {}}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <EmptyState
                                searchActive={activeFilterCount > 0}
                                onClearSearch={clearFilters}
                            />
                        )}
                    </div>

                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="border-b border-border bg-card/60 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                                <tr>
                                    <th className="w-10 px-4 py-3">
                                        <input
                                            type="checkbox"
                                            checked={
                                                paginatedBlogs.length > 0 &&
                                                paginatedBlogs.every((b) => selected.has(b.id))
                                            }
                                            onChange={toggleAll}
                                            className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
                                        />
                                    </th>
                                    <th className="px-4 py-3 font-medium">Article</th>
                                    <th className="px-4 py-3 font-medium">Keyword</th>
                                    <th className="px-4 py-3 font-medium">SEO</th>
                                    <th className="px-4 py-3 font-medium">Evidence</th>
                                    <th className="px-4 py-3 font-medium">Health</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium">Updated</th>
                                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {paginatedBlogs.length > 0 ? (
                                    paginatedBlogs.map((blog) => {
                                        const blogUrl = getBlogUrl(blog);
                                        const healthScore = computeHealthScore(blog);
                                        return (
                                            <tr
                                                key={blog.id}
                                                className="group transition-colors hover:bg-card/80"
                                            >
                                                <td className="px-4 py-3.5">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(blog.id)}
                                                        onChange={() => toggleSelect(blog.id)}
                                                        className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
                                                    />
                                                </td>
                                                {/* Article — title with thumbnail */}
                                                <td className="max-w-[260px] px-4 py-3.5">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        {/* Tiny thumbnail placeholder */}
                                                        <div className="hidden xl:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-br from-emerald-900/20 to-card">
                                                            <span className="text-[7px] font-black uppercase tracking-wider text-emerald-500/60">SEO</span>
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p
                                                                className="truncate text-sm font-semibold text-foreground"
                                                                title={blog.title}
                                                            >
                                                                {blogUrl ? (
                                                                    <a
                                                                        href={blogUrl}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
                                                                    >
                                                                        {blog.title}
                                                                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-40" />
                                                                    </a>
                                                                ) : (
                                                                    blog.title
                                                                )}
                                                            </p>
                                                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/50">
                                                                {blog.wordCount ? `${blog.wordCount.toLocaleString()} words` : "Draft"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                                {/* Keyword — separate column */}
                                                <td className="max-w-[160px] px-4 py-3.5">
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {blog.targetKeywords?.[0] || "—"}
                                                    </p>
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <QualityScore blog={blog} />
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <EvidenceBadge blog={blog} />
                                                </td>
                                                {/* Health — composite of SEO + Evidence + Citation */}
                                                <td className="px-4 py-3.5">
                                                    {healthScore != null ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-xs font-bold ${
                                                                healthScore >= 80 ? "text-emerald-400" :
                                                                healthScore >= 60 ? "text-amber-400" :
                                                                "text-red-400"
                                                            }`}>
                                                                {healthScore}%
                                                            </span>
                                                            <div className="h-1 w-10 overflow-hidden rounded-full bg-border/30">
                                                                <div
                                                                    className={`h-full rounded-full ${
                                                                        healthScore >= 80 ? "bg-emerald-500" :
                                                                        healthScore >= 60 ? "bg-amber-500" :
                                                                        "bg-red-500"
                                                                    }`}
                                                                    style={{ width: `${healthScore}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground/40">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <StatusBadge blog={blog} />
                                                </td>
                                                <td className="px-4 py-3.5 text-muted-foreground">
                                                    <span title={formatDate(blog.updatedAt ?? blog.createdAt)}>
                                                        {formatRelativeDate(blog.updatedAt ?? blog.createdAt)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <ActionMenu
                                                        blog={blog}
                                                        onReview={() => setPreviewBlog(blog)}
                                                        onRepurpose={() => setRepurposeBlog(blog)}
                                                        onLinks={() => setLinkModalBlog(blog)}
                                                        onDelete={() => handleDeleteStuck(blog.id)}
                                                        onSnippet={() => {}}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={8} className="p-0">
                                            <EmptyState
                                                searchActive={activeFilterCount > 0}
                                                onClearSearch={clearFilters}
                                            />
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {filteredBlogs.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between border-t border-border px-4 py-3">
                            <p className="text-xs text-muted-foreground">
                                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                                {Math.min(currentPage * PAGE_SIZE, filteredBlogs.length)} of{" "}
                                {filteredBlogs.length}
                            </p>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    aria-label="Previous page"
                                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                {getPageNumbers().map((pageNum, idx, arr) => {
                                    const showEllipsis =
                                        idx > 0 && pageNum - arr[idx - 1] > 1;
                                    return (
                                        <span key={pageNum} className="flex items-center">
                                            {showEllipsis && (
                                                <span className="px-1 text-xs text-muted-foreground">
                                                    …
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setPage(pageNum)}
                                                className={`h-7 w-7 rounded-lg text-xs font-semibold transition-colors ${
                                                    pageNum === currentPage
                                                        ? "bg-foreground/10 text-foreground"
                                                        : "text-muted-foreground hover:bg-accent"
                                                }`}
                                            >
                                                {pageNum}
                                            </button>
                                        </span>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage >= totalPages}
                                    aria-label="Next page"
                                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {previewBlog && (
                <ReviewBlogModal
                    blog={previewBlog as any}
                    onClose={() => {
                        setPreviewBlog(null);
                        if (pendingRefreshRef.current) {
                            pendingRefreshRef.current = false;
                            router.refresh();
                        }
                    }}
                    onPublish={handlePublish}
                />
            )}

            {linkModalBlog && (
                <InternalLinksModal
                    blog={linkModalBlog}
                    onClose={() => setLinkModalBlog(null)}
                />
            )}

            {repurposeBlog && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setRepurposeBlog(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setRepurposeBlog(null);
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Repurpose content"
                >
                    <div className="w-full max-w-2xl">
                        <RepurposeTab
                            blogId={repurposeBlog.id}
                            blogTitle={repurposeBlog.title ?? ""}
                            blogSlug={repurposeBlog.slug ?? ""}
                            onClose={() => setRepurposeBlog(null)}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
