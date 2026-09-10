"use client";
import { logger } from "@/lib/logger";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBlogModal } from "./ReviewBlogModal";
import { InternalLinksModal } from "./InternalLinksModal";
import {
    ArrowUpDown,
    Bot,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Eye,
    Link as LinkIcon,
    Loader2,
    MoreHorizontal,
    RefreshCw,
    Search,
    X,
    Zap,
} from "lucide-react";
import { RepurposeTab } from "@/components/blog/RepurposeTab";
import { toast } from "sonner";
import { HashnodeIcon, MediumIcon, WordPressIcon, GhostIcon } from "@/components/icons/platforms";

const PAGE_SIZE = 10;
const TEN_MINUTES_MS = 10 * 60 * 1000;

type FilterTab = "all" | "draft" | "review" | "published" | "failed";
type SortKey = "newest" | "oldest" | "score-desc" | "score-asc";

function getAiReadiness(blog: any): { level: string; color: string } {
    const score = blog.validationScore as number | null;
    const hasSchema =
        typeof blog.content === "string" &&
        (blog.content.includes('"@type":"FAQPage"') ||
            blog.content.includes('"@type": "FAQPage"') ||
            blog.content.includes('"@type":"HowTo"') ||
            blog.content.includes('"@type": "HowTo"'));

    if (score != null && score >= 80 && hasSchema) return { level: "Good", color: "emerald" };
    if (score != null && score >= 65) return { level: "Fair", color: "amber" };
    if (score != null && score < 65) return { level: "Low", color: "red" };
    return { level: "—", color: "zinc" };
}

function CircularScore({ score }: { score: number }) {
    const clamped = Math.max(0, Math.min(100, score));
    const color =
        clamped >= 80
            ? "text-emerald-400"
            : clamped >= 60
              ? "text-amber-400"
              : "text-red-400";
    const label =
        clamped >= 80 ? "Good" : clamped >= 60 ? "Fair" : "Needs work";

    return (
        <div className="flex items-center gap-2.5">
            <div className="relative h-9 w-9 shrink-0">
                <svg className="-rotate-90" viewBox="0 0 36 36" fill="none">
                    <circle
                        cx="18"
                        cy="18"
                        r="15.9155"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-white/[0.06]"
                    />
                    <circle
                        cx="18"
                        cy="18"
                        r="15.9155"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${clamped} ${100 - clamped}`}
                        className={color}
                    />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-foreground">
                    {clamped}
                </span>
            </div>
            <div className="hidden min-[900px]:block">
                <p className="text-xs font-semibold text-foreground">{clamped}/100</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
        </div>
    );
}

function AiReadinessBadge({ blog }: { blog: any }) {
    const { level, color } = getAiReadiness(blog);
    const classes: Record<string, string> = {
        emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        red: "bg-red-500/10 text-red-400 border-red-500/20",
        zinc: "bg-muted text-muted-foreground border-border",
    };

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes[color]}`}
        >
            <Bot className="h-3 w-3" />
            {level}
        </span>
    );
}

function StatusBadge({ status, createdAt }: { status: string; createdAt: string }) {
    const isStuck =
        (status === "GENERATING" || status === "QUEUED") &&
        Date.now() - new Date(createdAt).getTime() > TEN_MINUTES_MS;

    if (status === "PUBLISHED")
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Published
            </span>
        );

    if (status === "DRAFT")
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Draft
            </span>
        );

    if (status === "REVIEW" || status === "NEEDS_REVIEW")
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/20 bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-400">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                Needs Review
            </span>
        );

    if (status === "FAILED")
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Failed
            </span>
        );

    if (isStuck)
        return (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Stuck
            </span>
        );

    return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Writing…
        </span>
    );
}

