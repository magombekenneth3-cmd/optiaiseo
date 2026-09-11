"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    generateInternalLinkingSuggestions,
    type InternalLinkSuggestion,
} from "@/app/actions/internalLinking";
import { AlertTriangle, Copy, Check, ExternalLink, Link, X, Zap } from "lucide-react";

interface Blog {
    id:      string;
    siteId?: string;
    title?:  string;
}

export function InternalLinksModal({
    blog,
    onClose,
}: {
    blog:    Blog;
    onClose: () => void;
}) {
    const [loading, setSuggestions_loading]   = useState(false);
    const [suggestions, setSuggestions]       = useState<InternalLinkSuggestion[] | null>(null);
    const [error, setError]                   = useState<string | null>(null);
    const [copiedIndex, setCopiedIndex]       = useState<number | null>(null);
    const copyTimerRef                        = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Escape key and cleanup
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => {
            document.removeEventListener("keydown", handler);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        };
    }, [onClose]);

    const handleGenerate = useCallback(async () => {
        setSuggestions_loading(true);
        setError(null);
        try {
            if (!blog.siteId) {
                setError("Site ID is missing — cannot generate suggestions.");
                return;
            }
            const res = await generateInternalLinkingSuggestions(blog.siteId, blog.id);
            if (res.success) {
                setSuggestions(res.suggestions);
            } else {
                setError(res.error || "Failed to generate suggestions.");
            }
        } catch {
            setError("A network error occurred.");
        } finally {
            setSuggestions_loading(false);
        }
    }, [blog.siteId, blog.id]);

    const handleCopy = useCallback(async (text: string, index: number) => {
        try {
            await navigator.clipboard.writeText(text);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            setCopiedIndex(index);
            copyTimerRef.current = setTimeout(() => setCopiedIndex(null), 2000);
        } catch {
            // Clipboard API unavailable — silently ignore
        }
    }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
            onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="absolute inset-0 bg-black/80" aria-hidden="true" />

            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="internal-links-title"
                className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
            >
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-6 py-4 backdrop-blur-md">
                    <div className="min-w-0">
                        <h2
                            id="internal-links-title"
                            className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground"
                        >
                            <Link className="h-5 w-5 text-emerald-400" />
                            Semantic Topic Cluster Engine
                        </h2>
                        <p className="mt-1 max-w-xl truncate text-sm text-muted-foreground">
                            Generating internal links for:{" "}
                            <span className="font-medium text-foreground">{blog.title ?? "Untitled"}</span>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="-mr-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Idle state */}
                    {!suggestions && !loading && !error && (
                        <div className="flex flex-col items-center py-12 text-center">
                            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500/20 to-blue-500/20 ring-1 ring-white/10 shadow-xl">
                                <Zap className="h-8 w-8 text-emerald-400" />
                            </div>
                            <h3 className="mb-2 text-lg font-semibold text-foreground">Build Semantic Context</h3>
                            <p className="mb-8 max-w-md text-sm leading-relaxed text-muted-foreground">
                                AI algorithms rank pages higher when they belong to strong internal topic clusters.
                                We will scan your site&apos;s existing pages and generate exact paragraphs you can insert
                                to link back to this new blog post.
                            </p>
                            <button
                                type="button"
                                onClick={handleGenerate}
                                className="rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-6 py-3 font-bold text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-opacity hover:opacity-90"
                            >
                                Generate Link Suggestions
                            </button>
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center gap-4 py-16">
                            <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-emerald-400" />
                            <p className="animate-pulse font-medium text-muted-foreground">
                                Scanning existing pages and mapping context...
                            </p>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    {/* Results */}
                    {suggestions && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-border pb-4">
                                <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                                    {suggestions.length} Link Opportunit{suggestions.length === 1 ? "y" : "ies"} Found
                                </p>
                            </div>

                            <div className="grid gap-4">
                                {suggestions.map((s, i) => (
                                    <div
                                        key={s.sourceUrl}
                                        className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-white/20"
                                    >
                                        <div className="mb-4 flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="mb-1 text-xs font-medium text-muted-foreground">
                                                    Source Page to Edit:
                                                </p>
                                                <a
                                                    href={s.sourceUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex items-center gap-1 text-sm font-semibold text-blue-400 hover:text-blue-300"
                                                >
                                                    <span className="truncate">{s.sourceUrl}</span>
                                                    <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                                                </a>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="mb-1 text-xs font-medium text-muted-foreground">
                                                    Target Anchor Text:
                                                </p>
                                                <span className="inline-block rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                                                    {s.suggestedAnchorText}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <p className="mb-2 text-xs font-medium text-muted-foreground">
                                                Paragraph to Insert:
                                            </p>
                                            <div className="break-words whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground shadow-inner">
                                                {s.suggestedParagraphContext}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(s.suggestedParagraphContext, i)}
                                                aria-label="Copy paragraph"
                                                title="Copy Paragraph"
                                                className="absolute right-2 top-8 flex items-center gap-1.5 rounded-md border border-border bg-background/80 p-2 text-foreground shadow-lg backdrop-blur-md transition-all focus:opacity-100 group-hover:opacity-100 sm:opacity-0"
                                            >
                                                {copiedIndex === i ? (
                                                    <>
                                                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                        <span className="text-xs font-bold text-emerald-400">Copied!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="h-3.5 w-3.5" />
                                                        <span className="sr-only text-xs font-medium sm:not-sr-only">Copy</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
