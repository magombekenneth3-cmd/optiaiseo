"use client";

import React, { useMemo, useState } from "react";
import { Check, X, Search, BookOpen, CheckCheck, ArrowLeft } from "lucide-react";
import type { IdentifiedGap } from "@/lib/editor/gap-types";

interface Props {
    content: string;
    gaps: IdentifiedGap[];
    seoScore: number;
    readabilityScore: number;
    summary: string;
    onApply: (gap: IdentifiedGap) => void;
    onDismiss: (id: string) => void;
    onApplyAll: () => void;
    onClose: () => void;
}

export function InlineGapAnnotator({ content, gaps, seoScore, readabilityScore, summary, onApply, onDismiss, onApplyAll, onClose }: Props) {
    const [openId, setOpenId] = useState<string | null>(null);

    const segments = useMemo(() => {
        const found = gaps
            .map((gap) => ({ gap, index: content.indexOf(gap.originalSnippet) }))
            .filter((x) => x.index !== -1)
            .sort((a, b) => a.index - b.index);
        const segs: { text: string; gap: IdentifiedGap | null }[] = [];
        let cursor = 0;
        for (const { gap, index } of found) {
            if (index < cursor) continue;
            if (index > cursor) segs.push({ text: content.slice(cursor, index), gap: null });
            segs.push({ text: gap.originalSnippet, gap });
            cursor = index + gap.originalSnippet.length;
        }
        if (cursor < content.length) segs.push({ text: content.slice(cursor), gap: null });
        return segs;
    }, [content, gaps]);

    const tone = (n: number) => (n >= 75 ? "text-emerald-400" : n >= 50 ? "text-amber-400" : "text-red-400");

    return (
        <div className="flex h-full min-h-[620px] flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>SEO <strong className={tone(seoScore)}>{seoScore}</strong></span>
                    <span>Readability <strong className={tone(readabilityScore)}>{readabilityScore}</strong></span>
                    <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-rose-400" /> SEO
                        <span className="ml-2 h-2 w-2 rounded-full bg-amber-400" /> Readability
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {gaps.length > 0 && (
                        <button type="button" onClick={onApplyAll} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20">
                            <CheckCheck className="h-3.5 w-3.5" /> Accept all ({gaps.length})
                        </button>
                    )}
                    <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" /> Back to editing
                    </button>
                </div>
            </div>

            {summary && <p className="border-b border-border px-6 py-3 text-xs leading-relaxed text-muted-foreground">{summary}</p>}

            <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-7 py-6 text-[14px] leading-[1.85] text-foreground">
                {segments.map((seg, i) => {
                    if (!seg.gap) return <span key={i}>{seg.text}</span>;
                    const g = seg.gap;
                    const isSeo = g.type === "seo";
                    const open = openId === g.id;
                    return (
                        <span key={i} className="relative">
                            <mark
                                role="button"
                                tabIndex={0}
                                onClick={() => setOpenId(open ? null : g.id)}
                                onKeyDown={(e) => e.key === "Enter" && setOpenId(open ? null : g.id)}
                                className={`cursor-pointer rounded bg-transparent text-foreground underline decoration-2 underline-offset-4 ${isSeo ? "decoration-rose-400 hover:bg-rose-500/10" : "decoration-amber-400 hover:bg-amber-500/10"} ${open ? (isSeo ? "bg-rose-500/15" : "bg-amber-500/15") : ""}`}
                            >
                                {seg.text}
                            </mark>
                            {open && (
                                <span className="absolute left-0 top-full z-30 mt-2 block w-[min(420px,80vw)] whitespace-normal rounded-xl border border-border bg-background p-4 text-xs shadow-2xl">
                                    <span className="mb-2 flex items-center gap-1.5">
                                        {isSeo ? <Search className="h-3 w-3 text-rose-400" /> : <BookOpen className="h-3 w-3 text-amber-400" />}
                                        <span className={`font-semibold uppercase tracking-wider ${isSeo ? "text-rose-400" : "text-amber-400"}`}>{g.category}</span>
                                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{g.severity}</span>
                                    </span>
                                    <span className="block text-sm font-semibold text-foreground">{g.title}</span>
                                    <span className="mt-1 block leading-relaxed text-muted-foreground">{g.explanation}</span>
                                    <span className="mt-3 block rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 leading-relaxed text-emerald-300">{g.suggestedReplacement}</span>
                                    {g.impact && <span className="mt-2 block text-muted-foreground">Impact: {g.impact}</span>}
                                    <span className="mt-3 flex gap-2">
                                        <button type="button" onClick={() => { onApply(g); setOpenId(null); }} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 font-semibold text-black hover:bg-emerald-400">
                                            <Check className="h-3.5 w-3.5" /> Accept fix
                                        </button>
                                        <button type="button" onClick={() => { onDismiss(g.id); setOpenId(null); }} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
                                            <X className="h-3.5 w-3.5" /> Dismiss
                                        </button>
                                    </span>
                                </span>
                            )}
                        </span>
                    );
                })}
                {gaps.length === 0 && (
                    <p className="mt-6 block rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-center text-xs text-emerald-400">
                        All suggestions handled. Go back to editing or run the analysis again.
                    </p>
                )}
            </div>
        </div>
    );
}