function SyndicationIcons({
    blog,
    onHashnodeSync,
    syncingIds,
}: {
    blog: any;
    onHashnodeSync: (id: string) => void;
    syncingIds: Set<string>;
}) {
    return (
        <div className="flex items-center gap-1.5">
            {blog.hashnodeUrl ? (
                <a href={blog.hashnodeUrl} target="_blank" rel="noreferrer" title="View on Hashnode" className="text-blue-400 hover:text-blue-300 transition-colors">
                    <HashnodeIcon className="h-4 w-4" />
                </a>
            ) : (
                blog.status === "PUBLISHED" && (
                    <button onClick={() => onHashnodeSync(blog.id)} disabled={syncingIds.has(blog.id)} title="Sync to Hashnode" className="text-zinc-600 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-wait">
                        {syncingIds.has(blog.id) ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <HashnodeIcon className="h-4 w-4" />}
                    </button>
                )
            )}
            {blog.mediumUrl ? (
                <a href={blog.mediumUrl} target="_blank" rel="noreferrer" title="View on Medium" className="text-emerald-400 hover:text-emerald-300 transition-colors">
                    <MediumIcon className="h-4 w-4" />
                </a>
            ) : (
                blog.status === "PUBLISHED" && <MediumIcon className="h-4 w-4 text-zinc-700" />
            )}
            {blog.wordPressUrl && (
                <a href={blog.wordPressUrl} target="_blank" rel="noreferrer" title="View on WordPress" className="text-blue-500 hover:text-blue-400 transition-colors">
                    <WordPressIcon className="h-4 w-4" />
                </a>
            )}
            {blog.ghostUrl && (
                <a href={blog.ghostUrl} target="_blank" rel="noreferrer" title="View on Ghost" className="text-yellow-500 hover:text-yellow-400 transition-colors">
                    <GhostIcon className="h-4 w-4" />
                </a>
            )}
            {(blog.status === "DRAFT" || blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") && (
                <span className="text-xs text-zinc-700">—</span>
            )}
        </div>
    );
}

