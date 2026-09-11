"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    ChevronRight,
    Clock3,
    FileText,
    Info,
    Loader2,
    Save,
    ShieldCheck,
    Sparkles,
    X,
    Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeExternalLinks from "rehype-external-links";
import { toast } from "sonner";
import { ContentEditor } from "./ContentEditor";
import type { ContentScoreResult } from "@/lib/content-scoring";
import type { CitationCriterion } from "@/lib/blog/ai-citation-template";
import { logger } from "@/lib/logger";

interface Blog {
    id: string;
    title: string;
    content: string;
    status: string;
    targetKeywords: string[];
    citationScore?: number | null;
    citationCriteria?: unknown;
}

type ReviewMode = "write" | "review";

interface ReviewBlogModalProps {
    blog: Blog;
    onClose: () => void;
    onPublish: (id: string) => Promise<{ success: boolean; mediumUrl?: string; hashnodeUrl?: string }>;
}

function getScoreState(score: number) {
    if (score >= 80) return { label: "Ready to publish", shortLabel: "Ready", tone: "success" as const };
    if (score >= 60) return { label: "Needs minor work", shortLabel: "Needs work", tone: "warning" as const };
    return { label: "Needs attention", shortLabel: "Needs attention", tone: "danger" as const };
}

function toneClasses(tone: "success" | "warning" | "danger") {
    switch (tone) {
        case "success": return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", bar: "bg-emerald-500" };
        case "warning": return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", bar: "bg-amber-500" };
        default: return { text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", bar: "bg-rose-500" };
    }
}

function ReadinessCard({ score, criteria }: { score: number; criteria: CitationCriterion[] }) {
    const state = getScoreState(score);
    const tone = toneClasses(state.tone);

    const failed = useMemo(
        () => criteria.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight),
        [criteria]
    );
    const passed = useMemo(() => criteria.filter((c) => c.passed), [criteria]);

    return (
        <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <ShieldCheck className={`h-4 w-4 ${tone.text}`} />
                            <h3 className="text-sm font-semibold">Citation readiness</h3>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            How prepared this article is for AI citation.
                        </p>
                    </div>
                    <div className="text-right">
                        <div className={`text-2xl font-bold tabular-nums ${tone.text}`}>
                            {score}
                            <span className="text-sm font-medium text-muted-foreground">/100</span>
                        </div>
                        <div className={`text-[11px] font-medium ${tone.text}`}>{state.label}</div>
                    </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
                        style={{ width: `${score}%` }}
                    />
                </div>
            </div>

            <div className="px-4 py-3">
                {failed.length > 0 ? (
                    <>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Needs attention
                            </span>
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {failed.length}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {failed.map((criterion) => (
                                <div key={criterion.id} className="rounded-lg border border-border bg-background/50 p-3">
                                    <div className="flex items-start gap-2.5">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-medium">{criterion.label}</span>
                                                <span className="shrink-0 tabular-nums text-[10px] font-semibold text-muted-foreground">
                                                    {criterion.score}/{criterion.weight}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                                {criterion.fix}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex items-center gap-2 py-2 text-xs text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        All citation criteria passed.
                    </div>
                )}

                {passed.length > 0 && failed.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            {passed.length} criteria already passing
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

function MetricRow({ label, value, description }: { label: string; value: string; description?: string }) {
    return (
        <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
            <div>
                <div className="text-xs font-medium">{label}</div>
                {description && <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>}
            </div>
            <div className="text-sm font-semibold tabular-nums">{value}</div>
        </div>
    );
}

function ChecklistItem({ label, complete }: { label: string; complete: boolean }) {
    return (
        <div className="flex items-center gap-2.5 text-xs">
            {complete ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className={complete ? "text-muted-foreground" : "font-medium text-foreground"}>
                {label}
            </span>
        </div>
    );
}

export function ReviewBlogModal({ blog, onClose, onPublish }: ReviewBlogModalProps) {
    const [mode, setMode] = useState<ReviewMode>("write");
    const [editedContent, setEditedContent] = useState(blog.content);
    const [scoreResult, setScoreResult] = useState<ContentScoreResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isImproving, setIsImproving] = useState(false);
    const [aiContent, setAiContent] = useState<string | null>(null);
    const [showAiReview, setShowAiReview] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const citationScore = blog.citationScore ?? null;
    const citationCriteria: CitationCriterion[] = Array.isArray(blog.citationCriteria)
        ? (blog.citationCriteria as CitationCriterion[])
        : [];

    // scoreResult.score is the correct field — ContentScoreResult has no overallScore
    const activeScore = scoreResult?.score ?? citationScore;

    const failedCitationCriteria = useMemo(
        () => citationCriteria.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight),
        [citationCriteria]
    );

    const issueCount = failedCitationCriteria.length + (scoreResult?.topOpportunities?.length ?? 0);

    const scoreState = activeScore !== null
        ? getScoreState(activeScore)
        : { label: "Not analyzed", shortLabel: "Not analyzed", tone: "warning" as const };

    const headerTone = toneClasses(scoreState.tone);

    useEffect(() => {
        setHasUnsavedChanges(editedContent !== blog.content);
    }, [editedContent, blog.content]);

    useEffect(() => {
        if (!showAiReview) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setShowAiReview(false);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [showAiReview]);

    const handleContentChange = useCallback((c: string) => setEditedContent(c), []);
    const handleScoreChange = useCallback((s: ContentScoreResult | null) => setScoreResult(s), []);

    const handleSaveEdits = useCallback(async () => {
        if (!hasUnsavedChanges) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/blogs/${blog.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: editedContent }),
            });
            if (!res.ok) throw new Error("Failed to save edits");
            setHasUnsavedChanges(false);
            toast.success("Draft saved");
        } catch (error) {
            logger.error("Failed to save blog edits", { error: (error as Error)?.message || error });
            toast.error("Couldn't save the draft");
        } finally {
            setIsSaving(false);
        }
    }, [blog.id, editedContent, hasUnsavedChanges]);

    const handleAIImprove = useCallback(async () => {
        setIsImproving(true);
        try {
            const issues: string[] = [];
            if (scoreResult) {
                if (scoreResult.topOpportunities?.length) issues.push(...scoreResult.topOpportunities);
                const missingTerms = scoreResult.subScores?.nlpTerms?.missing;
                if (missingTerms?.length) issues.push(`Add missing semantic terms: ${missingTerms.join(", ")}`);
                const missingHeadings = scoreResult.subScores?.headings?.missing;
                if (missingHeadings?.length) issues.push(`Add missing headings: ${missingHeadings.join(", ")}`);
            }

            const citationIssues = failedCitationCriteria
                .slice(0, 3)
                .map((c) => `[CITATION] ${c.fix}`);

            const res = await fetch(`/api/blogs/${blog.id}/improve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    issues: [...issues, ...citationIssues],
                    citationScore,
                    scoreData: scoreResult
                        ? {
                            wordCount: scoreResult.subScores?.wordCount,
                            keywords: scoreResult.subScores?.exactKeywords,
                            readabilityGrade: scoreResult.subScores?.readability?.gradeLevel,
                            missingTerms: scoreResult.subScores?.nlpTerms?.missing,
                            missingHeadings: scoreResult.subScores?.headings?.missing,
                        }
                        : null,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "AI improvement failed");
            }

            const { content } = await res.json();
            if (!content) throw new Error("AI returned no content");

            setAiContent(content);
            setShowAiReview(true);
            toast.success("AI improvement is ready to review");
        } catch (error) {
            logger.error("AI improvement failed", { error: (error as Error)?.message || error });
            toast.error((error as Error)?.message || "AI improvement failed. Please try again.");
        } finally {
            setIsImproving(false);
        }
    }, [blog.id, citationScore, failedCitationCriteria, scoreResult]);

    const acceptAiChanges = useCallback(() => {
        if (!aiContent) return;
        setEditedContent(aiContent);
        setHasUnsavedChanges(true);
        setAiContent(null);
        setShowAiReview(false);
        setMode("write");
        toast.success("AI changes applied to draft");
    }, [aiContent]);

    const rejectAiChanges = useCallback(() => {
        setAiContent(null);
        setShowAiReview(false);
        toast("AI suggestions discarded");
    }, []);

    const handlePublish = useCallback(async () => {
        if (hasUnsavedChanges) {
            toast.error("Save your latest changes before publishing");
            return;
        }
        setIsPublishing(true);
        try {
            const result = await onPublish(blog.id);
            if (result.success) {
                toast.success("Article published");
                onClose();
            }
        } catch (error) {
            logger.error("Publishing failed", { error: (error as Error)?.message || error });
            toast.error("Couldn't publish this article");
        } finally {
            setIsPublishing(false);
        }
    }, [blog.id, hasUnsavedChanges, onClose, onPublish]);

    return (
        <div className="fixed inset-0 z-50 bg-background">
            <div className="flex h-full flex-col">
                {/* ── Top bar ── */}
                <header className="flex h-16 shrink-0 items-center border-b border-border bg-card">
                    <div className="flex min-w-0 flex-1 items-center gap-4 px-5">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>

                        <div className="h-6 w-px bg-border" />

                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="truncate text-sm font-semibold">{blog.title}</h1>
                                <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    Draft
                                </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>
                                    Target:{" "}
                                    <span className="font-medium text-foreground/80">
                                        {blog.targetKeywords?.[0] || "No target keyword"}
                                    </span>
                                </span>
                                <span>·</span>
                                <span className="flex items-center gap-1">
                                    <Clock3 className="h-3 w-3" />
                                    {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Readiness pill */}
                    <div className="mr-4 flex items-center gap-3">
                        {activeScore !== null && (
                            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${headerTone.bg} ${headerTone.border}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${headerTone.bar}`} />
                                <span className={`text-xs font-semibold ${headerTone.text}`}>{activeScore}/100</span>
                                <span className="text-[11px] text-muted-foreground">{scoreState.shortLabel}</span>
                            </div>
                        )}
                    </div>

                    {/* Mode switch */}
                    <div className="mr-4 flex rounded-lg border border-border bg-background p-1">
                        <button
                            type="button"
                            onClick={() => setMode("write")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                mode === "write" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <FileText className="h-3.5 w-3.5" />
                            Write
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("review")}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                mode === "review" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Review
                        </button>
                    </div>
                </header>

                {/* ── Main workspace ── */}
                <main className="flex min-h-0 flex-1">
                    {/* Article area */}
                    <section className="min-w-0 flex-1 overflow-y-auto bg-background">
                        {mode === "write" ? (
                            <div className="mx-auto h-full w-full max-w-5xl px-6 py-8 lg:px-10">
                                <ContentEditor
                                    initialContent={editedContent}
                                    initialKeyword={blog.targetKeywords?.[0] || ""}
                                    blogId={blog.id}
                                    onContentChange={handleContentChange}
                                    onScoreChange={handleScoreChange}
                                />
                            </div>
                        ) : (
                            <div className="mx-auto w-full max-w-4xl px-8 py-12">
                                <article className="prose prose-invert prose-emerald max-w-none prose-headings:scroll-m-20 prose-img:w-full prose-img:rounded-xl prose-img:object-cover">
                                    <h1>{blog.title}</h1>
                                    <div className="not-prose mb-8 flex items-center gap-3 border-b border-border pb-5 text-xs text-muted-foreground">
                                        <span>Draft</span>
                                        <span>·</span>
                                        <span>{blog.targetKeywords?.[0] || "No target keyword"}</span>
                                    </div>
                                    <ReactMarkdown
                                        rehypePlugins={[
                                            rehypeRaw,
                                            [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
                                        ]}
                                    >
                                        {editedContent}
                                    </ReactMarkdown>
                                </article>
                            </div>
                        )}
                    </section>

                    {/* ── Sidebar ── */}
                    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-border bg-card/40 xl:block">
                        <div className="space-y-4 p-4">
                            <div>
                                <h2 className="text-sm font-semibold">Optimization</h2>
                                <p className="mt-1 text-xs text-muted-foreground">Review the article before publishing.</p>
                            </div>

                            {activeScore !== null && citationCriteria.length > 0 ? (
                                <ReadinessCard score={activeScore} criteria={citationCriteria} />
                            ) : (
                                <section className="rounded-xl border border-border bg-card p-4">
                                    <div className="flex items-start gap-3">
                                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                        <div>
                                            <h3 className="text-xs font-semibold">Citation score unavailable</h3>
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                                Analyze the content to see citation readiness and optimization recommendations.
                                            </p>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Content health */}
                            {scoreResult && (
                                <section className="rounded-xl border border-border bg-card">
                                    <div className="border-b border-border px-4 py-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-xs font-semibold">Content health</h3>
                                                <p className="mt-1 text-[10px] text-muted-foreground">Based on the latest analysis.</p>
                                            </div>
                                            <span className="text-sm font-bold tabular-nums">{scoreResult.score}/100</span>
                                        </div>
                                    </div>
                                    <div className="px-4">
                                        <MetricRow
                                            label="Word count"
                                            value={String(scoreResult.subScores.wordCount.current)}
                                            description={`Target: ${scoreResult.subScores.wordCount.targetMin}–${scoreResult.subScores.wordCount.targetMax}`}
                                        />
                                        <MetricRow
                                            label="Readability"
                                            value={`Grade ${scoreResult.subScores.readability.gradeLevel.toFixed(1)}`}
                                        />
                                        <MetricRow
                                            label="Keyword uses"
                                            value={String(scoreResult.subScores.exactKeywords.current)}
                                            description={`Median: ${scoreResult.subScores.exactKeywords.targetMin}`}
                                        />
                                    </div>
                                </section>
                            )}

                            {/* AI improve action */}
                            {issueCount > 0 && (
                                <section className="rounded-xl border border-border bg-card p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                            <Sparkles className="h-4 w-4 text-primary" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-xs font-semibold">Recommended improvement</h3>
                                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                                                AI can address the highest-impact issues without changing your draft until you approve.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAIImprove}
                                        disabled={isImproving || isPublishing}
                                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isImproving ? (
                                            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Improving content...</>
                                        ) : (
                                            <><Zap className="h-3.5 w-3.5" />Fix {issueCount} issues with AI</>
                                        )}
                                    </button>
                                </section>
                            )}

                            {/* Publishing checklist */}
                            <section className="rounded-xl border border-border bg-card p-4">
                                <div className="mb-3 flex items-center gap-2">
                                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                                    <h3 className="text-xs font-semibold">Publishing checklist</h3>
                                </div>
                                <div className="space-y-2.5">
                                    <ChecklistItem label="Content reviewed" complete={editedContent.trim().length > 0} />
                                    <ChecklistItem
                                        label="Optimization analyzed"
                                        complete={scoreResult !== null || citationScore !== null}
                                    />
                                    <ChecklistItem label="Changes saved" complete={!hasUnsavedChanges} />
                                    <ChecklistItem
                                        label="Citation ready"
                                        complete={activeScore !== null && activeScore >= 60}
                                    />
                                </div>
                            </section>
                        </div>
                    </aside>
                </main>

                {/* ── Footer ── */}
                <footer className="flex h-16 shrink-0 items-center justify-between border-t border-border bg-card px-5">
                    <div className="flex items-center gap-3">
                        {hasUnsavedChanges ? (
                            <span className="flex items-center gap-2 text-xs text-amber-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                Unsaved changes
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                                All changes saved
                            </span>
                        )}

                        {mode === "write" && (
                            <button
                                type="button"
                                onClick={handleSaveEdits}
                                disabled={!hasUnsavedChanges || isSaving}
                                className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {isSaving ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Save className="h-3.5 w-3.5" />
                                )}
                                {isSaving ? "Saving..." : "Save draft"}
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            Close
                        </button>

                        <button
                            type="button"
                            onClick={handlePublish}
                            disabled={
                                isPublishing ||
                                isSaving ||
                                hasUnsavedChanges ||
                                (activeScore !== null && activeScore < 60)
                            }
                            title={
                                hasUnsavedChanges
                                    ? "Save your changes before publishing"
                                    : activeScore !== null && activeScore < 60
                                        ? "Improve citation readiness before publishing"
                                        : "Publish article"
                            }
                            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {isPublishing ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Publishing...</>
                            ) : (
                                <><CheckCircle2 className="h-3.5 w-3.5" />Publish</>
                            )}
                        </button>
                    </div>
                </footer>
            </div>

            {/* ── AI diff panel ── */}
            {showAiReview && aiContent && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-6"
                    onMouseDown={() => setShowAiReview(false)}
                >
                    <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="ai-review-title"
                        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-primary" />
                                    <h2 id="ai-review-title" className="text-sm font-semibold">
                                        Review AI improvements
                                    </h2>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">Nothing has been applied to your draft yet.</p>
                            </div>
                            <button
                                type="button"
                                onClick={rejectAiChanges}
                                aria-label="Close AI review"
                                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
                            <div className="overflow-y-auto border-r border-border">
                                <div className="border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Current draft
                                </div>
                                <div className="p-6">
                                    <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-muted-foreground">
                                        {editedContent}
                                    </pre>
                                </div>
                            </div>
                            <div className="overflow-y-auto">
                                <div className="border-b border-border bg-primary/5 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                                    AI proposal
                                </div>
                                <div className="p-6">
                                    <pre className="whitespace-pre-wrap font-sans text-sm leading-7">
                                        {aiContent}
                                    </pre>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-border bg-card px-5 py-4">
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <Info className="h-3.5 w-3.5" />
                                Review the proposed content before applying it.
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={rejectAiChanges}
                                    className="rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    onClick={acceptAiChanges}
                                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Apply changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
