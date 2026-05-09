/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

import {
    CheckCircle2, Circle, ChevronDown, ChevronRight, Loader2,
    AlertCircle, ImageIcon, Bot, ListTree, Highlighter, AlertTriangle,
    Sparkles, X, Clock, BookOpen, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { ContentScoreResult, OutlineHeading } from "@/lib/content-scoring";
import { sanitizeHtml } from "@/lib/sanitize-html";


function HighlightedContent({
    content,
    keyword,
}: {
    content: string;
    keyword: string;
}) {
    const highlighted = useMemo(() => {
        const safe = sanitizeHtml(content);
        if (!keyword.trim() || !safe.trim()) return safe;
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = safe.split(new RegExp(`(${escaped})`, "gi"));
        return parts.map((part, _i) =>
            part.toLowerCase() === keyword.toLowerCase()
                ? `<mark class="bg-emerald-400/20 text-emerald-300 rounded px-0.5">${part}</mark>`
                : part
        ).join("");
    }, [content, keyword]);

    return (
        <div
            className="h-full w-full overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground text-sm"
            dangerouslySetInnerHTML={{ __html: highlighted }}
        />
    );
}

function getAiColor(score: number) {
    if (score < 35) return { text: "text-emerald-400", bg: "bg-emerald-500", label: "Likely Human", hint: "Good sentence variation detected." };
    if (score < 65) return { text: "text-amber-400", bg: "bg-amber-500", label: "Mixed", hint: "Add more varied sentence lengths." };
    return { text: "text-red-400", bg: "bg-red-500", label: "Likely AI", hint: "Rewrite to vary sentence length & rhythm." };
}

function getScoreColor(score: number) {
    if (score >= 75) return "text-emerald-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
}

function getStrokeColor(score: number) {
    if (score >= 75) return "#34d399";
    if (score >= 50) return "#fbbf24";
    return "#f87171";
}

function getScoreLabel(score: number): { headline: string; sub: string } {
    if (score >= 85) return { headline: "Excellent", sub: "You're outpacing most competitors" };
    if (score >= 75) return { headline: "Great — almost there", sub: "A few tweaks away from excellent" };
    if (score >= 60) return { headline: "Good — keep going", sub: "Several improvements available" };
    if (score >= 40) return { headline: "Needs work", sub: "Check the opportunities below" };
    return { headline: "Early draft", sub: "Add content and a keyword to score" };
}



function ProgressBar({
    label,
    score,
    max = 20,
    detail,
}: {
    label: string;
    score: number;
    max?: number;
    detail?: string;
}) {
    const pct = Math.max(0, Math.min(100, (score / max) * 100));
    const fillClass =
        pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
    return (
        <div className="mb-3.5">
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                    {score}/{max}
                </span>
            </div>
            <div className="w-full bg-white/[0.06] rounded-full h-[4px] overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-700 ${fillClass}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {detail && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {detail}
                </p>
            )}
        </div>
    );
}