function SnippetOptimizeButton({ blogId, keyword }: { blogId: string; keyword?: string }) {
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
            const res = await fetch(`/api/blogs/${blogId}/snippet-optimize`, { method: "POST" });
            if (res.ok) setResult(await res.json());
            else toast.error("Snippet optimizer failed — try again.");
        } catch {
            toast.error("Network error — could not reach snippet optimizer.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={open}
                title="Optimize for Featured Snippet"
                className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
            >
                ⚡ Snippet
            </button>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80">
                    <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h3 className="font-bold text-foreground">Snippet Optimizer</h3>
                                {keyword && (
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Keyword: <span className="text-emerald-400">{keyword}</span>
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setIsOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="space-y-4 p-5">
                            {loading && (
                                <div className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                                    Fetching current snippet and generating optimized block…
                                </div>
                            )}
                            {result && !loading && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Format detected</span>
                                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold uppercase text-amber-300">{result.format}</span>
                                    </div>
                                    {result.currentSnippet && (
                                        <div>
                                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Google Snippet</p>
                                            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs italic leading-relaxed text-zinc-400">{result.currentSnippet}</div>
                                        </div>
                                    )}
                                    <div>
                                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">Your Optimized Block</p>
                                        <div className="whitespace-pre-wrap rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 font-mono text-xs leading-relaxed text-zinc-200">{result.optimizedBlock}</div>
                                    </div>
                                    <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                                        <span className="mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wider text-blue-400">Where to put it</span>
                                        <p className="text-xs leading-relaxed text-zinc-300">{result.insertionGuidance}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(result.optimizedBlock);
                                            toast.success("Optimized block copied!");
                                        }}
                                        className="w-full rounded-xl border border-amber-500/30 bg-amber-500/15 py-2 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/25"
                                    >
                                        Copy Block
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function RowActions({
    blog,
    blogUrl,
    isStuck,
    onPreview,
    onRepurpose,
    onLinkModal,
    onDeleteStuck,
}: {
    blog: any;
    blogUrl: string | null;
    isStuck: boolean;
    onPreview: () => void;
    onRepurpose: () => void;
    onLinkModal: () => void;
    onDeleteStuck: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    if (blog.status === "GENERATING" || blog.status === "QUEUED" || blog.status === "FAILED") {
        const isFailed = blog.status === "FAILED";
        const isTimedOut = !isFailed && Date.now() - new Date(blog.createdAt).getTime() > TEN_MINUTES_MS;
        if (isFailed || isTimedOut) {
            return (
                <button onClick={onDeleteStuck} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10">
                    Delete
                </button>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs italic text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Writing…
            </span>
        );
    }

    if (blog.status === "DRAFT" || blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") {
        const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
        const lowScore = blog.validationScore != null && (blog.validationScore as number) < 60;
        const warn = hasErrors || lowScore;

        return (
            <button
                onClick={onPreview}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    warn
                        ? "border border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        : "text-foreground hover:bg-accent"
                }`}
            >
                <Eye className="h-3.5 w-3.5" />
                {warn ? "Review" : blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW" ? "Review" : "Review"}
            </button>
        );
    }

    return (
        <div ref={ref} className="relative">
            <button onClick={() => setOpen(!open)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" />
            </button>
            {open && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                    <button onClick={() => { onRepurpose(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-amber-400 transition-colors hover:bg-accent">
                        <Zap className="h-3.5 w-3.5" /> Repurpose
                    </button>
                    <button onClick={() => { onLinkModal(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-accent">
                        <LinkIcon className="h-3.5 w-3.5" /> Cluster Links
                    </button>
                    <div className="px-3 py-2">
                        <SnippetOptimizeButton blogId={blog.id} keyword={blog.targetKeywords?.[0]} />
                    </div>
                    {blogUrl ? (
                        <a href={blogUrl} target="_blank" rel="noreferrer" className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" /> View Live
                        </a>
                    ) : (
                        <Link href={`/dashboard/sites/${blog.siteId}`} className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" /> View Site
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}

const TABS: { key: FilterTab; label: string; match: (b: any) => boolean }[] = [
    { key: "all", label: "All", match: () => true },
    { key: "draft", label: "Draft", match: (b) => b.status === "DRAFT" },
    { key: "review", label: "In review", match: (b) => b.status === "REVIEW" || b.status === "NEEDS_REVIEW" },
    { key: "published", label: "Published", match: (b) => b.status === "PUBLISHED" },
    { key: "failed", label: "Issues", match: (b) => b.status === "FAILED" || (b.validationScore != null && Number(b.validationScore) < 60) || (Array.isArray(b.validationErrors) && b.validationErrors.length > 0) },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "newest", label: "Newest first" },
    { key: "oldest", label: "Oldest first" },
    { key: "score-desc", label: "Highest score" },
    { key: "score-asc", label: "Lowest score" },
];

export function BlogList({ blogs, success, initialReviewId }: { blogs: any[]; success: boolean; initialReviewId?: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [previewBlog, setPreviewBlog] = useState<any | null>(null);
    const [linkModalBlog, setLinkModalBlog] = useState<any | null>(null);
    const [repurposeBlog, setRepurposeBlog] = useState<any | null>(null);
    const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
    const [dismissedRepurposeId, setDismissedRepurposeId] = useState<string | null>(() => {
        if (typeof window === "undefined") return null;
        return localStorage.getItem("repurpose_banner_dismissed") ?? null;
    });
    const pendingRefreshRef = useRef(false);

    const [activeTab, setActiveTab] = useState<FilterTab>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("newest");
    const [page, setPage] = useState(0);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [showSort, setShowSort] = useState(false);
    const sortRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showSort) return;
        const handler = (e: MouseEvent) => {
            if (sortRef.current && !sortRef.current.contains(e.target as Node)) setShowSort(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showSort]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const reviewId = initialReviewId ?? searchParams.get("review");
        if (!reviewId || !blogs?.length) return;
        const target = blogs.find((b: any) => b.id === reviewId);
        if (target) setPreviewBlog(target);
    }, []);

    const handlePublish = async (id: string) => {
        try {
            const res = await fetch(`/api/blogs/${id}/publish`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(
                    <div className="flex flex-col gap-1">
                        <span className="font-semibold">Blog Published Successfully!</span>
                        {data.mediumUrl && (<a href={data.mediumUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">View on Medium →</a>)}
                        {data.hashnodeUrl && (<a href={data.hashnodeUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">View on Hashnode →</a>)}
                        {data.wordPressUrl && (<a href={data.wordPressUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">View on WordPress →</a>)}
                        {data.ghostUrl && (<a href={data.ghostUrl} target="_blank" rel="noreferrer" className="text-xs text-yellow-400 hover:underline">View on Ghost →</a>)}
                    </div>,
                    { duration: 5000 }
                );
                pendingRefreshRef.current = true;
                return { success: true, mediumUrl: data.mediumUrl, hashnodeUrl: data.hashnodeUrl };
            } else {
                toast.error(data.error || "Failed to publish blog.");
                return { success: false };
            }
        } catch (error) {
            logger.error("[BlogList] Unexpected error:", { error: (error as any)?.message || error });
            toast.error("A network error occurred.");
            return { success: false };
        }
    };

    const handleDeleteStuck = async (id: string) => {
        try {
            await fetch(`/api/blogs/${id}`, { method: "DELETE" });
            router.refresh();
        } catch {
            toast.error("Failed to remove stuck blog.");
        }
    };

    const handleHashnodeSync = async (id: string) => {
        setSyncingIds(prev => new Set([...prev, id]));
        try {
            const res = await fetch(`/api/blogs/${id}/hashnode-sync`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(
                    <div className="flex flex-col gap-1">
                        <span className="font-semibold">Synced to Hashnode!</span>
                        <a href={data.hashnodeUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">View on Hashnode →</a>
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
            setSyncingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        }
    };

    const hasActiveBlog = blogs?.some(b => {
        if (b.status !== "GENERATING" && b.status !== "QUEUED") return false;
        return Date.now() - new Date(b.createdAt).getTime() < TEN_MINUTES_MS;
    });
    const pollCountRef = useRef(0);

    useEffect(() => {
        if (!hasActiveBlog) { pollCountRef.current = 0; return; }
        const interval = setInterval(() => {
            if (pollCountRef.current >= 30) { clearInterval(interval); pollCountRef.current = 0; return; }
            if (document.visibilityState !== "visible") return;
            if (previewBlog || linkModalBlog || repurposeBlog) return;
            pollCountRef.current += 1;
            router.refresh();
        }, 8000);
        return () => clearInterval(interval);
    }, [hasActiveBlog, previewBlog, linkModalBlog, repurposeBlog]);

    const repurposeBannerBlog = blogs?.find(
        (b: any) => b.status === "PUBLISHED" && b.id !== dismissedRepurposeId
    ) ?? null;

    const filtered = useMemo(() => {
        const tabFilter = TABS.find(t => t.key === activeTab)!.match;
        let result = (blogs ?? []).filter(tabFilter);

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (b: any) =>
                    b.title?.toLowerCase().includes(q) ||
                    b.targetKeywords?.some((k: string) => k.toLowerCase().includes(q))
            );
        }

        result.sort((a: any, b: any) => {
            switch (sortKey) {
                case "oldest":
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                case "score-desc":
                    return (b.validationScore ?? 0) - (a.validationScore ?? 0);
                case "score-asc":
                    return (a.validationScore ?? 0) - (b.validationScore ?? 0);
                default:
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
        });

        return result;
    }, [blogs, activeTab, searchQuery, sortKey]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages - 1);
    const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    useEffect(() => { setPage(0); }, [activeTab, searchQuery, sortKey]);

    const toggleSelect = useCallback((id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        const pageIds = paged.map((b: any) => b.id as string);
        const allSelected = pageIds.every(id => selected.has(id));
        setSelected(prev => {
            const next = new Set(prev);
            pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
            return next;
        });
    }, [paged, selected]);

    const tabCounts = useMemo(() => {
        const source = blogs ?? [];
        return TABS.reduce<Record<string, number>>((acc, tab) => {
            acc[tab.key] = source.filter(tab.match).length;
            return acc;
        }, {});
    }, [blogs]);

    const formatDate = (d: string) => {
        const date = new Date(d);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };

    return (
        <>
            {repurposeBannerBlog && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                    <Zap className="h-4 w-4 shrink-0 text-amber-400" />
                    <p className="min-w-0 flex-1 text-xs leading-snug text-amber-300">
                        <span className="font-semibold">🎉 &quot;{repurposeBannerBlog.title}&quot;</span> is live — repurpose it into LinkedIn, Twitter, email &amp; more in 30 seconds.
                    </p>
                    <button onClick={() => setRepurposeBlog(repurposeBannerBlog)} className="shrink-0 whitespace-nowrap rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/25">
                        Repurpose it →
                    </button>
                    <button
                        onClick={() => {
                            setDismissedRepurposeId(repurposeBannerBlog.id);
                            localStorage.setItem("repurpose_banner_dismissed", repurposeBannerBlog.id);
                        }}
                        className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-border bg-card/40 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-1">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                    activeTab === tab.key
                                        ? "bg-foreground/10 text-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                }`}
                            >
                                {tab.label}
                                <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                    activeTab === tab.key ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
                                }`}>
                                    {tabCounts[tab.key] ?? 0}
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search title or keyword…"
                                className="h-8 w-48 rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>

                        <div ref={sortRef} className="relative">
                            <button onClick={() => setShowSort(!showSort)} className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                                <ArrowUpDown className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{SORT_OPTIONS.find(s => s.key === sortKey)?.label}</span>
                            </button>
                            {showSort && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                                    {SORT_OPTIONS.map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => { setSortKey(opt.key); setShowSort(false); }}
                                            className={`flex w-full px-3 py-2 text-xs font-medium transition-colors hover:bg-accent ${sortKey === opt.key ? "text-foreground" : "text-muted-foreground"}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden divide-y divide-border">
                    {paged.length > 0 ? (
                        paged.map((blog: any) => {
                            const blogUrl = blog.status === "PUBLISHED" ? (blog.hashnodeUrl || blog.mediumUrl || null) : null;
                            const isStuck = (blog.status === "GENERATING" || blog.status === "QUEUED") && Date.now() - new Date(blog.createdAt).getTime() > TEN_MINUTES_MS;

                            return (
                                <div key={blog.id} className="space-y-3 p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="flex-1 text-sm font-medium leading-snug line-clamp-2">
                                            {blogUrl ? (
                                                <a href={blogUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                                                    {blog.title}
                                                    <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-40" />
                                                </a>
                                            ) : blog.title}
                                        </p>
                                        <StatusBadge status={blog.status} createdAt={blog.createdAt} />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <span className="max-w-[55%] truncate text-xs text-muted-foreground">{blog.targetKeywords?.[0] || "Auto-assigned"}</span>
                                        <div className="flex items-center gap-3">
                                            {blog.validationScore != null && <CircularScore score={blog.validationScore as number} />}
                                            <AiReadinessBadge blog={blog} />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <SyndicationIcons blog={blog} onHashnodeSync={handleHashnodeSync} syncingIds={syncingIds} />
                                        <span className="text-xs text-muted-foreground">{formatDate(blog.createdAt)}</span>
                                    </div>

                                    <div className="border-t border-border pt-2">
                                        <RowActions
                                            blog={blog}
                                            blogUrl={blogUrl}
                                            isStuck={isStuck}
                                            onPreview={() => setPreviewBlog(blog)}
                                            onRepurpose={() => setRepurposeBlog(blog)}
                                            onLinkModal={() => setLinkModalBlog(blog)}
                                            onDeleteStuck={() => handleDeleteStuck(blog.id)}
                                        />
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="px-6 py-16 text-center">
                            <p className="font-medium text-muted-foreground">No articles match this filter</p>
                            <p className="mt-1 text-xs text-muted-foreground">Try a different tab or clear your search.</p>
                        </div>
                    )}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="border-b border-border bg-card/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <tr>
                                <th className="w-10 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={paged.length > 0 && paged.every((b: any) => selected.has(b.id))}
                                        onChange={toggleAll}
                                        className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
                                    />
                                </th>
                                <th className="px-4 py-3 font-medium">Title</th>
                                <th className="px-4 py-3 font-medium">Keyword</th>
                                <th className="px-4 py-3 font-medium">SEO Score</th>
                                <th className="px-4 py-3 font-medium">AI Ready</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Published On</th>
                                <th className="px-4 py-3 font-medium">Date</th>
                                <th className="px-4 py-3 text-right font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {paged.length > 0 ? (
                                paged.map((blog: any) => {
                                    const blogUrl = blog.status === "PUBLISHED" ? (blog.hashnodeUrl || blog.mediumUrl || null) : null;
                                    const isStuck = (blog.status === "GENERATING" || blog.status === "QUEUED") && Date.now() - new Date(blog.createdAt).getTime() > TEN_MINUTES_MS;

                                    return (
                                        <tr key={blog.id} className="group transition-colors hover:bg-card/80">
                                            <td className="px-4 py-3.5">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(blog.id)}
                                                    onChange={() => toggleSelect(blog.id)}
                                                    className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
                                                />
                                            </td>
                                            <td className="max-w-[240px] truncate px-4 py-3.5 font-medium" title={blog.title}>
                                                {blogUrl ? (
                                                    <a href={blogUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-primary">
                                                        {blog.title}
                                                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-40" />
                                                    </a>
                                                ) : blog.title}
                                            </td>
                                            <td className="px-4 py-3.5 text-muted-foreground">{blog.targetKeywords?.[0] || "Auto-assigned"}</td>
                                            <td className="px-4 py-3.5">
                                                {blog.validationScore != null ? (
                                                    <CircularScore score={blog.validationScore as number} />
                                                ) : (
                                                    <span className="text-xs text-zinc-700">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <AiReadinessBadge blog={blog} />
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <StatusBadge status={blog.status} createdAt={blog.createdAt} />
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <SyndicationIcons blog={blog} onHashnodeSync={handleHashnodeSync} syncingIds={syncingIds} />
                                            </td>
                                            <td className="px-4 py-3.5 text-muted-foreground">{formatDate(blog.createdAt)}</td>
                                            <td className="px-4 py-3.5 text-right">
                                                <RowActions
                                                    blog={blog}
                                                    blogUrl={blogUrl}
                                                    isStuck={isStuck}
                                                    onPreview={() => setPreviewBlog(blog)}
                                                    onRepurpose={() => setRepurposeBlog(blog)}
                                                    onLinkModal={() => setLinkModalBlog(blog)}
                                                    onDeleteStuck={() => handleDeleteStuck(blog.id)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={9} className="px-6 py-20 text-center">
                                        <p className="font-medium text-muted-foreground">No articles match this filter</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Try a different tab or clear your search.</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {filtered.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between border-t border-border px-4 py-3">
                        <p className="text-xs text-muted-foreground">
                            Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={safePage === 0}
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setPage(i)}
                                    className={`h-7 w-7 rounded-lg text-xs font-semibold transition-colors ${
                                        i === safePage ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-accent"
                                    }`}
                                >
                                    {i + 1}
                                </button>
                            ))}
                            <button
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={safePage >= totalPages - 1}
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {previewBlog && (
                <ReviewBlogModal
                    blog={previewBlog}
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
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                    onClick={(e) => { if (e.target === e.currentTarget) setRepurposeBlog(null); }}
                    onKeyDown={(e) => { if (e.key === "Escape") setRepurposeBlog(null); }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Repurpose content"
                >
                    <div className="w-full max-w-2xl">
                        <RepurposeTab
                            blogId={repurposeBlog.id}
                            blogTitle={repurposeBlog.title}
                            blogSlug={repurposeBlog.slug}
                            onClose={() => setRepurposeBlog(null)}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
