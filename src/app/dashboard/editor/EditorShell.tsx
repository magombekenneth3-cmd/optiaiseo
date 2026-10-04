"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ContentEditor } from "@/app/dashboard/blogs/ContentEditor";
import { InlineGapAnnotator } from "./InlineGapAnnotator";
import { applyGapFix, type GapAnalysisResponse, type IdentifiedGap } from "@/lib/editor/gap-types";
import { Save, Trash2, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface EditorShellProps {
    initialKeyword?: string;
}

export function EditorShell({ initialKeyword = "" }: EditorShellProps) {
    const [draftContent, setDraftContent] = useState("");
    const [draftKeyword, setDraftKeyword] = useState(initialKeyword);
    const [hasRestored, setHasRestored] = useState(false);
    const [editorKey, setEditorKey] = useState(0);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysis, setAnalysis] = useState<GapAnalysisResponse | null>(null);

    const handleClear = useCallback(() => {
        setDraftContent("");
        setDraftKeyword("");
        setAnalysis(null);
        setEditorKey((k) => k + 1);
        localStorage.removeItem("optiaiseo:editor-draft-content");
        localStorage.removeItem("optiaiseo:editor-draft-keyword");
        toast.success("Draft cleared.");
    }, []);

    const handleSaveLocal = useCallback(() => {
        localStorage.setItem("optiaiseo:editor-draft-content", draftContent);
        localStorage.setItem("optiaiseo:editor-draft-keyword", draftKeyword);
        toast.success("Draft saved manually to browser cache.");
    }, [draftContent, draftKeyword]);

    const handleAnalyze = useCallback(async () => {
        if (draftContent.trim().length < 50) {
            toast.error("Add at least a few sentences before analyzing.");
            return;
        }
        setIsAnalyzing(true);
        try {
            const res = await fetch("/api/editor/analyze-gaps", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: draftContent, targetKeyword: draftKeyword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Analysis failed.");
            setAnalysis(data as GapAnalysisResponse);
            if (!data.gaps?.length) toast.success("No major gaps found — nice draft.");
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setIsAnalyzing(false);
        }
    }, [draftContent, draftKeyword]);

    const removeGap = (id: string) =>
        setAnalysis((a) => (a ? { ...a, gaps: a.gaps.filter((g) => g.id !== id) } : a));

    const handleApply = (gap: IdentifiedGap) => {
        setDraftContent((c) => applyGapFix(c, gap));
        removeGap(gap.id);
    };

    const handleApplyAll = () => {
        if (!analysis) return;
        setDraftContent((c) => analysis.gaps.reduce(applyGapFix, c));
        setAnalysis({ ...analysis, gaps: [] });
        toast.success("All suggestions applied.");
    };

    const closeReview = () => {
        setAnalysis(null);
        setEditorKey((k) => k + 1); // remount editor with the updated draft
    };

    useEffect(() => {
        const savedContent = localStorage.getItem("optiaiseo:editor-draft-content");
        const savedKeyword = localStorage.getItem("optiaiseo:editor-draft-keyword");
        if (savedContent && savedContent.trim()) {
            setDraftContent(savedContent);
            if (savedKeyword) setDraftKeyword(savedKeyword);
            toast.info("Restored your unsaved draft from local storage.", {
                duration: 4000,
                action: { label: "Clear", onClick: () => handleClear() },
            });
        } else if (initialKeyword) {
            setDraftKeyword(initialKeyword);
        }
        setHasRestored(true);
    }, [initialKeyword, handleClear]);

    useEffect(() => {
        if (!hasRestored) return;
        const t = setTimeout(() => {
            localStorage.setItem("optiaiseo:editor-draft-content", draftContent);
            localStorage.setItem("optiaiseo:editor-draft-keyword", draftKeyword);
        }, 1000);
        return () => clearTimeout(t);
    }, [draftContent, draftKeyword, hasRestored]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                handleSaveLocal();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [handleSaveLocal]);

    if (!hasRestored) {
        return (
            <div className="flex items-center justify-center h-[500px] border border-border rounded-xl bg-card">
                <span className="text-sm text-muted-foreground">Loading workspace...</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex justify-between items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">
                    {analysis ? "Reviewing AI suggestions — click an underlined sentence" : "Draft automatically saved to local storage"}
                </span>
                <div className="flex items-center gap-2">
                    {!analysis && (
                        <button
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                            title="Find SEO and readability gaps with AI"
                        >
                            {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {isAnalyzing ? "Analyzing…" : "Analyze draft"}
                        </button>
                    )}
                    <button
                        onClick={handleSaveLocal}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50 text-xs font-semibold transition-colors"
                        title="Force Save to Browser Cache (⌘S)"
                    >
                        <Save className="w-3.5 h-3.5" />
                        Save Draft
                    </button>
                    <button
                        onClick={handleClear}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] text-red-400 hover:bg-red-500/[0.08] text-xs font-semibold transition-colors"
                        title="Clear Editor Content"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-[620px]">
                {analysis ? (
                    <InlineGapAnnotator
                        content={draftContent}
                        gaps={analysis.gaps}
                        seoScore={analysis.seoScore}
                        readabilityScore={analysis.readabilityScore}
                        summary={analysis.overallSummary}
                        onApply={handleApply}
                        onDismiss={removeGap}
                        onApplyAll={handleApplyAll}
                        onClose={closeReview}
                    />
                ) : (
                    <ContentEditor
                        key={editorKey}
                        initialContent={draftContent}
                        initialKeyword={draftKeyword}
                        onContentChange={(val) => setDraftContent(val)}
                    />
                )}
            </div>
        </div>
    );
}