function OutlineBuilder({ suggestions }: { suggestions: OutlineHeading[] }) {
    if (!suggestions.length) return null;
    return (
        <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <ListTree className="w-3 h-3" />
                Suggested Outline
            </h4>
            <div className="space-y-1.5">
                {suggestions.map((s, i) => (
                    <div
                        key={i}
                        className={`flex items-start gap-2 p-2 rounded-lg border ${s.priority === "high"
                            ? "border-red-500/20 bg-red-500/[0.04]"
                            : "border-border/50 bg-white/[0.02]"
                            } ${s.level === "h3" ? "ml-4" : ""}`}
                    >
                        <span
                            className={`text-xs font-bold uppercase tracking-wider mt-0.5 shrink-0 ${s.priority === "high"
                                ? "text-red-400"
                                : s.level === "h2"
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                }`}
                        >
                            {s.level}
                        </span>
                        <span className="text-xs text-zinc-300 leading-relaxed flex-1">
                            {s.text}
                        </span>
                        {s.priority === "high" && (
                            <span className="ml-auto shrink-0 text-xs text-red-400 font-semibold uppercase tracking-wider">
                                Missing
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── panel section wrapper ────────────────────────────────────────────────────

function PanelSection({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`px-4 py-4 border-b border-border/60 last:border-b-0 ${className}`}>
            {children}
        </div>
    );
}

function SectionLabel({
    children,
    action,
}: {
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {children}
            </h4>
            {action}
        </div>
    );
}

// ─── main component ───────────────────────────────────────────────────────────

export function ContentEditor({
    initialContent = "",
    initialKeyword = "",
    blogId,
    onContentChange,
    onScoreChange,
}: {
    initialContent?: string;
    initialKeyword?: string;
    blogId?: string;
    onContentChange?: (content: string) => void;
    onScoreChange?: (score: ContentScoreResult | null) => void;
}) {
    // ── all state identical to original ──────────────────────────────────────
    const [content, setContent] = useState(initialContent);
    const [keyword, setKeyword] = useState(initialKeyword);
    const [scoreData, setScoreData] = useState<ContentScoreResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checkedOpps, setCheckedOpps] = useState<Record<string, boolean>>({});
    const [showCompetitors, setShowCompetitors] = useState(false);
    const [highlightMode, setHighlightMode] = useState(false);
    const [savedContent, setSavedContent] = useState(initialContent);

    const [isImproving, setIsImproving] = useState(false);
    const [showDiff, setShowDiff] = useState(false);
    const [improvedContent, setImprovedContent] = useState<string | null>(null);

    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    const isDirty = content !== savedContent;

    // ── all effects / handlers identical to original ──────────────────────────

    useEffect(() => {
        if (initialContent !== undefined && initialContent !== content) {
            setContent(initialContent);
            setSavedContent(initialContent);
        }
    }, [initialContent]);

    const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        }
    }, [isDirty]);

    useEffect(() => {
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [handleBeforeUnload]);

    const wordCount = content.trim().split(/\s+/).filter((w) => w.length > 0).length;

    // derived display values — no new state
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    const gradeLevel = scoreData?.subScores?.readability?.gradeLevel ?? null;

    // max word count across competitors for proportional bars
    const maxCompetitorWords = scoreData?.competitors?.length
        ? Math.max(...scoreData.competitors.map((c) => c.wordCount))
        : 1;

    useEffect(() => {
        if (onContentChange) onContentChange(content);
        if (!keyword.trim() || !content.trim()) return;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => fetchScore(content, keyword), 1500);
        return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
    }, [content, keyword, onContentChange]);

    const fetchScore = async (text: string, kw: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/content-score", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: text, targetKeyword: kw }),
            });
            if (!res.ok) {
                let message = "Failed to generate content score.";
                try {
                    const errBody = await res.json();
                    if (errBody?.error) message = errBody.error;
                } catch { /* ignore */ }
                if (res.status === 429) message = message || "Too many requests. Please wait before scoring again.";
                setError(message);
                return;
            }
            const result = await res.json();
            setScoreData(result);
            if (onScoreChange) onScoreChange(result);
        } catch {
            setError("Failed to generate content score. Check your connection.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleAIImprove = async () => {
        if (!blogId || !scoreData) return;
        setIsImproving(true);
        try {
            const issues = [
                ...(scoreData.topOpportunities ?? []),
                ...(scoreData.subScores.nlpTerms.missing.length
                    ? [`Add missing semantic terms: ${scoreData.subScores.nlpTerms.missing.join(", ")}`]
                    : []),
                ...(scoreData.subScores.headings.missing.length
                    ? [`Add missing headings: ${scoreData.subScores.headings.missing.join(", ")}`]
                    : []),
            ];
            const res = await fetch(`/api/blogs/${blogId}/improve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    issues,
                    scoreData: {
                        wordCount: scoreData.subScores.wordCount,
                        keywords: scoreData.subScores.exactKeywords,
                        readabilityGrade: scoreData.subScores.readability.gradeLevel,
                        missingTerms: scoreData.subScores.nlpTerms.missing,
                        missingHeadings: scoreData.subScores.headings.missing,
                    },
                }),
            });
            if (!res.ok) throw new Error("AI improve failed");
            const { content: improved } = await res.json();
            if (improved) {
                setImprovedContent(improved);
                setShowDiff(true);
            }
        } catch (err) {
            console.error(err);
            toast.error("AI improve failed. Please try again.");
        } finally {
            setIsImproving(false);
        }
    };

    const aiColour = scoreData ? getAiColor(scoreData.aiDetectionScore ?? 0) : getAiColor(0);
    const scoreLabel = scoreData ? getScoreLabel(scoreData.score) : getScoreLabel(0);

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 h-full min-h-[620px] text-foreground bg-card rounded-xl overflow-hidden border border-border">

            {/* ═══════════════════ Left: Editor ═══════════════════ */}
            <div className="lg:col-span-2 flex flex-col border-r border-border">

                {/* ── Toolbar ── */}
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 bg-muted/40 flex-wrap">

                    {/* Keyword input with live indicator */}
                    <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                            Target
                        </span>
                        <div className="relative flex-1">
                            {/* live dot — green when scoring, grey when idle */}
                            <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${keyword.trim() && content.trim()
                                ? "bg-emerald-400"
                                : "bg-zinc-600"
                                }`} />
                            <input
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                placeholder="keyword…"
                                className="w-full bg-card border border-border rounded-md pl-6 pr-2.5 py-[5px] text-xs text-foreground placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
                            />
                        </div>
                    </div>

                    {/* separator */}
                    <div className="w-px h-4 bg-border shrink-0" />

                    {/* Highlight toggle */}
                    <button
                        onClick={() => setHighlightMode(h => !h)}
                        title="Toggle keyword highlight"
                        className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-xs font-medium transition-colors border ${highlightMode
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "text-muted-foreground hover:text-foreground border-border"
                            }`}
                    >
                        <Highlighter className="w-3.5 h-3.5" />
                        Highlight
                    </button>

                    {/* AI Fix */}
                    {blogId && scoreData && (
                        <button
                            onClick={handleAIImprove}
                            disabled={isImproving}
                            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-xs font-medium transition-colors text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 disabled:opacity-50"
                        >
                            {isImproving
                                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Improving…</>
                                : <><Sparkles className="w-3.5 h-3.5" /> AI Fix · {scoreData.score}/100</>
                            }
                        </button>
                    )}

                    {/* Right-side status */}
                    <div className="ml-auto flex items-center gap-2.5">
                        {isDirty && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-medium">
                                <AlertTriangle className="w-3 h-3" />
                                Unsaved
                            </span>
                        )}
                        {isLoading && (
                            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                        )}
                    </div>
                </div>

                {/* ── Editor body ── */}
                <div className="flex-1 relative overflow-hidden">
                    {highlightMode && keyword.trim() ? (
                        <div className="h-full p-7 pb-4">
                            <HighlightedContent content={content} keyword={keyword} />
                            <p className="absolute bottom-12 left-7 text-xs text-muted-foreground italic">
                                Click Highlight again to edit
                            </p>
                        </div>
                    ) : (
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Start writing or paste your content here…"
                            className="w-full h-full min-h-[460px] bg-transparent resize-none outline-none text-foreground placeholder-zinc-600 text-[14px] leading-[1.85] px-7 pt-7 pb-4"
                        />
                    )}
                </div>

                {/* ── Status bar ── */}
                <div className="flex items-center gap-4 px-7 py-2.5 border-t border-border bg-muted/30 flex-wrap">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookOpen className="w-3 h-3" />
                        <strong className="text-foreground font-medium">{wordCount.toLocaleString()}</strong> words
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <strong className="text-foreground font-medium">{readingTime} min</strong> read
                    </span>
                    {gradeLevel !== null && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Activity className="w-3 h-3" />
                            Grade <strong className="text-foreground font-medium">{gradeLevel.toFixed(1)}</strong>
                        </span>
                    )}
                    {/* Keyword density — only when keyword + content both present */}
                    {keyword.trim() && wordCount > 0 && (() => {
                        const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const matches = content.match(new RegExp(escaped, "gi"))?.length ?? 0;
                        const density = wordCount > 0 ? (matches / wordCount) * 100 : 0;
                        const densityColor =
                            density < 0.5 ? "text-rose-400"
                                : density > 3 ? "text-amber-400"
                                    : "text-emerald-400";
                        const densityHint =
                            density < 0.5 ? "Low — add more uses"
                                : density > 3 ? "High — possible stuffing"
                                    : "Good density";
                        return (
                            <span
                                className={`flex items-center gap-1.5 text-xs ${densityColor}`}
                                title={densityHint}
                            >
                                <span className="font-mono font-medium">{density.toFixed(1)}%</span>
                                <span className="text-muted-foreground">density</span>
                            </span>
                        );
                    })()}
                    {keyword.trim() && content.trim() && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Live scoring
                        </span>
                    )}
                </div>
            </div>

            {/* ═══════════════════ Right: Score panel ═══════════════════ */}
            <div className="bg-muted/10 overflow-y-auto flex flex-col divide-y divide-border/60">

                {/* ── Score gauge ── */}
                <PanelSection>
                    <SectionLabel>Content Score</SectionLabel>
                    <div className="flex items-center gap-3.5">
                        {/* Gauge */}
                        <div className="relative w-[76px] h-[76px] shrink-0">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                                <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                                <circle
                                    cx="40" cy="40" r="30" fill="none"
                                    stroke={scoreData ? getStrokeColor(scoreData.score) : "rgba(255,255,255,0.06)"}
                                    strokeWidth="7"
                                    strokeDasharray="188.5"
                                    strokeDashoffset={
                                        scoreData
                                            ? 188.5 - (188.5 * scoreData.score) / 100
                                            : 188.5
                                    }
                                    strokeLinecap="round"
                                    className="transition-all duration-1000 ease-out"
                                />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className={`text-[22px] font-semibold leading-none ${scoreData ? getScoreColor(scoreData.score) : "text-muted-foreground"}`}>
                                    {scoreData?.score ?? 0}
                                </span>
                                <span className="text-xs text-muted-foreground uppercase tracking-widest mt-0.5">/100</span>
                            </div>
                        </div>

                        {/* Score label */}
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-foreground leading-tight">
                                {scoreLabel.headline}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                                {scoreLabel.sub}
                            </p>
                            {scoreData && (
                                <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                    {scoreData.score >= 75 ? "Above avg" : scoreData.score >= 50 ? "Average" : "Below avg"}
                                </span>
                            )}
                        </div>
                    </div>
                </PanelSection>

                {/* ── AI Detection ── */}
                <PanelSection>
                    <div className="bg-white/[0.03] border border-border/60 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-md bg-purple-500/10 flex items-center justify-center shrink-0">
                                <Bot className="w-3.5 h-3.5 text-purple-400" />
                            </div>
                            <span className="text-xs font-medium text-foreground">AI Detection</span>
                            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border ${(scoreData?.aiDetectionScore ?? 0) < 35
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : (scoreData?.aiDetectionScore ?? 0) < 65
                                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                    : "bg-red-500/10 border-red-500/20 text-red-400"
                                }`}>
                                {aiColour.label}
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-2">
                            <div
                                className={`h-full rounded-full transition-all duration-700 ${aiColour.bg}`}
                                style={{ width: `${scoreData?.aiDetectionScore ?? 0}%` }}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {scoreData
                                ? `${scoreData.aiDetectionScore}% AI-like — ${aiColour.hint}`
                                : "Run analysis to check."}
                        </p>
                    </div>
                </PanelSection>

                {/* ── Error ── */}
                {error && (
                    <PanelSection>
                        <div className="flex items-start gap-2 p-3 bg-red-900/15 border border-red-500/20 rounded-lg">
                            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
                        </div>
                    </PanelSection>
                )}

                {/* ── Sub-scores breakdown ── */}
                <PanelSection>
                    <SectionLabel>Breakdown</SectionLabel>
                    <ProgressBar
                        label="Word Count"
                        score={scoreData?.subScores?.wordCount?.score ?? 0}
                        detail={scoreData ? `${scoreData.subScores.wordCount.current} words · target ${scoreData.subScores.wordCount.targetMin}–${scoreData.subScores.wordCount.targetMax}` : undefined}
                    />
                    <ProgressBar
                        label="Keywords"
                        score={scoreData?.subScores?.exactKeywords?.score ?? 0}
                        detail={scoreData ? `${scoreData.subScores.exactKeywords.current} uses · target ~${scoreData.subScores.exactKeywords.targetMin}` : undefined}
                    />
                    <ProgressBar
                        label="NLP Terms"
                        score={scoreData?.subScores?.nlpTerms?.score ?? 0}
                        detail={scoreData ? `${scoreData.subScores.nlpTerms.covered.length} of ${scoreData.subScores.nlpTerms.covered.length + scoreData.subScores.nlpTerms.missing.length} entities covered` : undefined}
                    />
                    <ProgressBar
                        label="Headings"
                        score={scoreData?.subScores?.headings?.score ?? 0}
                        detail={scoreData?.subScores?.headings?.missing?.[0] ? `Missing: "${scoreData.subScores.headings.missing[0]}"` : undefined}
                    />
                    <ProgressBar
                        label="Readability"
                        score={scoreData?.subScores?.readability?.score ?? 0}
                        detail={scoreData ? `Grade level ${scoreData.subScores.readability.gradeLevel.toFixed(1)} · target 8–10` : undefined}
                    />
                </PanelSection>

                {/* ── Semantic gap terms ── */}
                {scoreData?.tfIdf?.underUsed && scoreData.tfIdf.underUsed.length > 0 && (
                    <PanelSection>
                        <SectionLabel
                            action={
                                <button
                                    onClick={() => {
                                        const terms = scoreData.tfIdf!.underUsed.map(t => t.term).join(", ");
                                        navigator.clipboard.writeText(terms);
                                        toast.success("Copied to clipboard");
                                    }}
                                    className="text-xs text-emerald-400 hover:text-emerald-300 font-medium uppercase tracking-wider"
                                >
                                    Copy all
                                </button>
                            }
                        >
                            Missing Semantic Terms
                        </SectionLabel>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {scoreData.tfIdf.underUsed.slice(0, 12).map((t, i) => {
                                // terms with large gap get a red treatment, smaller gap amber
                                const gap = t.avgTf - t.yourTf;
                                const isHighPriority = gap > 0.003;
                                return (
                                    <span
                                        key={i}
                                        title={`Competitors use this ${(t.avgTf * 100).toFixed(1)}% of words — you use it ${(t.yourTf * 100).toFixed(1)}%`}
                                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-help border ${isHighPriority
                                            ? "bg-red-500/8 border-red-500/20 text-red-300"
                                            : "bg-amber-500/8 border-amber-500/18 text-amber-300"
                                            }`}
                                    >
                                        <span className="w-1 h-1 rounded-full bg-current opacity-60 shrink-0" />
                                        {t.term}
                                    </span>
                                );
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            <span className="text-red-400">Red</span> = high-priority gap ·{" "}
                            <span className="text-amber-400">Amber</span> = underused. Weave these into your draft.
                        </p>
                    </PanelSection>
                )}

                {/* ── Image recommendation ── */}
                {scoreData?.imageRecommendation && (
                    <PanelSection>
                        <div className="flex items-start gap-2.5 p-3 bg-white/[0.03] border border-border/60 rounded-lg">
                            <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-xs font-medium text-foreground">Images</span>
                                    <span className="text-xs font-semibold text-foreground tabular-nums">
                                        {scoreData.imageRecommendation.current} / {scoreData.imageRecommendation.targetMin}–{scoreData.imageRecommendation.targetMax}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {scoreData.imageRecommendation.suggestion}
                                </p>
                            </div>
                        </div>
                    </PanelSection>
                )}

                {/* ── Top opportunities ── */}
                {scoreData && scoreData.topOpportunities.length > 0 && (
                    <PanelSection>
                        <SectionLabel>Top Opportunities</SectionLabel>
                        <ul className="space-y-0.5">
                            {scoreData.topOpportunities.map((opp, i) => (
                                <li
                                    key={i}
                                    onClick={() => setCheckedOpps(p => ({ ...p, [opp]: !p[opp] }))}
                                    className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors"
                                >
                                    <button className="shrink-0 mt-0.5" tabIndex={-1}>
                                        {checkedOpps[opp] ? (
                                            <CheckCircle2 className="w-[15px] h-[15px] text-emerald-400" />
                                        ) : (
                                            <Circle className="w-[15px] h-[15px] text-muted-foreground/60 hover:text-emerald-400 transition-colors" />
                                        )}
                                    </button>
                                    <span className={`text-xs leading-relaxed ${checkedOpps[opp] ? "text-muted-foreground line-through" : "text-foreground"
                                        }`}>
                                        {opp}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </PanelSection>
                )}

                {/* ── Outline builder ── */}
                {scoreData && scoreData.outlineSuggestions && scoreData.outlineSuggestions.length > 0 && (
                    <PanelSection>
                        <OutlineBuilder suggestions={scoreData.outlineSuggestions} />
                    </PanelSection>
                )}

                {/* ── Competitor benchmarks ── */}
                {scoreData && scoreData.competitors.length > 0 && (
                    <PanelSection>
                        <button
                            onClick={() => setShowCompetitors(s => !s)}
                            className="w-full flex items-center justify-between mb-0.5 group"
                        >
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
                                Competitor Benchmarks
                            </span>
                            {showCompetitors
                                ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            }
                        </button>
                        {showCompetitors && (
                            <ul className="mt-2 space-y-2">
                                {scoreData.competitors.map((c, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                        <span
                                            className="text-xs text-muted-foreground truncate w-[110px] shrink-0"
                                            title={c.url}
                                        >
                                            {c.url.replace(/^https?:\/\/(www\.)?/, "")}
                                        </span>
                                        {/* proportional mini-bar */}
                                        <div className="flex-1 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500/50 rounded-full"
                                                style={{ width: `${(c.wordCount / maxCompetitorWords) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-medium text-emerald-400 tabular-nums shrink-0">
                                            {c.wordCount.toLocaleString()} w
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </PanelSection>
                )}

                {/* ── Empty state ── */}
                {!scoreData && !isLoading && (
                    <PanelSection>
                        <p className="text-xs text-muted-foreground text-center py-8 leading-relaxed">
                            Type a keyword and write content to begin live scoring against real SERP competitors.
                        </p>
                    </PanelSection>
                )}
            </div>

            {/* ═══════════════════ AI Improve Diff Modal ═══════════════════ */}
            {/* Identical logic, slightly tightened styling */}
            {showDiff && improvedContent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
                    <div className="w-full max-w-2xl bg-background border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <div>
                                <h3 className="font-semibold text-foreground">AI Improved Version</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Review the changes below before applying.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowDiff(false)}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <textarea
                                value={improvedContent}
                                onChange={(e) => setImprovedContent(e.target.value)}
                                className="w-full h-64 bg-muted/30 border border-border rounded-lg p-3 text-xs text-foreground font-mono resize-none focus:outline-none focus:border-emerald-500/60 transition-colors"
                            />
                        </div>
                        <div className="px-5 py-3 border-t border-border flex justify-end gap-3">
                            <button
                                onClick={() => setShowDiff(false)}
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Discard
                            </button>
                            <button
                                onClick={() => {
                                    setContent(improvedContent);
                                    setShowDiff(false);
                                    setImprovedContent(null);
                                }}
                                className="px-5 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl transition-colors"
                            >
                                Apply Improvements
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}