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
    | "GENERATING";

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
    return status === "REVIEW" || status === "NEEDS_REVIEW";
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
                label: "Stuck",
                className: "border-red-500/20 bg-red-500/10 text-red-400",
                dot: "bg-red-400",
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

    const canReview = blog.status === "DRAFT" || isReviewStatus(blog.status);
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
                            {isReviewStatus(blog.status) ? "Review & Fix" : "Review & Publish"}
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
}: {
    blogs: Blog[];
    success: boolean;
    initialReviewId?: string;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [previewBlog, setPreviewBlog] = useState<Blog | null>(null);
    const [linkModalBlog, setLinkModalBlog] = useState<Blog | null>(null);
    const [repurposeBlog, setRepurposeBlog] = useState<Blog | null>(null);
    const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
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
            if (statusFilter === "REVIEW" && !isReviewStatus(blog.status)) return false;
            if (statusFilter === "PUBLISHED" && blog.status !== "PUBLISHED") return false;
            if (statusFilter === "FAILED" && blog.status !== "FAILED") return false;
            if (statusFilter === "GENERATING" && !isGeneratingStatus(blog.status)) return false;
            if (!normalizedSearch) return true;
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
    }, [blogs, search, statusFilter, sort]);

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
            review: all.filter((blog) => isReviewStatus(blog.status)).length,
            published: all.filter((blog) => blog.status === "PUBLISHED").length,
            generating: all.filter((blog) => isGeneratingStatus(blog.status)).length,
            issues: all.filter((blog) => {
                const hasErrors =
                    Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                const lowScore =
                    blog.validationScore != null && Number(blog.validationScore) < 60;
                return hasErrors || lowScore || blog.status === "FAILED";
            }).length,
        };
    }, [blogs]);

    const repurposeBannerBlog =
        blogs?.find(
            (blog) => blog.status === "PUBLISHED" && blog.id !== dismissedRepurposeId
        ) ?? null;

    const activeFilterCount = (statusFilter !== "ALL" ? 1 : 0) + (search.trim() ? 1 : 0);

    const clearFilters = useCallback(() => {
        setSearch("");
        setStatusFilter("ALL");
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

                <div className="rounded-2xl border border-border bg-card/30 p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <button
                            type="button"
                            onClick={() => setStatusFilter("ALL")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "ALL"
                                    ? "border-primary/30 bg-primary/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.total}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                All content
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter("DRAFT")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "DRAFT"
                                    ? "border-amber-500/30 bg-amber-500/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <CircleDot className="h-4 w-4 text-amber-400" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.draft}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                Drafts
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter("REVIEW")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "REVIEW"
                                    ? "border-orange-500/30 bg-orange-500/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <Eye className="h-4 w-4 text-orange-400" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.review}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                In review
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter("PUBLISHED")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "PUBLISHED"
                                    ? "border-emerald-500/30 bg-emerald-500/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <Check className="h-4 w-4 text-emerald-400" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.published}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                Published
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter("GENERATING")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "GENERATING"
                                    ? "border-blue-500/30 bg-blue-500/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <RefreshCw className="h-4 w-4 text-blue-400" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.generating}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                Writing
                            </p>
                        </button>

                        <button
                            type="button"
                            onClick={() => setStatusFilter("FAILED")}
                            className={`rounded-xl border p-3 text-left transition-colors ${
                                statusFilter === "FAILED"
                                    ? "border-red-500/30 bg-red-500/5"
                                    : "border-border bg-background/40 hover:bg-muted/40"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <AlertTriangle className="h-4 w-4 text-red-400" />
                                <span className="text-lg font-bold text-foreground">
                                    {stats.issues}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                                Issues
                            </p>
                        </button>
                    </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
                    <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search title, keyword, or slug…"
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
                                            <span className="max-w-[55%] truncate text-xs text-muted-foreground">
                                                {blog.targetKeywords?.[0] || "Auto-assigned"}
                                            </span>
                                            <QualityScore blog={blog} />
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
                            <thead className="border-b border-border bg-card/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                                    <th className="px-4 py-3 font-medium">Title</th>
                                    <th className="px-4 py-3 font-medium">Keyword</th>
                                    <th className="px-4 py-3 font-medium">SEO Score</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium">Published On</th>
                                    <th className="px-4 py-3 font-medium">Updated</th>
                                    <th className="px-4 py-3 text-right font-medium">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {paginatedBlogs.length > 0 ? (
                                    paginatedBlogs.map((blog) => {
                                        const blogUrl = getBlogUrl(blog);
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
                                                <td
                                                    className="max-w-[240px] truncate px-4 py-3.5 font-medium"
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
                                                </td>
                                                <td className="px-4 py-3.5 text-muted-foreground">
                                                    {blog.targetKeywords?.[0] || "Auto-assigned"}
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <QualityScore blog={blog} />
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <StatusBadge blog={blog} />
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <DistributionLinks
                                                        blog={blog}
                                                        onHashnodeSync={handleHashnodeSync}
                                                        syncing={syncingIds.has(blog.id)}
                                                    />
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
