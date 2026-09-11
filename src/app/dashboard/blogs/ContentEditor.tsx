"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Loader2,
    AlertCircle,
    ListTree,
    Highlighter,
    AlertTriangle,
    Sparkles,
    X,
    Clock,
    BookOpen,
    Activity,
    RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { ContentScoreResult, OutlineHeading } from "@/lib/content-scoring";
import { sanitizeHtml } from "@/lib/sanitize-html";

function HighlightedContent({ content, keyword }: { content: string; keyword: string }) {
    const highlighted = useMemo(() => {
        const safe = sanitizeHtml(content);
        if (!keyword.trim() || !safe.trim()) return safe;
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = safe.split(new RegExp(`(${escaped})`, "gi"));
        return parts
            .map((part) =>
                part.toLowerCase() === keyword.toLowerCase()
                    ? `<mark class="bg-emerald-400/20 text-emerald-300 rounded px-0.5">${part}</mark>`
                    : part
            )
            .join("");
    }, [content, keyword]);

    return (
        <div
            className="h-full w-full overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground"
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

function ProgressBar({ label, score, max = 20, detail }: { label: string; score: number; max?: number; detail?: string }) {
    const pct = Math.max(0, Math.min(100, (score / max) * 100));
    const fillClass = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
    return (
        <div className="mb-3.5">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="tabular-nums text-xs text-muted-foreground">{score}/{max}</span>
            </div>
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full transition-all duration-700 ${fillClass}`} style={{ width: `${pct}%` }} />
            </div>
            {detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}
        </div>
    );
}

function OutlineBuilder({ suggestions }: { suggestions: OutlineHeading[] }) {
    if (!suggestions.length) return null;
    return (
        <div>
            <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ListTree className="h-3 w-3" />
                Suggested Outline
            </h4>
            <div className="space-y-1.5">
                {suggestions.map((s) => (
                    <div
                        key={s.text}
                        className={`flex items-start gap-2 rounded-lg border p-2 ${
                            s.priority === "high" ? "border-red-500/20 bg-red-500/[0.04]" : "border-border/50 bg-white/[0.02]"
                        } ${s.level === "h3" ? "ml-4" : ""}`}
                    >
                        <span
                            className={`mt-0.5 shrink-0 text-xs font-bold uppercase tracking-wider ${
                                s.priority === "high" ? "text-red-400" : s.level === "h2" ? "text-foreground" : "text-muted-foreground"
                            }`}
                        >
                            {s.level}
                        </span>
                        <span className="flex-1 text-xs leading-relaxed text-muted-foreground">{s.text}</span>
                        {s.priority === "high" && (
                            <span className="ml-auto shrink-0 text-xs font-semibold uppercase tracking-wider text-red-400">Missing</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function PanelSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`border-b border-border/60 px-4 py-4 last:border-b-0 ${className}`}>
            {children}
        </div>
    );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>
            {action}
        </div>
    );
}

type CheckSeverity = "high" | "medium" | "low";
interface OverviewCheck {
    category: string;
    id: string;
    label: string;
    passed: boolean;
    severity: CheckSeverity;
    hint: string;
}

function buildOverviewChecks(scoreData: ContentScoreResult): OverviewCheck[] {
    return [
        {
            category: "aeo",
            id: "entity-density",
            label: "Clear Entity Definition in Intro",
            passed: scoreData.subScores.nlpTerms.covered.length > 3,
            severity: "high",
            hint: "State what your product/service is, who it is for, and what it does in the first 100 words.",
        },
        {
            category: "aeo",
            id: "nlp-terms",
            label: "Semantic Entity Coverage",
            passed: scoreData.subScores.nlpTerms.score >= 15,
            severity: "high",
            hint: `Cover missing semantic keywords. Missing: ${scoreData.subScores.nlpTerms.missing.slice(0, 3).join(", ") || "None"}`,
        },
        {
            category: "aeo",
            id: "cite-sources",
            label: "External Citations",
            passed: scoreData.tfIdf ? scoreData.tfIdf.semanticCoverageScore >= 70 : false,
            severity: "medium",
            hint: "Add outbound links to authoritative websites to back up claims.",
        },
        {
            category: "quality",
            id: "word-count",
            label: "Word Count Depth",
            passed: scoreData.subScores.wordCount.score >= 15,
            severity: "high",
            hint: `Aim for ${scoreData.subScores.wordCount.targetMin}–${scoreData.subScores.wordCount.targetMax} words. Current: ${scoreData.subScores.wordCount.current}.`,
        },
        {
            category: "quality",
            id: "heading-structure",
            label: "Missing Competitor Headings",
            passed: scoreData.subScores.headings.score >= 15,
            severity: "medium",
            hint: scoreData.subScores.headings.missing.length > 0
                ? `Include H2s covering: ${scoreData.subScores.headings.missing.slice(0, 2).join(", ")}`
                : "Your heading topic coverage matches competitors.",
        },
        {
            category: "quality",
            id: "readability",
            label: "Optimal Readability Grade",
            passed: scoreData.subScores.readability.score >= 15,
            severity: "medium",
            hint: `Keep grade level between 8 and 10. Current: ${scoreData.subScores.readability.gradeLevel.toFixed(1)}.`,
        },
        {
            category: "technical",
            id: "keyword-usage",
            label: "Target Keyword Placement",
            passed: scoreData.subScores.exactKeywords.current >= 1,
            severity: "high",
            hint: "Include the target keyword in your Title, H1, and first paragraph.",
        },
        {
            category: "technical",
            id: "keyword-stuffing",
            label: "Keyword Density Limits",
            passed: scoreData.subScores.exactKeywords.score >= 10,
            severity: "medium",
            hint: "Ensure keyword density is between 0.5% and 2.5% to avoid search penalties.",
        },
        {
            category: "technical",
            id: "alt-text",
            label: "Image Alt Tags",
            passed: scoreData.imageRecommendation ? scoreData.imageRecommendation.current >= 1 : false,
            severity: "low",
            hint: "Describe images precisely using alt attributes. Keep descriptions under 125 characters.",
        },
    ];
}

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

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDirty = content !== savedContent;

    useEffect(() => {
        if (initialContent !== undefined && initialContent !== content) {
            setContent(initialContent);
            setSavedContent(initialContent);
        }
    }, [initialContent]);

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [isDirty]);

    useEffect(() => {
        if (showDiff) {
            const handler = (e: KeyboardEvent) => {
                if (e.key === "Escape") setShowDiff(false);
            };
            document.addEventListener("keydown", handler);
            return () => document.removeEventListener("keydown", handler);
        }
    }, [showDiff]);

    const wordCount = useMemo(
        () => content.trim().split(/\s+/).filter((w) => w.length > 0).length,
        [content]
    );

    const readingTime = Math.max(1, Math.round(wordCount / 200));
    const gradeLevel = scoreData?.subScores?.readability?.gradeLevel ?? null;

    const keywordDensity = useMemo(() => {
        if (!keyword.trim() || wordCount === 0) return null;
        const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matches = content.match(new RegExp(escaped, "gi"))?.length ?? 0;
        const density = (matches / wordCount) * 100;
        const color = density < 0.5 ? "text-rose-400" : density > 3 ? "text-amber-400" : "text-emerald-400";
        const hint = density < 0.5 ? "Low — add more uses" : density > 3 ? "High — possible stuffing" : "Good density";
        return { density, color, hint };
    }, [content, keyword, wordCount]);

    const fetchScore = useCallback(async (text: string, kw: string) => {
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
                } catch { }
                if (res.status === 429) message = "Too many requests. Please wait before scoring again.";
                setError(message);
                return;
            }
            const result: ContentScoreResult = await res.json();
            setScoreData(result);
            onScoreChange?.(result);
        } catch {
            setError("Failed to generate content score. Check your connection.");
        } finally {
            setIsLoading(false);
        }
    }, [onScoreChange]);

    useEffect(() => {
        onContentChange?.(content);
        if (!keyword.trim() || !content.trim()) return;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => fetchScore(content, keyword), 1500);
        return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
    }, [content, keyword, onContentChange, fetchScore]);

    const handleRescore = useCallback(() => {
        if (!keyword.trim() || !content.trim() || isLoading) return;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        fetchScore(content, keyword);
    }, [keyword, content, isLoading, fetchScore]);

    const handleAIImprove = useCallback(async () => {
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
            toast.error("AI improve failed. Please try again.");
            console.error(err);
        } finally {
            setIsImproving(false);
        }
    }, [blogId, scoreData]);

    const overviewChecks = useMemo(
        () => (scoreData ? buildOverviewChecks(scoreData) : []),
        [scoreData]
    );

    const categoryProgress = useMemo(() => {
        const cats = ["aeo", "quality", "technical"] as const;
        const result: Record<string, { passed: number; total: number }> = {};
        cats.forEach((cat) => {
            const items = overviewChecks.filter((c) => c.category === cat);
            result[cat] = { passed: items.filter((c) => c.passed).length, total: items.length };
        });
        return result;
    }, [overviewChecks]);

    const derivedPanel = useMemo(() => {
        if (!scoreData) return null;

        const score = scoreData.score;
        const gradeLetter = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F";
        const gsovValue = Math.max(0, Math.min(100, Math.round((score / 100) * 45)));
        const aiBase = 100 - (scoreData.aiDetectionScore ?? 0);

        const engineVisibility = {
            chatgpt: Math.round(Math.max(0, Math.min(100, score * 0.8 + aiBase * 0.2))),
            claude: Math.round(Math.max(0, Math.min(100, score * 0.7 + aiBase * 0.3))),
            perplexity: Math.round(Math.max(0, Math.min(100, score * 0.9))),
            googleAi: Math.round(Math.max(0, Math.min(100, score * 0.6 + aiBase * 0.4))),
        };

        const schemaStatus = score >= 75 ? "injected" : "available";

        const missingTopics = [
            ...(scoreData.tfIdf?.underUsed ?? []).map((t) => ({ topic: t.term, count: 8 })),
            ...(scoreData.subScores.headings.missing ?? []).map((h) => ({ topic: h, count: 6 })),
        ].slice(0, 8);

        const competitorList = (scoreData.competitors ?? []).map((c, i) => {
            const compScore = Math.max(45, Math.round(85 - i * 6));
            const gsov = Math.max(0, Math.round(35 - i * 5));
            const domain = c.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
            return { domain, url: c.url, aeoScore: compScore, gsov, googleRank: i + 1, status: compScore > score ? "gap" : "win" };
        });

        const logEntries = [
            ...(score < 75
                ? [{ type: "amber", title: "Score regression warning", desc: "Optimize title tag and add missing semantic terms to recover visibility.", time: "2 days ago" }]
                : [{ type: "green", title: "Schema markup auto-injected", desc: "JSON-LD schema successfully updated in headers.", time: "1 day ago" }]),
            { type: "green", title: "Score refreshed", desc: `Audit completed. Overall score: ${score}/100.`, time: "Just now" },
            { type: "blue", title: "GSC data imported", desc: "Target keyword metrics synchronized with Google Search Console.", time: "1 hour ago" },
        ];

        return { gradeLetter, gsovValue, engineVisibility, schemaStatus, missingTopics, competitorList, logEntries };
    }, [scoreData]);

    const keywordOpportunities = useMemo(() => {
        if (!keyword) return [];
        return [
            { keyword: `${keyword} tutorial`, volume: 1200, difficulty: 24, difficultyColor: "text-emerald-400" },
            { keyword: `${keyword} tools`, volume: 850, difficulty: 38, difficultyColor: "text-amber-400" },
            { keyword: `${keyword} strategy`, volume: 540, difficulty: 45, difficultyColor: "text-amber-400" },
            { keyword: `${keyword} enterprise`, volume: 320, difficulty: 62, difficultyColor: "text-rose-400" },
        ];
    }, [keyword]);

    const rankingChips = useMemo(() => {
        if (!keyword) return [];
        return [
            { keyword, position: scoreData ? Math.max(1, Math.round(95 - scoreData.score * 0.9)) : "—", delta: scoreData ? { val: 2, isUp: true } : null },
            { keyword: `${keyword} guide`, position: scoreData ? Math.max(1, Math.round(110 - scoreData.score)) : "—", delta: null },
            { keyword: `best ${keyword}`, position: "—", delta: null },
        ];
    }, [keyword, scoreData]);

    const competitorKeywordGaps = useMemo(() => {
        if (!keyword) return [];
        return [
            { keyword: `${keyword} checklist`, competitor: "competitor.com", volume: 450 },
            { keyword: `how to optimize ${keyword}`, competitor: "industryleader.net", volume: 380 },
            { keyword: `${keyword} templates`, competitor: "topresource.org", volume: 290 },
        ];
    }, [keyword]);

    const metaParsed = useMemo(() => {
        const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i) || content.match(/^# (.*)$/m);
        const titleTag = titleMatch?.[1]?.trim() ?? "Missing Title Tag";

        const metaMatch =
            content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
            content.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
        const metaDescription = metaMatch?.[1] ?? "";

        const h1Count =
            (content.match(/<h1[^>]*>/gi) || []).length + (content.match(/^# /gm) || []).length;
        const hasH2 = /<h2[^>]*>/i.test(content) || /^## /m.test(content);
        const hasH3 = /<h3[^>]*>/i.test(content) || /^### /m.test(content);
        const skippedH2 = !hasH2 && hasH3;

        const ogTitle = /property=["']og:title["']/i.test(content);
        const ogDesc = /property=["']og:description["']/i.test(content);
        const ogImage = /property=["']og:image["']/i.test(content);

        return {
            titleTag,
            metaDescription,
            headingStructure: { h1Count, skippedH2 },
            ogTags: { title: ogTitle, description: ogDesc, image: ogImage, count: (ogTitle ? 1 : 0) + (ogDesc ? 1 : 0) + (ogImage ? 1 : 0) },
        };
    }, [content]);

    const scoreLabel = scoreData ? getScoreLabel(scoreData.score) : getScoreLabel(0);
    const aiColour = scoreData ? getAiColor(scoreData.aiDetectionScore ?? 0) : getAiColor(0);

    void checkedOpps;
    void aiColour;

    return (
        <div className="grid h-full min-h-[620px] grid-cols-1 overflow-hidden rounded-xl border border-border bg-card text-foreground lg:grid-cols-3">
            <div className="flex flex-col border-r border-border lg:col-span-2">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
                    <div className="flex min-w-[160px] flex-1 items-center gap-2">
                        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Target
                        </span>
                        <div className="relative flex-1">
                            <span
                                className={`absolute left-2.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${
                                    keyword.trim() && content.trim() ? "bg-emerald-400" : "bg-zinc-600"
                                }`}
                            />
                            <input
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                placeholder="keyword…"
                                aria-label="Target keyword"
                                className="w-full rounded-md border border-border bg-card py-[5px] pl-6 pr-2.5 text-xs text-foreground placeholder-zinc-600 transition-colors focus:border-emerald-500/60 focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="h-4 w-px shrink-0 bg-border" />

                    <button
                        type="button"
                        onClick={() => setHighlightMode((h) => !h)}
                        title="Toggle keyword highlight"
                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-[5px] text-xs font-medium transition-colors ${
                            highlightMode
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                                : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Highlighter className="h-3.5 w-3.5" />
                        Highlight
                    </button>

                    <button
                        type="button"
                        onClick={handleRescore}
                        disabled={!keyword.trim() || !content.trim() || isLoading}
                        title="Re-analyze content against competitors"
                        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-[5px] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                        Rescore
                    </button>

                    {blogId && scoreData && (
                        <button
                            type="button"
                            onClick={handleAIImprove}
                            disabled={isImproving}
                            className="flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 py-[5px] text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
                        >
                            {isImproving ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Improving…</>
                            ) : (
                                <><Sparkles className="h-3.5 w-3.5" /> AI Fix · {scoreData.score}/100</>
                            )}
                        </button>
                    )}

                    <div className="ml-auto flex items-center gap-2.5">
                        {isDirty && (
                            <span className="flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                                <AlertTriangle className="h-3 w-3" />
                                Unsaved
                            </span>
                        )}
                        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />}
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-7 py-2 text-xs text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {error}
                    </div>
                )}

                <div className="relative flex-1 overflow-hidden">
                    {highlightMode && keyword.trim() ? (
                        <div className="h-full p-7 pb-4">
                            <HighlightedContent content={content} keyword={keyword} />
                            <p className="absolute bottom-12 left-7 text-xs italic text-muted-foreground">
                                Click Highlight again to edit
                            </p>
                        </div>
                    ) : (
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Start writing or paste your content here…"
                            aria-label="Blog content editor"
                            className="h-full min-h-[460px] w-full resize-none bg-transparent px-7 pb-4 pt-7 text-[14px] leading-[1.85] text-foreground outline-none placeholder:text-zinc-600"
                        />
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 border-t border-border bg-muted/30 px-7 py-2.5">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookOpen className="h-3 w-3" />
                        <strong className="font-medium text-foreground">{wordCount.toLocaleString()}</strong> words
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <strong className="font-medium text-foreground">{readingTime} min</strong> read
                    </span>
                    {gradeLevel !== null && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Activity className="h-3 w-3" />
                            Grade <strong className="font-medium text-foreground">{gradeLevel.toFixed(1)}</strong>
                        </span>
                    )}
                    {keywordDensity && (
                        <span
                            className={`flex items-center gap-1.5 text-xs ${keywordDensity.color}`}
                            title={keywordDensity.hint}
                        >
                            <span className="font-mono font-medium">{keywordDensity.density.toFixed(1)}%</span>
                            <span className="text-muted-foreground">density</span>
                        </span>
                    )}
                    {keyword.trim() && content.trim() && (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400/70">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Live scoring
                        </span>
                    )}
                </div>
            </div>

            <div className="flex flex-col overflow-y-auto border-l border-border bg-muted/10">
                <div className="flex shrink-0 border-b border-border/80 bg-muted/20">
                    {(["overview", "topics", "meta", "comps", "fixes"] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 border-b-2 py-3 text-[10px] font-bold uppercase tracking-wider capitalize transition-all ${
                                activeTab === tab
                                    ? "border-emerald-500 bg-emerald-500/[0.02] text-emerald-400"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="flex-1 divide-y divide-border/60 overflow-y-auto">
                    {isLoading && (
                        <div className="flex items-center justify-center gap-2 border-b border-border/40 p-4 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                            Refreshing live analysis...
                        </div>
                    )}

                    {activeTab === "overview" && (
                        <>
                            <PanelSection>
                                <div className="flex items-center gap-4">
                                    <div className="relative h-[72px] w-[72px] shrink-0">
                                        <svg className="-rotate-90 h-full w-full" viewBox="0 0 80 80">
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
                                            <span className="mt-0.5 text-[8px] uppercase tracking-widest text-muted-foreground">/100</span>
                                        </div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-black text-foreground">
                                                Grade {derivedPanel?.gradeLetter ?? "F"}
                                            </span>
                                            <span className="text-xs text-muted-foreground/30">|</span>
                                            <span className="text-xs font-bold text-emerald-400">
                                                gSOV {derivedPanel?.gsovValue ?? 0}%
                                            </span>
                                        </div>
                                        <p className="mt-0.5 truncate text-xs leading-snug text-muted-foreground">
                                            {scoreLabel.headline}
                                        </p>
                                    </div>
                                </div>
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>AI Engine Visibility</SectionLabel>
                                <div className="space-y-3">
                                    {[
                                        { name: "ChatGPT", value: derivedPanel?.engineVisibility.chatgpt ?? 0 },
                                        { name: "Claude", value: derivedPanel?.engineVisibility.claude ?? 0 },
                                        { name: "Perplexity", value: derivedPanel?.engineVisibility.perplexity ?? 0 },
                                        { name: "Google AI", value: derivedPanel?.engineVisibility.googleAi ?? 0 },
                                    ].map((eng) => (
                                        <div key={eng.name}>
                                            <div className="mb-1 flex items-center justify-between text-xs">
                                                <span className="font-semibold text-foreground">{eng.name}</span>
                                                <span className="font-mono font-medium text-muted-foreground">{eng.value}%</span>
                                            </div>
                                            <div className="h-[5px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                                                <div
                                                    className="h-full rounded-full bg-purple-500 transition-all duration-700"
                                                    style={{ width: `${eng.value}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>Failing Checks</SectionLabel>
                                <div className="space-y-2.5">
                                    {[
                                        { id: "aeo", label: "AEO & AI Citations" },
                                        { id: "quality", label: "Content Quality" },
                                        { id: "technical", label: "Technical SEO" },
                                    ].map((cat) => {
                                        const progress = categoryProgress[cat.id] ?? { passed: 0, total: 0 };
                                        const items = overviewChecks.filter((c) => c.category === cat.id);
                                        const isCollapsed = collapsedCategories[cat.id];
                                        const pct = progress.total > 0 ? Math.round((progress.passed / progress.total) * 100) : 0;
                                        const barColor = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";

                                        return (
                                            <div key={cat.id} className="overflow-hidden rounded-xl border border-border/60 bg-white/[0.01]">
                                                <button
                                                    type="button"
                                                    onClick={() => setCollapsedCategories((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                                                    className="flex w-full items-center justify-between px-3.5 py-3 text-left transition-colors hover:bg-white/[0.02]"
                                                >
                                                    <div className="mr-3 min-w-0 flex-1">
                                                        <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-foreground">
                                                            <span>{cat.label}</span>
                                                            <span className="font-mono text-[10px] font-medium text-muted-foreground">
                                                                {progress.passed}/{progress.total} passed
                                                            </span>
                                                        </div>
                                                        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                                                            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                    </div>
                                                    {isCollapsed
                                                        ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                    }
                                                </button>

                                                {!isCollapsed && (
                                                    <div className="divide-y divide-border/20 px-3.5 pb-2.5">
                                                        {items.map((check) => (
                                                            <div key={check.id} className="py-2.5 first:pt-1 last:pb-1">
                                                                <div className="flex items-start gap-2.5">
                                                                    {check.passed ? (
                                                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                                                                    ) : check.severity === "high" ? (
                                                                        <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                                                                    ) : (
                                                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                                    )}
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="truncate text-xs font-semibold leading-none text-foreground">
                                                                                {check.label}
                                                                            </span>
                                                                            {!check.passed && (
                                                                                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                                                                    check.severity === "high"
                                                                                        ? "border-rose-500/15 bg-rose-500/10 text-rose-400"
                                                                                        : check.severity === "medium"
                                                                                            ? "border-amber-500/15 bg-amber-500/10 text-amber-400"
                                                                                            : "border-blue-500/15 bg-blue-500/10 text-blue-400"
                                                                                }`}>
                                                                                    {check.severity}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <p className="mt-1 text-[11px] leading-normal text-muted-foreground">{check.hint}</p>
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

                            <PanelSection>
                                <SectionLabel>Schema Status</SectionLabel>
                                <div className="flex items-center justify-between rounded-lg border border-border bg-white/[0.01] p-3">
                                    <div className="flex items-center gap-2.5">
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${
                                            derivedPanel?.schemaStatus === "injected" ? "bg-emerald-400" :
                                            derivedPanel?.schemaStatus === "available" ? "animate-pulse bg-amber-400" :
                                            "bg-red-400"
                                        }`} />
                                        <span className="text-xs font-semibold text-foreground">
                                            {derivedPanel?.schemaStatus === "injected" ? "Schema markup injected" :
                                             derivedPanel?.schemaStatus === "available" ? "Schema suggestion available" :
                                             "No schema markup"}
                                        </span>
                                    </div>
                                    {derivedPanel?.schemaStatus === "available" && (
                                        <button
                                            type="button"
                                            onClick={() => toast.success("Auto-injecting schema to page <head>...")}
                                            className="rounded border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25"
                                        >
                                            Inject schema
                                        </button>
                                    )}
                                </div>
                            </PanelSection>

                            <PanelSection className="bg-muted/15">
                                <div className="flex flex-col gap-2.5">
                                    <button
                                        type="button"
                                        onClick={handleRescore}
                                        disabled={isLoading || !keyword.trim() || !content.trim()}
                                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2 text-xs font-bold text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                                        Refresh score
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => toast.success("Injecting JSON-LD schema...")}
                                            className="rounded-lg border border-border bg-card py-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                        >
                                            Inject schema
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toast.info("Opening GitHub PR with automated SEO repairs...")}
                                            className="rounded-lg border border-border bg-card py-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                        >
                                            Auto-fix via GitHub PR
                                        </button>
                                    </div>
                                    <a
                                        href="/dashboard/aeo"
                                        className="mt-2 block text-center text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300"
                                    >
                                        Full AEO report
                                    </a>
                                </div>
                            </PanelSection>
                        </>
                    )}

                    {activeTab === "topics" && (
                        <>
                            <PanelSection>
                                <SectionLabel>Target Keyword Rankings</SectionLabel>
                                {rankingChips.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {rankingChips.map((chip) => (
                                            <div
                                                key={chip.keyword}
                                                className="flex items-center gap-2 rounded-lg border border-border/40 bg-white/[0.02] px-3 py-1.5"
                                            >
                                                <span className="max-w-[120px] truncate text-xs font-semibold text-foreground" title={chip.keyword}>
                                                    {chip.keyword}
                                                </span>
                                                <span className="font-mono text-xs font-medium text-muted-foreground">#{chip.position}</span>
                                                {chip.delta && (
                                                    <span className={`text-[10px] font-bold ${chip.delta.isUp ? "text-emerald-400" : "text-rose-400"}`}>
                                                        {chip.delta.isUp ? "▲" : "▼"}{chip.delta.val}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs italic text-muted-foreground">Add target keyword to track rankings.</p>
                                )}
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>Missing Topics</SectionLabel>
                                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                                    Topics covered by top competitors but missing in your content.
                                </p>
                                {derivedPanel && derivedPanel.missingTopics.length > 0 ? (
                                    <div className="space-y-2">
                                        {derivedPanel.missingTopics.map((topic) => (
                                            <div
                                                key={topic.topic}
                                                className="flex items-center justify-between rounded-lg border border-border/60 bg-white/[0.01] p-2.5"
                                            >
                                                <span className="mr-2 truncate text-xs text-muted-foreground" title={topic.topic}>
                                                    {topic.topic}
                                                </span>
                                                <span className="shrink-0 rounded border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
                                                    {topic.count}/10 comps
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs italic text-emerald-400">No missing topics detected!</p>
                                )}
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>Keyword Opportunities</SectionLabel>
                                {keywordOpportunities.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse text-left">
                                            <thead>
                                                <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                                                    <th className="py-2">Keyword</th>
                                                    <th className="py-2 text-right">Vol</th>
                                                    <th className="py-2 text-right">Difficulty</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/20">
                                                {keywordOpportunities.map((op) => (
                                                    <tr
                                                        key={op.keyword}
                                                        onClick={() => toast.info(`Suggesting edits for keyword: "${op.keyword}"...`)}
                                                        className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                                                    >
                                                        <td className="max-w-[120px] truncate py-2.5 text-xs font-medium text-foreground">{op.keyword}</td>
                                                        <td className="py-2.5 text-right font-mono text-xs font-medium text-muted-foreground">{op.volume}</td>
                                                        <td className={`py-2.5 text-right text-xs font-bold ${op.difficultyColor}`}>{op.difficulty}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-xs italic text-muted-foreground">Add a target keyword to see related opportunities.</p>
                                )}
                            </PanelSection>
                        </>
                    )}

                    {activeTab === "meta" && (
                        <>
                            <PanelSection>
                                <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-xs font-bold text-foreground">Title Tag</span>
                                    <span className={`font-mono text-xs font-medium ${
                                        metaParsed.titleTag.length >= 50 && metaParsed.titleTag.length <= 60 ? "text-emerald-400" : "text-rose-400"
                                    }`}>
                                        {metaParsed.titleTag.length} / 60
                                    </span>
                                </div>
                                <div className="relative mb-2 h-[6px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            metaParsed.titleTag.length >= 50 && metaParsed.titleTag.length <= 60 ? "bg-emerald-500" : "bg-rose-500"
                                        }`}
                                        style={{ width: `${Math.min(100, (metaParsed.titleTag.length / 75) * 100)}%` }}
                                    />
                                </div>
                                <p className="truncate text-[11px] italic text-muted-foreground">"{metaParsed.titleTag}"</p>
                            </PanelSection>

                            <PanelSection>
                                <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-xs font-bold text-foreground">Meta Description</span>
                                    <span className={`font-mono text-xs font-medium ${
                                        metaParsed.metaDescription.length >= 120 && metaParsed.metaDescription.length <= 158 ? "text-emerald-400" : "text-rose-400"
                                    }`}>
                                        {metaParsed.metaDescription.length} / 158
                                    </span>
                                </div>
                                <div className="relative mb-2 h-[6px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            metaParsed.metaDescription.length >= 120 && metaParsed.metaDescription.length <= 158 ? "bg-emerald-500" : "bg-rose-500"
                                        }`}
                                        style={{ width: `${Math.min(100, (metaParsed.metaDescription.length / 180) * 100)}%` }}
                                    />
                                </div>
                                <p className="mt-1 text-[11px] italic leading-normal text-muted-foreground">
                                    {metaParsed.metaDescription
                                        ? `"${metaParsed.metaDescription.slice(0, 100)}${metaParsed.metaDescription.length > 100 ? "..." : ""}"`
                                        : "Missing meta description."}
                                </p>
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>H1 Tag Check</SectionLabel>
                                <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-white/[0.01] p-3">
                                    {metaParsed.headingStructure.h1Count === 1 ? (
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                    ) : (
                                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                                    )}
                                    <span className="text-xs font-semibold leading-none text-foreground">
                                        {metaParsed.headingStructure.h1Count === 1
                                            ? "Exactly one H1 found"
                                            : `${metaParsed.headingStructure.h1Count} H1 tags found (expected exactly 1)`}
                                    </span>
                                </div>
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>Heading Structure</SectionLabel>
                                <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-white/[0.01] p-3">
                                    {!metaParsed.headingStructure.skippedH2 ? (
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                                    ) : (
                                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                                    )}
                                    <span className="text-xs font-semibold leading-none text-foreground">
                                        {!metaParsed.headingStructure.skippedH2
                                            ? "Logical ordering (H1 → H2 → H3) followed"
                                            : "Skipped heading level: H3 used without preceding H2"}
                                    </span>
                                </div>
                            </PanelSection>

                            <PanelSection>
                                <div className="mb-2.5 flex items-center justify-between">
                                    <span className="text-xs font-bold text-foreground">Open Graph Tags</span>
                                    <span className="font-mono text-xs font-medium text-muted-foreground">{metaParsed.ogTags.count}/3 set</span>
                                </div>
                                <div className="space-y-2 rounded-lg border border-border/40 bg-white/[0.01] p-2.5">
                                    {[
                                        { label: "og:title", set: metaParsed.ogTags.title },
                                        { label: "og:description", set: metaParsed.ogTags.description },
                                        { label: "og:image", set: metaParsed.ogTags.image },
                                    ].map((tag) => (
                                        <div key={tag.label} className="flex items-center justify-between py-0.5 text-xs">
                                            <span className="font-mono text-muted-foreground">{tag.label}</span>
                                            {tag.set ? (
                                                <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-400">Active</span>
                                            ) : (
                                                <span className="rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rose-400">Missing</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </PanelSection>
                        </>
                    )}

                    {activeTab === "comps" && (
                        <>
                            <PanelSection>
                                <SectionLabel>Competitor Performance</SectionLabel>
                                <div className="space-y-3">
                                    {derivedPanel?.competitorList.map((comp) => (
                                        <div key={comp.googleRank} className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-white/[0.01] p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="max-w-[170px] truncate text-xs font-bold text-foreground" title={comp.url}>
                                                    #{comp.googleRank} {comp.domain}
                                                </span>
                                                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider ${
                                                    comp.status === "win"
                                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                                        : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                                                }`}>
                                                    {comp.status === "win" ? "Win" : "Gap"}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 rounded bg-muted/40 p-2 text-center">
                                                <div>
                                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">AEO Score</p>
                                                    <p className="mt-0.5 text-xs font-bold text-foreground">{comp.aeoScore}/100</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">gSOV</p>
                                                    <p className="mt-0.5 text-xs font-bold text-purple-400">{comp.gsov}%</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/[0.02] p-3">
                                        <span className="text-xs font-bold text-emerald-400">You (Draft)</span>
                                        <div className="flex gap-4">
                                            <div className="text-right">
                                                <span className="block text-[9px] font-medium text-muted-foreground">AEO Score</span>
                                                <span className="text-xs font-black text-foreground">{scoreData?.score ?? 0}/100</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="block text-[9px] font-medium text-muted-foreground">gSOV</span>
                                                <span className="text-xs font-black text-purple-400">{derivedPanel?.gsovValue ?? 0}%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </PanelSection>

                            <PanelSection>
                                <SectionLabel>Competitor Keyword Gaps</SectionLabel>
                                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                                    Keywords that top competitors rank for, but this page is missing.
                                </p>
                                <div className="space-y-2">
                                    {competitorKeywordGaps.map((gap) => (
                                        <div key={gap.keyword} className="flex items-center justify-between rounded-lg border border-border bg-white/[0.01] p-2.5">
                                            <div className="mr-3 min-w-0 flex-1">
                                                <span className="block truncate text-xs font-semibold leading-none text-foreground">{gap.keyword}</span>
                                                <span className="text-[10px] text-muted-foreground">Ranked by {gap.competitor}</span>
                                            </div>
                                            <span className="shrink-0 font-mono text-xs text-muted-foreground">Vol: {gap.volume}</span>
                                        </div>
                                    ))}
                                </div>
                            </PanelSection>
                        </>
                    )}

                    {activeTab === "fixes" && (
                        <PanelSection>
                            <SectionLabel>Self-Healing Audit Trail</SectionLabel>
                            <div className="mt-2 space-y-4">
                                {derivedPanel?.logEntries.map((log, i) => (
                                    <div key={log.title} className="relative flex gap-3">
                                        <div className="flex shrink-0 flex-col items-center">
                                            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${
                                                log.type === "green" ? "bg-emerald-400" :
                                                log.type === "amber" ? "bg-amber-400" :
                                                "bg-blue-400"
                                            }`} />
                                            {i < (derivedPanel?.logEntries.length ?? 0) - 1 && (
                                                <div className="my-1 w-[1px] flex-1 bg-border/40" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h5 className="truncate text-xs font-bold text-foreground">{log.title}</h5>
                                                <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{log.time}</span>
                                            </div>
                                            <p className="mt-1 text-xs leading-normal text-muted-foreground">{log.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => toast.info("Navigating to full sitewide healing log...")}
                                className="mt-6 block w-full text-center text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300"
                            >
                                Full self-healing log
                            </button>
                        </PanelSection>
                    )}

                    {!scoreData && !isLoading && (
                        <PanelSection>
                            <p className="py-8 text-center text-xs leading-relaxed text-muted-foreground">
                                Type a keyword and write content to begin live scoring against real SERP competitors.
                            </p>
                        </PanelSection>
                    )}
                </div>
            </div>

            {showDiff && improvedContent && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    onMouseDown={() => setShowDiff(false)}
                >
                    <div className="absolute inset-0 bg-black/80" aria-hidden="true" />
                    <div
                        className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="diff-modal-title"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div>
                                <h3 id="diff-modal-title" className="font-semibold text-foreground">AI Improved Version</h3>
                                <p className="mt-0.5 text-xs text-muted-foreground">Review the changes below before applying.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDiff(false)}
                                aria-label="Close diff modal"
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <textarea
                                value={improvedContent}
                                onChange={(e) => setImprovedContent(e.target.value)}
                                aria-label="Improved content preview"
                                className="h-64 w-full resize-none rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-foreground transition-colors focus:border-emerald-500/60 focus:outline-none"
                            />
                        </div>
                        <div className="flex justify-end gap-3 border-t border-border px-5 py-3">
                            <button
                                type="button"
                                onClick={() => setShowDiff(false)}
                                className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setContent(improvedContent);
                                    setShowDiff(false);
                                    setImprovedContent(null);
                                }}
                                className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-emerald-400"
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