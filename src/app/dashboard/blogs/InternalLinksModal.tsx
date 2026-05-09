"use client";

import { useState } from "react";
import { generateInternalLinkingSuggestions, type InternalLinkSuggestion } from "@/app/actions/internalLinking";
import { Link, Zap, Copy, ExternalLink, X } from "lucide-react";


export function InternalLinksModal({ blog, onClose }: { blog: any; onClose: () => void }) {
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<InternalLinkSuggestion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);

        try {
            const res = await generateInternalLinkingSuggestions(blog.siteId, blog.id);
            if (res.success) {
                setSuggestions(res.suggestions);
            } else {
                setError(res.error || "Failed to generate suggestions.");
            }
        } catch {
            setError("A network error occurred.");
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200">
            <div className="bg-[#121214] border border-border shadow-2xl rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-[#121214]/90 backdrop-blur-md z-10">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                            <Link className="h-5 w-5 text-emerald-400" />
                            Semantic Topic Cluster Engine
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1 max-w-xl truncate">
                            Generating internal links for: <span className="text-foreground font-medium">{blog.title}</span>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted-foreground hover:text-white hover:bg-muted rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    {!suggestions && !loading && !error && (
                        <div className="py-12 text-center flex flex-col items-center">
                            <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500/20 to-blue-500/20 rounded-full flex items-center justify-center mb-6 ring-1 ring-white/10 shadow-xl">
                                <Zap className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-2">Build Semantic Context</h3>
                            <p className="text-muted-foreground max-w-md text-sm leading-relaxed mb-8">
                                AI algorithms rank pages higher when they belong to strong internal topic clusters. We will scan your site&apos;s existing pages and generate exact paragraphs you can insert to link back to this new blog post.
                            </p>
                            <button
                                onClick={handleGenerate}
                                className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:opacity-90 transition-opacity text-black font-bold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                            >
                                Generate Link Suggestions
                            </button>
                        </div>
                    )}

                    {loading && (
                        <div className="py-16 flex flex-col items-center justify-center gap-4">
                            <div className="w-10 h-10 border-4 border-border border-t-emerald-400 rounded-full animate-spin"></div>
                            <p className="text-muted-foreground font-medium animate-pulse">Scanning existing pages and mapping context...</p>
                        </div>
                    )}

                    {error && (
                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-start gap-3">
                            <span>❌</span>
                            <p>{error}</p>
                        </div>
                    )}

                    {suggestions && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-border pb-4">
                                <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                                    {suggestions.length} Link Opportunities Found
                                </p>
                            </div>

                            <div className="grid gap-4">
                                {suggestions.map((s, i) => (
                                    <div key={i} className="bg-card border border-border rounded-xl p-5 hover:border-white/20 transition-all group">
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground mb-1">Source Page to Edit:</p>
                                                <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                                    {s.sourceUrl} <ExternalLink className="w-3 h-3 opacity-50" />
                                                </a>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-medium text-muted-foreground mb-1">Target Anchor Text:</p>
                                                <span className="inline-block px-2 py-1 bg-muted rounded text-xs font-mono text-zinc-300">
                                                    {s.suggestedAnchorText}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <p className="text-xs font-medium text-muted-foreground mb-2">Paragraph to Insert:</p>
                                            <div className="bg-card rounded-lg p-4 font-mono text-xs text-zinc-300 leading-relaxed border border-black/50 shadow-inner break-words whitespace-pre-wrap">
                                                {s.suggestedParagraphContext}
                                            </div>

                                            <button
                                                onClick={() => handleCopy(s.suggestedParagraphContext, i)}
                                                className="absolute top-8 right-2 p-2 rounded-md bg-white/10 hover:bg-white/20 text-white shadow-lg backdrop-blur-md transition-all border border-border group-hover:opacity-100 sm:opacity-0 focus:opacity-100 flex items-center gap-1.5"
                                                title="Copy Paragraph"
                                            >
                                                {copiedIndex === i ? (
                                                    <span className="text-emerald-400 font-bold text-xs px-1">Copied!</span>
                                                ) : (
                                                    <><Copy className="w-3.5 h-3.5" /> <span className="sr-only sm:not-sr-only text-xs font-medium pr-1">Copy</span></>
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
