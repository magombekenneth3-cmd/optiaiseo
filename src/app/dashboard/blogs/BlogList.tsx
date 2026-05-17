"use client";
import { logger } from "@/lib/logger";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReviewBlogModal } from "./ReviewBlogModal";
import { InternalLinksModal } from "./InternalLinksModal";
import { Eye, ExternalLink, Link as LinkIcon, Loader2, RefreshCw, X, Zap } from "lucide-react";
import { RepurposeTab } from "@/components/blog/RepurposeTab";
import { toast } from "sonner";
import { HashnodeIcon, MediumIcon, WordPressIcon, GhostIcon } from "@/components/icons/platforms";


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
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-colors"
            >
                ⚡ Snippet
            </button>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80">
                    <div className="w-full max-w-lg bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-foreground">Snippet Optimizer</h3>
                                {keyword && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Keyword: <span className="text-emerald-400">{keyword}</span>
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            {loading && (
                                <div className="flex items-center justify-center py-8 gap-3 text-sm text-muted-foreground">
                                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                                    Fetching current snippet and generating optimized block…
                                </div>
                            )}
                            {result && !loading && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Format detected</span>
                                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-bold uppercase">
                                            {result.format}
                                        </span>
                                    </div>
                                    {result.currentSnippet && (
                                        <div>
                                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Current Google Snippet</p>
                                            <div className="bg-muted/40 border border-border rounded-lg p-3 text-xs text-zinc-400 italic leading-relaxed">
                                                {result.currentSnippet}
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">Your Optimized Block</p>
                                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-xs text-zinc-200 leading-relaxed font-mono whitespace-pre-wrap">
                                            {result.optimizedBlock}
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                                        <span className="text-blue-400 text-xs font-bold uppercase tracking-wider shrink-0 mt-0.5">Where to put it</span>
                                        <p className="text-xs text-zinc-300 leading-relaxed">{result.insertionGuidance}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(result.optimizedBlock);
                                            toast.success("Optimized block copied!");
                                        }}
                                        className="w-full py-2 text-sm font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl transition-colors"
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

export function BlogList({ blogs, success, initialReviewId }: { blogs: any[]; success: boolean; initialReviewId?: string }) {

    const router = useRouter();
    const searchParams = useSearchParams();

    const [previewBlog, setPreviewBlog] = useState<any | null>(null);
    const [linkModalBlog, setLinkModalBlog] = useState<any | null>(null);
    const [repurposeBlog, setRepurposeBlog] = useState<any | null>(null);
    const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
    // Track dismissed repurpose banner per blog id (localStorage-backed)
    const [dismissedRepurposeId, setDismissedRepurposeId] = useState<string | null>(() => {
        if (typeof window === "undefined") return null;
        return localStorage.getItem("repurpose_banner_dismissed") ?? null;
    });
    // Track whether we need to refresh after the modal closes (e.g. after publish)
    const pendingRefreshRef = useRef(false);

    // Auto-open the review modal when ?review={id} is in the URL (e.g. after
    // generating a blog from the keywords page).
    useEffect(() => {
        const reviewId = initialReviewId ?? searchParams.get("review");
        if (!reviewId || !blogs?.length) return;
        const target = blogs.find((b: any) => b.id === reviewId);
        if (target) setPreviewBlog(target);
    // Only run on mount — blogs reference changes on every refresh so use length
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePublish = async (id: string) => {
        try {
            const res = await fetch(`/api/blogs/${id}/publish`, { method: "POST" });
            const data = await res.json();

            if (res.ok && data.success) {
                toast.success(
                    <div className="flex flex-col gap-1">
                        <span className="font-semibold">Blog Published Successfully!</span>
                        {data.mediumUrl && (
                            <a href={data.mediumUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">
                                View on Medium →
                            </a>
                        )}
                        {data.hashnodeUrl && (
                            <a href={data.hashnodeUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                                View on Hashnode →
                            </a>
                        )}
                        {data.wordPressUrl && (
                            <a href={data.wordPressUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">
                                View on WordPress →
                            </a>
                        )}
                        {data.ghostUrl && (
                            <a href={data.ghostUrl} target="_blank" rel="noreferrer" className="text-xs text-yellow-400 hover:underline">
                                View on Ghost →
                            </a>
                        )}
                    </div>,
                    { duration: 5000 }
                );

                // Mark that we need a refresh, but do it AFTER the modal closes
                // so the user doesn't see a flash/reload while the modal is still open.
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
                        <a href={data.hashnodeUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                            View on Hashnode →
                        </a>
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

    // Auto-refresh while blogs are GENERATING or QUEUED but cap at 30 attempts (~4 min).
    // Skip blogs stuck beyond 10 minutes — Inngest is likely not running.
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const hasActiveBlog = blogs?.some(b => {
        if (b.status !== "GENERATING" && b.status !== "QUEUED") return false;
        const age = Date.now() - new Date(b.createdAt).getTime();
        return age < TEN_MINUTES_MS;
    });
    const pollCountRef = useRef(0);

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
            // Pause while user has a modal open or switched tabs
            if (document.visibilityState !== "visible") return;
            if (previewBlog || linkModalBlog || repurposeBlog) return;

            pollCountRef.current += 1;
            router.refresh();
        }, 8000); // 8s — snappy but not aggressive

        return () => clearInterval(interval);
    }, [hasActiveBlog, previewBlog, linkModalBlog, repurposeBlog]);

    // Repurpose banner: latest PUBLISHED blog that hasn't been repurposed and isn't dismissed
    const repurposeBannerBlog = blogs?.find(
        (b: any) => b.status === "PUBLISHED" && b.id !== dismissedRepurposeId
    ) ?? null;

    return (
        <>
            {/* ── Repurpose nudge banner ──────────────────────────────────── */}
            {repurposeBannerBlog && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/5 mb-3">
                    <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="flex-1 text-xs text-amber-300 leading-snug min-w-0">
                        <span className="font-semibold">🎉 &quot;{repurposeBannerBlog.title}&quot;</span> is live —
                        repurpose it into LinkedIn, Twitter, email &amp; more in 30 seconds.
                    </p>
                    <button
                        onClick={() => setRepurposeBlog(repurposeBannerBlog)}
                        className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors whitespace-nowrap"
                    >
                        Repurpose it →
                    </button>
                    <button
                        onClick={() => {
                            setDismissedRepurposeId(repurposeBannerBlog.id);
                            localStorage.setItem("repurpose_banner_dismissed", repurposeBannerBlog.id);
                        }}
                        className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                        title="Dismiss"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {/* ── Mobile card list (below md) ──────────────────────────────── */}
            <div className="md:hidden space-y-2">
                {success && blogs && blogs.length > 0 ? (
                    blogs.map((blog: any) => {
                        const blogUrl = blog.status === "PUBLISHED"
                            ? (blog.hashnodeUrl || blog.mediumUrl || null)
                            : null;
                        const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                        const isStuck = (blog.status === "QUEUED" || blog.status === "GENERATING") &&
                            (Date.now() - new Date(blog.createdAt).getTime()) > TEN_MINUTES_MS;

                        return (
                            <div key={blog.id} className="card-surface p-4 space-y-3">
                                {/* Title row */}
                                <div className="flex items-start justify-between gap-2">
                                    <p className="font-medium text-sm leading-snug line-clamp-2 flex-1">
                                        {blogUrl ? (
                                            <a href={blogUrl} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">
                                                {blog.title}
                                                <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                                            </a>
                                        ) : blog.title}
                                    </p>
                                    {/* Status badge */}
                                    {blog.status === "PUBLISHED" && (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            Published
                                        </span>
                                    )}
                                    {blog.status === "DRAFT" && (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                            Draft
                                        </span>
                                    )}
                                    {(blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") && (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-400 text-xs font-medium border border-orange-500/20">
                                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                            Needs Review
                                        </span>
                                    )}
                                    {blog.status === "FAILED" && (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                            Failed
                                        </span>
                                    )}
                                    {(blog.status === "GENERATING" || blog.status === "QUEUED") && (
                                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
                                            isStuck
                                                ? "bg-red-500/10 text-red-400 border-red-500/20"
                                                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                        }`}>
                                            {isStuck
                                                ? <><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Stuck</>
                                                : <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Writing…</>
                                            }
                                        </span>
                                    )}
                                </div>

                                {/* Keyword + quality */}
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="truncate max-w-[55%]">{blog.targetKeywords?.[0] || "Auto-assigned"}</span>
                                    {blog.validationScore != null && (
                                        <span className={`font-mono font-semibold px-1.5 py-0.5 rounded border text-xs ${
                                            hasErrors || blog.validationScore < 60
                                                ? "bg-red-500/10 text-red-400 border-red-500/20"
                                                : blog.validationScore < 80
                                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        }`}>
                                            {blog.validationScore}/100{hasErrors ? " ⚠" : ""}
                                        </span>
                                    )}
                                </div>

                                {/* Syndication icons + date */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {blog.hashnodeUrl && (
                                            <a href={blog.hashnodeUrl} target="_blank" rel="noreferrer" title="View on Hashnode" className="text-blue-400 hover:text-blue-300">
                                                <HashnodeIcon className="w-4 h-4" />
                                            </a>
                                        )}
                                        {blog.mediumUrl && (
                                            <a href={blog.mediumUrl} target="_blank" rel="noreferrer" title="View on Medium" className="text-emerald-400 hover:text-emerald-300">
                                                <MediumIcon className="w-4 h-4" />
                                            </a>
                                        )}
                                        {blog.wordPressUrl && (
                                            <a href={blog.wordPressUrl} target="_blank" rel="noreferrer" title="View on WordPress" className="text-blue-500 hover:text-blue-400">
                                                <WordPressIcon className="w-4 h-4" />
                                            </a>
                                        )}
                                        {blog.ghostUrl && (
                                            <a href={blog.ghostUrl} target="_blank" rel="noreferrer" title="View on Ghost" className="text-yellow-500 hover:text-yellow-400">
                                                <GhostIcon className="w-4 h-4" />
                                            </a>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {(() => { const d = new Date(blog.createdAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()}
                                    </span>
                                </div>

                                {/* Action button */}
                                <div className="pt-1 border-t border-border">
                                    {isStuck ? (
                                        <button onClick={() => handleDeleteStuck(blog.id)} className="w-full inline-flex items-center justify-center gap-1.5 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                                            Delete stuck job
                                        </button>
                                    ) : blog.status === "QUEUED" ? (
                                        <p className="text-center text-xs text-muted-foreground italic py-1">Generating…</p>
                                    ) : blog.status === "DRAFT" || blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW" ? (
                                        <button
                                            onClick={() => setPreviewBlog(blog)}
                                            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                                                hasErrors || (blog.validationScore != null && blog.validationScore < 60)
                                                    ? "text-amber-400 border border-amber-500/30 hover:bg-amber-500/10"
                                                    : "text-primary hover:bg-primary/10"
                                            }`}
                                        >
                                            <Eye className="w-4 h-4" />
                                            {(blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") ? "Review & Fix" : "Review & Publish"}
                                        </button>
                                    ) : (
                                        <div className="flex gap-2 flex-wrap">
                                            <button
                                                onClick={() => setRepurposeBlog(repurposeBlog?.id === blog.id ? null : blog)}
                                                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition-colors"
                                            >
                                                <Zap className="w-3.5 h-3.5" />
                                                Repurpose
                                            </button>
                                            <button
                                                onClick={() => setLinkModalBlog(blog)}
                                                className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                            >
                                                <LinkIcon className="w-3.5 h-3.5" />
                                                Cluster
                                            </button>
                                            <SnippetOptimizeButton blogId={blog.id} keyword={blog.targetKeywords?.[0]} />
                                            {blogUrl && (
                                                <a
                                                    href={blogUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                                >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    View
                                                </a>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="card-surface p-10 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center border border-border shadow-inner mx-auto mb-3">
                            <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                        </div>
                        <p className="text-muted-foreground font-medium">No SEO content generated yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Click &quot;Generate Post&quot; to create new high-ranking SEO content.</p>
                    </div>
                )}
            </div>

            {/* ── Desktop table (md+) ───────────────────────────────────────── */}
            <div className="hidden md:block card-surface overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-card/40 uppercase text-xs font-semibold text-muted-foreground border-b border-border tracking-wider">
                            <tr>
                                <th className="px-6 py-4 font-medium">Post Title</th>
                                <th className="px-6 py-4 font-medium">Target Keyword</th>
                                <th className="px-6 py-4 font-medium">Quality</th>
                                <th className="px-6 py-4 font-medium">Status</th>
                                <th className="px-6 py-4 font-medium">Published On</th>
                                <th className="px-6 py-4 font-medium">Date</th>
                                <th className="px-6 py-4 text-right font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {success && blogs && blogs.length > 0 ? (
                                blogs.map((blog: any) => {
                                    // Published blogs link to the syndicated platform URL (Hashnode first, then Medium).
                                    // We intentionally do NOT fall back to the website URL — Hashnode is the
                                    // canonical "published on" destination. Draft/unpublished blogs have no link.
                                    const blogUrl = blog.status === "PUBLISHED"
                                        ? (blog.hashnodeUrl || blog.mediumUrl || null)
                                        : null;

                                    return (
                                        <tr key={blog.id} className="hover:bg-card transition-colors group">
                                            <td className="px-6 py-4 font-medium truncate max-w-[220px]" title={blog.title}>
                                                {blogUrl ? (
                                                    <a href={blogUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors inline-flex items-center gap-1.5">
                                                        {blog.title}
                                                        {blog.status === "PUBLISHED" && <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />}
                                                    </a>
                                                ) : blog.title}
                                            </td>

                                            <td className="px-6 py-4 text-muted-foreground">
                                                {blog.targetKeywords?.[0] || "Auto-assigned"}
                                            </td>

                                            {/* Validation quality badge */}
                                            <td className="px-6 py-4">
                                                {blog.validationScore != null ? (() => {
                                                    const score = blog.validationScore as number;
                                                    const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                                                    const color = hasErrors || score < 60
                                                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                                                        : score < 80
                                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                                                    const label = hasErrors ? `${score}/100 ⚠` : `${score}/100`;
                                                    const tip = hasErrors
                                                        ? `Errors: ${(blog.validationErrors as string[]).slice(0, 2).join(" · ")}`
                                                        : score < 60
                                                        ? "Low quality score — review before publishing"
                                                        : score < 80
                                                        ? "Good — minor improvements possible"
                                                        : "High quality";
                                                    return (
                                                        <span
                                                            title={tip}
                                                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold border cursor-default ${color}`}
                                                        >
                                                            {label}
                                                        </span>
                                                    );
                                                })() : (
                                                    <span className="text-zinc-700 text-xs">—</span>
                                                )}
                                            </td>

                                            <td className="px-6 py-4">
                                                {blog.status === "PUBLISHED" && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        Published
                                                    </span>
                                                )}
                                                {blog.status === "DRAFT" && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                                        Pending Review
                                                    </span>
                                                )}
                                                {(blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-500/10 text-orange-400 text-xs font-medium border border-orange-500/20" title="Quality score below threshold — please review before publishing">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                                        Needs Review
                                                    </span>
                                                )}
                                                {blog.status === "FAILED" && (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                                        Failed
                                                    </span>
                                                )}
                                                {(blog.status === "GENERATING" || blog.status === "QUEUED") && (
                                                    (Date.now() - new Date(blog.createdAt).getTime()) > TEN_MINUTES_MS ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20" title="Job timed out — delete and try again.">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                                            Stuck
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 text-xs font-medium border border-blue-500/20">
                                                            <svg className="animate-spin w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                            </svg>
                                                            Writing…
                                                        </span>
                                                    )
                                                )}
                                            </td>


                                            {/* Syndication links — Hashnode & Medium icons */}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    {blog.hashnodeUrl ? (
                                                        <a
                                                            href={blog.hashnodeUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="View on Hashnode"
                                                            className="text-blue-400 hover:text-blue-300 transition-colors"
                                                        >
                                                            <HashnodeIcon className="w-4 h-4" />
                                                        </a>
                                                    ) : (
                                                        blog.status === "PUBLISHED" && (
                                                            <button
                                                                onClick={() => handleHashnodeSync(blog.id)}
                                                                disabled={syncingIds.has(blog.id)}
                                                                title="Sync to Hashnode"
                                                                aria-label="Sync to Hashnode"
                                                                className="inline-flex items-center gap-1 text-amber-600/70 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-wait text-xs"
                                                            >
                                                                {syncingIds.has(blog.id)
                                                                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                    : <HashnodeIcon className="w-4 h-4" />
                                                                }
                                                            </button>
                                                        )
                                                    )}
                                                    {blog.mediumUrl ? (
                                                        <a
                                                            href={blog.mediumUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="View on Medium"
                                                            className="text-emerald-400 hover:text-emerald-300 transition-colors"
                                                        >
                                                            <MediumIcon className="w-4 h-4" />
                                                        </a>
                                                    ) : (
                                                        blog.status === "PUBLISHED" && (
                                                            <span title="Not synced to Medium">
                                                                <MediumIcon className="w-4 h-4 text-zinc-700" />
                                                            </span>
                                                        )
                                                    )}
                                                    {blog.wordPressUrl ? (
                                                        <a
                                                            href={blog.wordPressUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="View on WordPress"
                                                            className="text-blue-500 hover:text-blue-400 transition-colors"
                                                        >
                                                            <WordPressIcon className="w-4 h-4" />
                                                        </a>
                                                    ) : null}
                                                    {blog.ghostUrl ? (
                                                        <a
                                                            href={blog.ghostUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="View on Ghost"
                                                            className="text-yellow-500 hover:text-yellow-400 transition-colors"
                                                        >
                                                            <GhostIcon className="w-4 h-4" />
                                                        </a>
                                                    ) : null}
                                                    {(blog.status === "DRAFT" || blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") && (
                                                        <span className="text-zinc-700 text-xs">—</span>
                                                    )}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 text-muted-foreground">
                                                {(() => {
                                                    const d = new Date(blog.createdAt);
                                                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                })()}
                                            </td>

                                            <td className="px-6 py-4 text-right">
                                                {(blog.status === "GENERATING" || blog.status === "QUEUED" || blog.status === "FAILED") ? (
                                                    (() => {
                                                        const isFailed = blog.status === "FAILED";
                                                        const isTimedOut = !isFailed &&
                                                            (Date.now() - new Date(blog.createdAt).getTime()) > TEN_MINUTES_MS;
                                                        if (isFailed || isTimedOut) {
                                                            return (
                                                                <button
                                                                    onClick={() => handleDeleteStuck(blog.id)}
                                                                    className="inline-flex items-center gap-1.5 text-red-400 hover:text-white hover:bg-red-500/20 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer"
                                                                    title={isFailed ? "Generation failed — delete and try again" : "Job timed out — delete and try again"}
                                                                >
                                                                    Delete
                                                                </button>
                                                            );
                                                        }
                                                        return (
                                                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-400 italic">
                                                                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                                Writing… (~30s)
                                                            </span>
                                                        );
                                                    })()
                                                ) : blog.status === "DRAFT" || blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW" ? (
                                                    (() => {
                                                        const hasErrors = Array.isArray(blog.validationErrors) && blog.validationErrors.length > 0;
                                                        const lowScore = blog.validationScore != null && (blog.validationScore as number) < 60;
                                                        const warn = hasErrors || lowScore;
                                                        return (
                                                            <button
                                                                onClick={() => setPreviewBlog(blog)}
                                                                title={warn ? `Quality issues detected — review carefully before publishing (score: ${blog.validationScore}/100)` : undefined}
                                                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                                                                    warn
                                                                        ? "text-amber-400 hover:text-amber-900 hover:bg-amber-400 border border-amber-500/40"
                                                                        : "text-primary hover:text-primary-foreground hover:bg-primary"
                                                                }`}
                                                            >
                                                                <Eye className="w-4 h-4" />
                                                                {warn ? "⚠ Review First" : (blog.status === "REVIEW" || blog.status === "NEEDS_REVIEW") ? "Review & Fix" : "Review & Publish"}
                                                            </button>
                                                        );
                                                    })()

                                                ) : (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => setRepurposeBlog(repurposeBlog?.id === blog.id ? null : blog)}
                                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                                                repurposeBlog?.id === blog.id
                                                                    ? "text-amber-300 bg-amber-500/15 border border-amber-500/30"
                                                                    : "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                                            }`}
                                                            title="Repurpose this blog into LinkedIn, X, YouTube, Reddit, Podcast"
                                                        >
                                                            <Zap className="w-3.5 h-3.5" />
                                                            Repurpose
                                                        </button>
                                                        <button
                                                            onClick={() => setLinkModalBlog(blog)}
                                                            className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                                                            title="Generate Internal Linking Opportunities"
                                                        >
                                                            <LinkIcon className="w-3.5 h-3.5" />
                                                            Cluster Links
                                                        </button>
                                                        <SnippetOptimizeButton blogId={blog.id} keyword={blog.targetKeywords?.[0]} />
                                                        {blogUrl ? (
                                                            <a
                                                                href={blogUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                                                            >
                                                                <ExternalLink className="w-3.5 h-3.5" />
                                                                View Live
                                                            </a>
                                                        ) : (
                                                            <Link href={`/dashboard/sites/${blog.siteId}`} className="inline-block text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
                                                                View Site
                                                            </Link>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                     
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={7} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center space-y-3">
                                            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center border border-border shadow-inner">
                                                <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                                </svg>
                                            </div>
                                            <p className="text-muted-foreground font-medium tracking-wide">No SEO content generated yet</p>
                                            <p className="text-xs text-muted-foreground max-w-sm">Click &quot;Generate Post&quot; to create new high-ranking SEO content tailored to your target keywords.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* end desktop table */}

            {previewBlog && (
                <ReviewBlogModal
                    blog={previewBlog}
                    onClose={() => {
                        setPreviewBlog(null);
                        // Refresh AFTER the modal is gone — no flash while modal is open
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-150"
                    onClick={(e) => { if (e.target === e.currentTarget) setRepurposeBlog(null); }}
                    onKeyDown={(e) => { if (e.key === "Escape") setRepurposeBlog(null); }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Repurpose content"
                >
                    <div className="w-full max-w-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
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
