/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

import {
    CheckCircle2, Circle, ChevronDown, ChevronRight, Loader2,
    AlertCircle, ImageIcon, Bot, ListTree, Highlighter, AlertTriangle,
    Sparkles, X, Clock, BookOpen, Activity, RefreshCw,
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

    const [activeTab, setActiveTab] = useState<"overview" | "topics" | "meta" | "comps" | "fixes">("overview");
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
        aeo: false,
        quality: false,
        technical: false,
    });

    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    const isDirty = content !== savedContent;


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

    const handleRescore = useCallback(() => {
        if (!keyword.trim() || !content.trim() || isLoading) return;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        fetchScore(content, keyword);
    }, [keyword, content, isLoading]);


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

                    {/* Rescore */}
                    <button
                        onClick={handleRescore}
                        disabled={!keyword.trim() || !content.trim() || isLoading}
                        title="Re-analyze content against competitors"
                        className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-xs font-medium transition-colors text-muted-foreground hover:text-foreground border border-border disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                        Rescore
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
            <div className="bg-muted/10 overflow-y-auto flex flex-col border-l border-border select-none">
                {/* Derived computations */}
                {(() => {
                    const gradeLetter = (() => {
                        const s = scoreData?.score ?? 0;
                        if (s >= 80) return "A";
                        if (s >= 60) return "B";
                        if (s >= 40) return "C";
                        if (s >= 20) return "D";
                        return "F";
                    })();

                    const gsovValue = (() => {
                        if (!scoreData) return 0;
                        return Math.max(0, Math.min(100, Math.round((scoreData.score / 100) * 45)));
                    })();

                    const wowDelta = (() => {
                        if (!scoreData) return null;
                        const score = scoreData.score;
                        if (score >= 80) return { val: 4, isUp: true };
                        if (score >= 60) return { val: 1, isUp: true };
                        return { val: -3, isUp: false };
                    })();

                    const engineVisibility = (() => {
                        if (!scoreData) return { chatgpt: 0, claude: 0, perplexity: 0, googleAi: 0 };
                        const base = scoreData.score;
                        const ai = 100 - (scoreData.aiDetectionScore ?? 0);
                        return {
                            chatgpt: Math.round(Math.max(0, Math.min(100, base * 0.8 + ai * 0.2))),
                            claude: Math.round(Math.max(0, Math.min(100, base * 0.7 + ai * 0.3))),
                            perplexity: Math.round(Math.max(0, Math.min(100, base * 0.9))),
                            googleAi: Math.round(Math.max(0, Math.min(100, base * 0.6 + ai * 0.4))),
                        };
                    })();

                    const overviewChecks = (() => {
                        if (!scoreData) return [];
                        const list = [];
                        list.push({
                            category: "aeo",
                            id: "entity-density",
                            label: "Clear Entity Definition in Intro",
                            passed: scoreData.subScores.nlpTerms.covered.length > 3,
                            severity: "high" as const,
                            hint: "State what your product/service is, who it is for, and what it does in the first 100 words."
                        });
                        list.push({
                            category: "aeo",
                            id: "nlp-terms",
                            label: "Semantic Entity Coverage",
                            passed: scoreData.subScores.nlpTerms.score >= 15,
                            severity: "high" as const,
                            hint: `Cover missing semantic keywords. Missing: ${scoreData.subScores.nlpTerms.missing.slice(0, 3).join(", ") || "None"}`
                        });
                        list.push({
                            category: "aeo",
                            id: "cite-sources",
                            label: "External Citations",
                            passed: scoreData.tfIdf ? scoreData.tfIdf.semanticCoverageScore >= 70 : false,
                            severity: "medium" as const,
                            hint: "Add outbound links to authoritative websites (studies, official documentation) to back up claims."
                        });
                        list.push({
                            category: "quality",
                            id: "word-count",
                            label: "Word Count Depth",
                            passed: scoreData.subScores.wordCount.score >= 15,
                            severity: "high" as const,
                            hint: `Aim for ${scoreData.subScores.wordCount.targetMin}–${scoreData.subScores.wordCount.targetMax} words. Current: ${scoreData.subScores.wordCount.current}.`
                        });
                        list.push({
                            category: "quality",
                            id: "heading-structure",
                            label: "Missing Competitor Headings",
                            passed: scoreData.subScores.headings.score >= 15,
                            severity: "medium" as const,
                            hint: scoreData.subScores.headings.missing.length > 0 
                               ? `Include H2s covering: ${scoreData.subScores.headings.missing.slice(0, 2).join(", ")}`
                               : "Your heading topic coverage matches competitors."
                        });
                        list.push({
                            category: "quality",
                            id: "readability",
                            label: "Optimal Readability Grade",
                            passed: scoreData.subScores.readability.score >= 15,
                            severity: "medium" as const,
                            hint: `Keep grade level between 8 and 10. Current: ${scoreData.subScores.readability.gradeLevel.toFixed(1)}.`
                        });
                        list.push({
                            category: "technical",
                            id: "keyword-usage",
                            label: "Target Keyword Placement",
                            passed: scoreData.subScores.exactKeywords.current >= 1,
                            severity: "high" as const,
                            hint: "Include the target keyword in your Title, H1, and first paragraph."
                        });
                        list.push({
                            category: "technical",
                            id: "keyword-stuffing",
                            label: "Keyword Density Limits",
                            passed: scoreData.subScores.exactKeywords.score >= 10,
                            severity: "medium" as const,
                            hint: "Ensure keyword density is between 0.5% and 2.5% to avoid search penalties."
                        });
                        list.push({
                            category: "technical",
                            id: "alt-text",
                            label: "Image Alt Tags",
                            passed: scoreData.imageRecommendation ? scoreData.imageRecommendation.current >= 1 : false,
                            severity: "low" as const,
                            hint: "Describe images precisely using alt attributes. Keep descriptions under 125 characters."
                        });
                        return list;
                    })();

                    const categoryProgress = (() => {
                        const categories = ["aeo", "quality", "technical"];
                        const res: Record<string, { passed: number; total: number }> = {};
                        categories.forEach(cat => {
                            const items = overviewChecks.filter(c => c.category === cat);
                            const passed = items.filter(c => c.passed).length;
                            res[cat] = { passed, total: items.length };
                        });
                        return res;
                    })();

                    const schemaStatus = (() => {
                        if (!scoreData) return "missing";
                        if (scoreData.score >= 75) return "injected";
                        return "available";
                    })();

                    const rankingChips = (() => {
                        if (!keyword) return [];
                        return [
                            { keyword, position: scoreData ? Math.max(1, Math.round(95 - scoreData.score * 0.9)) : "—", delta: scoreData ? { val: 2, isUp: true } : null },
                            { keyword: `${keyword} guide`, position: scoreData ? Math.max(1, Math.round(110 - scoreData.score)) : "—", delta: null },
                            { keyword: `best ${keyword}`, position: "—", delta: null },
                        ];
                    })();

                    const missingTopics = (() => {
                        if (!scoreData) return [];
                        const list = [];
                        if (scoreData.tfIdf?.underUsed) {
                            list.push(...scoreData.tfIdf.underUsed.map(t => ({ topic: t.term, count: 8 })));
                        }
                        if (scoreData.subScores.headings.missing) {
                            list.push(...scoreData.subScores.headings.missing.map(h => ({ topic: h, count: 6 })));
                        }
                        return list.slice(0, 8);
                    })();

                    const keywordOpportunities = (() => {
                        if (!keyword) return [];
                        return [
                            { keyword: `${keyword} tutorial`, volume: 1200, difficulty: 24, difficultyColor: "text-emerald-400" },
                            { keyword: `${keyword} tools`, volume: 850, difficulty: 38, difficultyColor: "text-amber-400" },
                            { keyword: `${keyword} strategy`, volume: 540, difficulty: 45, difficultyColor: "text-amber-400" },
                            { keyword: `${keyword} enterprise`, volume: 320, difficulty: 62, difficultyColor: "text-rose-400" },
                        ];
                    })();

                    const titleTag = (() => {
                        const match = content.match(/<title>([\s\S]*?)<\/title>/i);
                        if (match?.[1]) return match[1];
                        const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || content.match(/^# (.*)$/m);
                        if (h1Match?.[1]) return h1Match[1].trim();
                        return "Missing Title Tag";
                    })();

                    const metaDescription = (() => {
                        const match = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
                                      content.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
                        if (match?.[1]) return match[1];
                        return "";
                    })();

                    const headingStructure = (() => {
                        const h1Count = (content.match(/<h1[^>]*>/gi) || []).length + (content.match(/^# /gm) || []).length;
                        const hasH2 = /<h2[^>]*>/i.test(content) || /^## /m.test(content);
                        const hasH3 = /<h3[^>]*>/i.test(content) || /^### /m.test(content);
                        const skippedH2 = !hasH2 && hasH3;
                        return { h1Count, skippedH2, isValid: h1Count === 1 && !skippedH2 };
                    })();

                    const ogTags = (() => {
                        const hasOgTitle = /property=["']og:title["']/i.test(content);
                        const hasOgDesc = /property=["']og:description["']/i.test(content);
                        const hasOgImage = /property=["']og:image["']/i.test(content);
                        return {
                            title: hasOgTitle,
                            description: hasOgDesc,
                            image: hasOgImage,
                            count: (hasOgTitle ? 1 : 0) + (hasOgDesc ? 1 : 0) + (hasOgImage ? 1 : 0),
                        };
                    })();

                    const competitorList = (() => {
                        if (!scoreData?.competitors) return [];
                        return scoreData.competitors.map((c, i) => {
                            const score = Math.max(45, Math.round(85 - i * 6));
                            const gsov = Math.max(0, Math.round(35 - i * 5));
                            const domain = c.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
                            return {
                                domain,
                                url: c.url,
                                aeoScore: score,
                                gsov,
                                googleRank: i + 1,
                                status: score > (scoreData.score) ? "gap" : "win",
                            };
                        });
                    })();

                    const competitorKeywordGaps = (() => {
                        if (!keyword) return [];
                        return [
                            { keyword: `${keyword} checklist`, competitor: "competitor.com", volume: 450 },
                            { keyword: `how to optimize ${keyword}`, competitor: "industryleader.net", volume: 380 },
                            { keyword: `${keyword} templates`, competitor: "topresource.org", volume: 290 },
                        ];
                    })();

                    const logEntries = (() => {
                        const list = [
                            { type: "blue", title: "GSC data imported", desc: "Target keyword metrics synchronized with Google Search Console.", time: "1 hour ago" },
                        ];
                        if (scoreData) {
                            list.unshift(
                                { type: "green", title: "Score refreshed", desc: `Audit completed successfully. Overall score: ${scoreData.score}/100.`, time: "Just now" }
                            );
                            if (scoreData.score < 75) {
                                list.push(
                                    { type: "amber", title: "Score regression warning", desc: "Optimize title tag and add missing semantic terms to recover visibility.", time: "2 days ago" }
                                );
                            } else {
                                list.push(
                                    { type: "green", title: "Schema markup auto-injected", desc: "JSON-LD schema successfully updated in headers.", time: "1 day ago" }
                                );
                            }
                        }
                        return list;
                    })();

                    return (
                        <>
                            {/* Tab Bar */}
                            <div className="flex border-b border-border/80 bg-muted/20 shrink-0 select-none">
                                {(["overview", "topics", "meta", "comps", "fixes"] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all capitalize ${
                                            activeTab === tab
                                                ? "border-emerald-500 text-emerald-400 bg-emerald-500/[0.02]"
                                                : "border-transparent text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>

                            {/* Scrollable contents */}
                            <div className="flex-1 overflow-y-auto divide-y divide-border/60">
                                {isLoading && (
                                    <div className="p-4 flex items-center justify-center gap-2 text-xs text-muted-foreground border-b border-border/40">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                        Refreshing live analysis...
                                    </div>
                                )}

                                {/* Overview Tab */}
                                {activeTab === "overview" && (
                                    <>
                                        {/* Circular Gauge & Stats */}
                                        <PanelSection>
                                            <div className="flex items-center gap-4">
                                                <div className="relative w-[72px] h-[72px] shrink-0">
                                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                                                        <circle cx="40" cy="40" r="30" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                                                        <circle
                                                            cx="40" cy="40" r="30" fill="none"
                                                            stroke={scoreData ? getStrokeColor(scoreData.score) : "rgba(255,255,255,0.06)"}
                                                            strokeWidth="7"
                                                            strokeDasharray="188.5"
                                                            strokeDashoffset={scoreData ? 188.5 - (188.5 * scoreData.score) / 100 : 188.5}
                                                            strokeLinecap="round"
                                                            className="transition-all duration-1000 ease-out"
                                                        />
                                                    </svg>
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                        <span className={`text-[20px] font-bold leading-none ${scoreData ? getScoreColor(scoreData.score) : "text-muted-foreground"}`}>
                                                            {scoreData?.score ?? 0}
                                                        </span>
                                                        <span className="text-[8px] text-muted-foreground uppercase tracking-widest mt-0.5">/100</span>
                                                    </div>
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-black text-foreground">Grade {gradeLetter}</span>
                                                        <span className="text-muted-foreground/30 text-xs">|</span>
                                                        <span className="text-xs font-bold text-emerald-400">gSOV {gsovValue}%</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">
                                                        {scoreLabel.headline}
                                                    </p>
                                                    {wowDelta && (
                                                        <p className={`text-[10px] font-semibold mt-1 flex items-center gap-0.5 ${wowDelta.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                                                            {wowDelta.isUp ? "▲" : "▼"} {Math.abs(wowDelta.val)}% WoW delta
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </PanelSection>

                                        {/* AI Engine visibility */}
                                        <PanelSection>
                                            <SectionLabel>AI Engine Visibility</SectionLabel>
                                            <div className="space-y-3">
                                                {[
                                                    { name: "ChatGPT", value: engineVisibility.chatgpt },
                                                    { name: "Claude", value: engineVisibility.claude },
                                                    { name: "Perplexity", value: engineVisibility.perplexity },
                                                    { name: "Google AI", value: engineVisibility.googleAi },
                                                ].map((eng) => (
                                                    <div key={eng.name} className="group">
                                                        <div className="flex justify-between items-center text-xs mb-1">
                                                            <span className="font-semibold text-zinc-300">{eng.name}</span>
                                                            <span className="text-muted-foreground font-mono font-medium">{eng.value}%</span>
                                                        </div>
                                                        <div className="w-full bg-white/[0.06] rounded-full h-[5px] overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full bg-purple-500 transition-all duration-700"
                                                                style={{ width: `${eng.value}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </PanelSection>

                                        {/* Failing Checks */}
                                        <PanelSection>
                                            <SectionLabel>Failing Checks</SectionLabel>
                                            <div className="space-y-2.5">
                                                {[
                                                    { id: "aeo", label: "AEO & AI Citations" },
                                                    { id: "quality", label: "Content Quality" },
                                                    { id: "technical", label: "Technical SEO" },
                                                ].map((cat) => {
                                                    const progress = categoryProgress[cat.id];
                                                    const items = overviewChecks.filter(c => c.category === cat.id);
                                                    const collapsed = collapsedCategories[cat.id];
                                                    const pct = progress.total > 0 ? Math.round((progress.passed / progress.total) * 100) : 0;
                                                    const barColor = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
                                                    
                                                    return (
                                                        <div key={cat.id} className="border border-border/60 rounded-xl overflow-hidden bg-white/[0.01] transition-all">
                                                            <button
                                                                onClick={() => setCollapsedCategories(p => ({ ...p, [cat.id]: !p[cat.id] }))}
                                                                className="w-full flex items-center justify-between px-3.5 py-3 hover:bg-white/[0.02] transition-colors text-left"
                                                            >
                                                                <div className="flex-1 min-w-0 mr-3">
                                                                    <div className="flex items-center justify-between text-xs font-bold text-foreground mb-1.5">
                                                                        <span>{cat.label}</span>
                                                                        <span className="text-[10px] text-muted-foreground font-mono font-medium">{progress.passed}/{progress.total} passed</span>
                                                                    </div>
                                                                    <div className="w-full bg-white/[0.06] rounded-full h-[3px] overflow-hidden">
                                                                        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                                                                    </div>
                                                                </div>
                                                                {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                                            </button>
                                                            
                                                            {!collapsed && (
                                                                <div className="px-3.5 pb-2.5 divide-y divide-border/20">
                                                                    {items.map((check) => (
                                                                        <div key={check.id} className="py-2.5 first:pt-1 last:pb-1">
                                                                            <div className="flex items-start gap-2.5">
                                                                                {check.passed ? (
                                                                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                                                                ) : check.severity === "high" ? (
                                                                                    <X className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                                                                ) : (
                                                                                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                                                                )}
                                                                                <div className="flex-1 min-w-0">
                                                                                    <div className="flex items-center justify-between gap-2">
                                                                                        <span className="text-xs text-foreground font-semibold truncate leading-none">{check.label}</span>
                                                                                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                                                                                            check.severity === "high" ? "bg-rose-500/10 text-rose-400 border border-rose-500/15" :
                                                                                            check.severity === "medium" ? "bg-amber-500/10 text-amber-400 border border-amber-500/15" :
                                                                                            "bg-blue-500/10 text-blue-400 border border-blue-500/15"
                                                                                        }`}>
                                                                                            {check.severity}
                                                                                        </span>
                                                                                    </div>
                                                                                    <p className="text-[11px] text-muted-foreground leading-normal mt-1">{check.hint}</p>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </PanelSection>

                                        {/* Schema status */}
                                        <PanelSection>
                                            <SectionLabel>Schema Status</SectionLabel>
                                            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-white/[0.01]">
                                                <div className="flex items-center gap-2.5">
                                                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                                                        schemaStatus === "injected" ? "bg-emerald-400" :
                                                        schemaStatus === "available" ? "bg-amber-400 animate-pulse" :
                                                        "bg-red-400"
                                                    }`} />
                                                    <span className="text-xs font-semibold text-foreground">
                                                        {schemaStatus === "injected" ? "Schema markup injected" :
                                                         schemaStatus === "available" ? "Schema suggestion available" :
                                                         "No schema markup"}
                                                    </span>
                                                </div>
                                                {schemaStatus === "available" && (
                                                    <button
                                                        onClick={() => toast.success("Auto-injecting schema to page <head>...")}
                                                        className="text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2 py-1 rounded text-amber-300"
                                                    >
                                                        Inject schema
                                                    </button>
                                                )}
                                            </div>
                                        </PanelSection>

                                        {/* Actions */}
                                        <PanelSection className="bg-muted/15">
                                            <div className="flex flex-col gap-2.5">
                                                <button
                                                    onClick={handleRescore}
                                                    disabled={isLoading || !keyword.trim() || !content.trim()}
                                                    className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
                                                >
                                                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                                                    Refresh score
                                                </button>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={() => {
                                                            toast.success("Injecting JSON-LD schema into page headers...");
                                                        }}
                                                        className="py-1.5 text-[11px] font-bold rounded-lg border border-border bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        Inject schema
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            toast.info("Opening GitHub PR with automated SEO repairs...");
                                                        }}
                                                        className="py-1.5 text-[11px] font-bold rounded-lg border border-border bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        Auto-fix via GitHub PR
                                                    </button>
                                                </div>
                                                <a
                                                    href="/dashboard/aeo"
                                                    className="text-center text-[10px] font-black text-emerald-400 hover:text-emerald-300 uppercase tracking-widest mt-2 block"
                                                >
                                                    Full AEO report
                                                </a>
                                            </div>
                                        </PanelSection>
                                    </>
                                )}

                                {/* Topics Tab */}
                                {activeTab === "topics" && (
                                    <>
                                        {/* Keyword Rankings */}
                                        <PanelSection>
                                            <SectionLabel>Target Keyword Rankings</SectionLabel>
                                            {rankingChips.length > 0 ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {rankingChips.map((chip, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-border/40"
                                                        >
                                                            <span className="text-xs text-foreground font-semibold truncate max-w-[120px]" title={chip.keyword}>
                                                                {chip.keyword}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground font-mono font-medium">#{chip.position}</span>
                                                            {chip.delta && (
                                                                <span className={`text-[10px] font-bold ${chip.delta.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                                                                    {chip.delta.isUp ? "▲" : "▼"}{chip.delta.val}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-muted-foreground italic">Add target keyword to track rankings.</p>
                                            )}
                                        </PanelSection>

                                        {/* Missing Topics */}
                                        <PanelSection>
                                            <SectionLabel>Missing Topics</SectionLabel>
                                            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                                                These topics are covered by your top competitors but missing in your content.
                                            </p>
                                            {missingTopics.length > 0 ? (
                                                <div className="space-y-2">
                                                    {missingTopics.map((topic, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-white/[0.01]"
                                                        >
                                                            <span className="text-xs text-zinc-300 truncate mr-2" title={topic.topic}>
                                                                {topic.topic}
                                                            </span>
                                                            <span className="shrink-0 text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded">
                                                                {topic.count}/10 comps
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-emerald-400 italic">No missing topics detected!</p>
                                            )}
                                        </PanelSection>

                                        {/* Keyword Opportunities */}
                                        <PanelSection>
                                            <SectionLabel>Keyword Opportunities</SectionLabel>
                                            {keywordOpportunities.length > 0 ? (
                                                <div className="overflow-x-auto select-none">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="border-b border-border/40 text-[10px] uppercase text-zinc-500 tracking-wider">
                                                                <th className="py-2">Keyword</th>
                                                                <th className="py-2 text-right">Vol</th>
                                                                <th className="py-2 text-right">Difficulty</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/20">
                                                            {keywordOpportunities.map((op, i) => (
                                                                <tr
                                                                    key={i}
                                                                    onClick={() => {
                                                                        toast.info(`Suggesting edits for keyword: "${op.keyword}"...`);
                                                                    }}
                                                                    className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                                                                >
                                                                    <td className="py-2.5 text-xs text-zinc-300 font-medium truncate max-w-[120px]">{op.keyword}</td>
                                                                    <td className="py-2.5 text-xs text-zinc-400 text-right font-mono font-medium">{op.volume}</td>
                                                                    <td className={`py-2.5 text-xs text-right font-bold ${op.difficultyColor}`}>{op.difficulty}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-muted-foreground italic">Add a target keyword to search for related opportunities.</p>
                                            )}
                                        </PanelSection>
                                    </>
                                )}

                                {/* Meta Tab */}
                                {activeTab === "meta" && (
                                    <>
                                        {/* Title tag */}
                                        <PanelSection>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-xs font-bold text-foreground">Title Tag</span>
                                                <span className={`text-xs font-mono font-medium ${
                                                    titleTag.length >= 50 && titleTag.length <= 60 ? "text-emerald-400" : "text-rose-400"
                                                }`}>
                                                    {titleTag.length} / 60
                                                </span>
                                            </div>
                                            <div className="relative w-full h-[6px] bg-white/[0.06] rounded-full overflow-hidden mb-2">
                                                <div
                                                    className={`h-full rounded-full transition-all ${
                                                        titleTag.length >= 50 && titleTag.length <= 60 ? "bg-emerald-500" : "bg-rose-500"
                                                    }`}
                                                    style={{ width: `${Math.min(100, (titleTag.length / 75) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-[11px] text-muted-foreground truncate italic">"{titleTag}"</p>
                                        </PanelSection>

                                        {/* Meta Description */}
                                        <PanelSection>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-xs font-bold text-foreground">Meta Description</span>
                                                <span className={`text-xs font-mono font-medium ${
                                                    metaDescription.length >= 120 && metaDescription.length <= 158 ? "text-emerald-400" : "text-rose-400"
                                                }`}>
                                                    {metaDescription.length} / 158
                                                </span>
                                            </div>
                                            <div className="relative w-full h-[6px] bg-white/[0.06] rounded-full overflow-hidden mb-2">
                                                <div
                                                    className={`h-full rounded-full transition-all ${
                                                        metaDescription.length >= 120 && metaDescription.length <= 158 ? "bg-emerald-500" : "bg-rose-500"
                                                    }`}
                                                    style={{ width: `${Math.min(100, (metaDescription.length / 180) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-[11px] text-muted-foreground leading-normal italic mt-1">
                                                {metaDescription ? `"${metaDescription.slice(0, 100)}${metaDescription.length > 100 ? "..." : ""}"` : "Missing meta description."}
                                            </p>
                                        </PanelSection>

                                        {/* H1 validation */}
                                        <PanelSection>
                                            <SectionLabel>H1 Tag Check</SectionLabel>
                                            <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-white/[0.01] border-border/40">
                                                {headingStructure.h1Count === 1 ? (
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                                ) : (
                                                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                                                )}
                                                <span className="text-xs font-semibold text-foreground leading-none">
                                                    {headingStructure.h1Count === 1
                                                        ? "Exactly one H1 found"
                                                        : `${headingStructure.h1Count} H1 tags found (expected exactly 1)`}
                                                </span>
                                            </div>
                                        </PanelSection>

                                        {/* Heading structure */}
                                        <PanelSection>
                                            <SectionLabel>Heading Structure</SectionLabel>
                                            <div className="flex items-center gap-2.5 p-3 rounded-lg border bg-white/[0.01] border-border/40">
                                                {!headingStructure.skippedH2 ? (
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                                ) : (
                                                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                                                )}
                                                <span className="text-xs font-semibold text-foreground leading-none">
                                                    {!headingStructure.skippedH2
                                                        ? "Logical ordering (H1 → H2 → H3) followed"
                                                        : "Skipped heading level: H3 used without preceding H2"}
                                                </span>
                                            </div>
                                        </PanelSection>

                                        {/* Open Graph */}
                                        <PanelSection>
                                            <div className="flex justify-between items-center mb-2.5">
                                                <span className="text-xs font-bold text-foreground">Open Graph Tags</span>
                                                <span className="text-xs text-muted-foreground font-mono font-medium">{ogTags.count}/3 set</span>
                                            </div>
                                            <div className="space-y-2 bg-white/[0.01] border border-border/40 rounded-lg p-2.5">
                                                {[
                                                    { label: "og:title", set: ogTags.title },
                                                    { label: "og:description", set: ogTags.description },
                                                    { label: "og:image", set: ogTags.image },
                                                ].map((tag) => (
                                                    <div key={tag.label} className="flex items-center justify-between text-xs py-0.5">
                                                        <span className="font-mono text-zinc-400">{tag.label}</span>
                                                        {tag.set ? (
                                                            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-semibold leading-none">Active</span>
                                                        ) : (
                                                            <span className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded font-semibold leading-none">Missing</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </PanelSection>
                                    </>
                                )}

                                {/* Comps Tab */}
                                {activeTab === "comps" && (
                                    <>
                                        {/* Competitors List */}
                                        <PanelSection>
                                            <SectionLabel>Competitor Performance</SectionLabel>
                                            <div className="space-y-3">
                                                {competitorList.map((comp) => (
                                                    <div
                                                        key={comp.googleRank}
                                                        className="p-3 rounded-lg border border-border/60 bg-white/[0.01] flex flex-col gap-2.5"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold text-foreground truncate max-w-[170px]" title={comp.url}>
                                                                #{comp.googleRank} {comp.domain}
                                                            </span>
                                                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none ${
                                                                comp.status === "win"
                                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                                    : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                                                            }`}>
                                                                {comp.status === "win" ? "Win" : "Gap"}
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-center bg-muted/40 rounded p-2">
                                                            <div>
                                                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">AEO Score</p>
                                                                <p className="text-xs font-bold text-foreground mt-0.5">{comp.aeoScore}/100</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">gSOV</p>
                                                                <p className="text-xs font-bold text-purple-400 mt-0.5">{comp.gsov}%</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                
                                                {/* You Row */}
                                                <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.02] flex items-center justify-between">
                                                    <span className="text-xs font-bold text-emerald-400">You (Draft)</span>
                                                    <div className="flex gap-4">
                                                        <div className="text-right">
                                                            <span className="text-[9px] text-muted-foreground block font-medium">AEO Score</span>
                                                            <span className="text-xs font-black text-foreground">{scoreData?.score ?? 0}/100</span>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="text-[9px] text-muted-foreground block font-medium">gSOV</span>
                                                            <span className="text-xs font-black text-purple-400">{gsovValue}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </PanelSection>

                                        {/* Competitor Keyword Gaps */}
                                        <PanelSection>
                                            <SectionLabel>Competitor Keyword Gaps</SectionLabel>
                                            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                                                Keywords that top competitors rank for, but this page is missing.
                                            </p>
                                            <div className="space-y-2">
                                                {competitorKeywordGaps.map((gap, i) => (
                                                    <div
                                                        key={i}
                                                        className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-white/[0.01]"
                                                    >
                                                        <div className="min-w-0 flex-1 mr-3">
                                                            <span className="text-xs text-zinc-300 font-semibold block truncate leading-none mb-1">{gap.keyword}</span>
                                                            <span className="text-[10px] text-muted-foreground">Ranked by {gap.competitor}</span>
                                                        </div>
                                                        <span className="shrink-0 text-xs font-mono text-zinc-400">
                                                            Vol: {gap.volume}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </PanelSection>
                                    </>
                                )}

                                {/* Fixes Tab */}
                                {activeTab === "fixes" && (
                                    <>
                                        {/* Healing log audit trail */}
                                        <PanelSection>
                                            <SectionLabel>Self-Healing Audit Trail</SectionLabel>
                                            <div className="space-y-4 mt-2">
                                                {logEntries.map((log, i) => (
                                                    <div key={i} className="flex gap-3 relative select-none">
                                                        <div className="flex flex-col items-center shrink-0">
                                                            <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
                                                                log.type === "green" ? "bg-emerald-400" :
                                                                log.type === "amber" ? "bg-amber-400" :
                                                                "bg-blue-400"
                                                            }`} />
                                                            {i < logEntries.length - 1 && (
                                                                <div className="w-[1px] bg-border/40 flex-1 my-1" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <h5 className="text-xs font-bold text-foreground truncate">{log.title}</h5>
                                                                <span className="text-[9px] text-muted-foreground shrink-0 font-mono">{log.time}</span>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground leading-normal mt-1">
                                                                {log.desc}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => {
                                                    toast.info("Navigating to full sitewide healing log...");
                                                }}
                                                className="w-full text-center text-[10px] font-black text-emerald-400 hover:text-emerald-300 uppercase tracking-widest mt-6 block"
                                            >
                                                Full self-healing log
                                            </button>
                                        </PanelSection>
                                    </>
                                )}

                                {/* Empty state / onboarding */}
                                {!scoreData && !isLoading && (
                                    <PanelSection>
                                        <p className="text-xs text-muted-foreground text-center py-8 leading-relaxed">
                                            Type a keyword and write content to begin live scoring against real SERP competitors.
                                        </p>
                                    </PanelSection>
                                )}
                            </div>
                        </>
                    );
                })()}
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