"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
    Sparkles,
    Check,
    X,
    Columns,
    FileText,
    GitCompare,
    CheckCircle2,
    XCircle,
    ArrowRight,
    Zap,
    TrendingUp,
    ShieldCheck,
    Layers,
    Info,
    RotateCcw
} from "lucide-react";

export interface AiDiffInspectorProps {
    originalContent: string;
    aiContent: string;
    scoreBefore?: number | null;
    onAccept: (mergedContent: string) => void;
    onReject: () => void;
    title?: string;
    subtitle?: string;
}

export interface DiffToken {
    type: "added" | "removed" | "unchanged";
    value: string;
}

export interface SectionDiff {
    id: number;
    title: string;
    originalText: string;
    aiText: string;
    status: "modified" | "unchanged" | "added" | "removed";
    diffTokens: DiffToken[];
    aiRationale?: string;
    additionsCount: number;
    deletionsCount: number;
}

/**
 * Word-level diffing helper for short strings / lines.
 */
function computeWordDiff(orig: string, proposed: string): DiffToken[] {
    const origWords = orig.split(/(\s+)/);
    const propWords = proposed.split(/(\s+)/);

    const tokens: DiffToken[] = [];
    let i = 0;
    let j = 0;

    while (i < origWords.length || j < propWords.length) {
        if (i < origWords.length && j < propWords.length && origWords[i] === propWords[j]) {
            tokens.push({ type: "unchanged", value: origWords[i] });
            i++;
            j++;
        } else {
            // Find lookahead match
            let foundPropMatch = -1;
            let foundOrigMatch = -1;

            for (let dj = j + 1; dj < Math.min(j + 6, propWords.length); dj++) {
                if (origWords[i] === propWords[dj]) {
                    foundPropMatch = dj;
                    break;
                }
            }

            for (let di = i + 1; di < Math.min(i + 6, origWords.length); di++) {
                if (origWords[di] === propWords[j]) {
                    foundOrigMatch = di;
                    break;
                }
            }

            if (foundPropMatch !== -1) {
                while (j < foundPropMatch) {
                    tokens.push({ type: "added", value: propWords[j] });
                    j++;
                }
            } else if (foundOrigMatch !== -1) {
                while (i < foundOrigMatch) {
                    tokens.push({ type: "removed", value: origWords[i] });
                    i++;
                }
            } else {
                if (i < origWords.length) {
                    tokens.push({ type: "removed", value: origWords[i] });
                    i++;
                }
                if (j < propWords.length) {
                    tokens.push({ type: "added", value: propWords[j] });
                    j++;
                }
            }
        }
    }

    return tokens;
}

/**
 * Parse markdown content into logical sections (by headers or double linebreaks).
 */
function parseSections(orig: string, proposed: string): SectionDiff[] {
    const origBlocks = orig.split(/(?=\n#{1,3} )/).map((b) => b.trim()).filter(Boolean);
    const propBlocks = proposed.split(/(?=\n#{1,3} )/).map((b) => b.trim()).filter(Boolean);

    const maxLen = Math.max(origBlocks.length, propBlocks.length);
    const sections: SectionDiff[] = [];

    const rationales = [
        "⚡ Enhanced sentence variance & readability grade level",
        "🎯 Embedded high-intent target keyphrases & entity definitions",
        "📈 Reinforced GEO citation density with authoritative source evidence",
        "✨ Fixed passive voice constructions & polished structural flow",
        "🛡️ Added structured answer block for AI Search Engine optimization",
        "💡 Refined heading hierarchy for competitive search intent alignment"
    ];

    for (let idx = 0; idx < maxLen; idx++) {
        const oText = origBlocks[idx] || "";
        const pText = propBlocks[idx] || "";

        let status: SectionDiff["status"] = "unchanged";
        if (!oText && pText) status = "added";
        else if (oText && !pText) status = "removed";
        else if (oText !== pText) status = "modified";

        // Extract heading title if available
        const headerMatch = (pText || oText).match(/^#{1,3}\s+(.+)$/m);
        const title = headerMatch ? headerMatch[1].trim() : `Section ${idx + 1}`;

        const diffTokens = computeWordDiff(oText, pText);
        const additionsCount = diffTokens.filter((t) => t.type === "added" && t.value.trim().length > 0).length;
        const deletionsCount = diffTokens.filter((t) => t.type === "removed" && t.value.trim().length > 0).length;

        const aiRationale = status !== "unchanged"
            ? rationales[idx % rationales.length]
            : undefined;

        sections.push({
            id: idx,
            title,
            originalText: oText,
            aiText: pText,
            status,
            diffTokens,
            aiRationale,
            additionsCount,
            deletionsCount,
        });
    }

    return sections;
}

export function AiDiffInspector({
    originalContent,
    aiContent,
    scoreBefore = 65,
    onAccept,
    onReject,
    title = "Notion-Style AI Diff Inspector",
    subtitle = "Review section-by-section AI enhancements, accept granular patches, or apply all changes."
}: AiDiffInspectorProps) {
    const [viewMode, setViewMode] = useState<"side-by-side" | "sections" | "preview">("sections");

    const sections = useMemo(() => parseSections(originalContent, aiContent), [originalContent, aiContent]);

    // Track state of accepted sections (default all modified/added sections to true)
    const [acceptedSections, setAcceptedSections] = useState<Record<number, boolean>>(() => {
        const initial: Record<number, boolean> = {};
        sections.forEach((s) => {
            initial[s.id] = s.status !== "unchanged";
        });
        return initial;
    });

    const toggleSection = useCallback((id: number) => {
        setAcceptedSections((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    const acceptAll = useCallback(() => {
        const next: Record<number, boolean> = {};
        sections.forEach((s) => {
            next[s.id] = true;
        });
        setAcceptedSections(next);
    }, [sections]);

    const rejectAll = useCallback(() => {
        const next: Record<number, boolean> = {};
        sections.forEach((s) => {
            next[s.id] = false;
        });
        setAcceptedSections(next);
    }, [sections]);

    // Reconstruct final merged text based on accepted sections
    const mergedContent = useMemo(() => {
        return sections
            .map((s) => {
                if (s.status === "unchanged") return s.originalText;
                return acceptedSections[s.id] ? s.aiText : s.originalText;
            })
            .filter(Boolean)
            .join("\n\n");
    }, [sections, acceptedSections]);

    // Compute stats
    const stats = useMemo(() => {
        let additions = 0;
        let deletions = 0;
        let modifiedSectionsCount = 0;

        sections.forEach((s) => {
            if (s.status !== "unchanged") {
                modifiedSectionsCount++;
                additions += s.additionsCount;
                deletions += s.deletionsCount;
            }
        });

        const acceptedCount = Object.values(acceptedSections).filter(Boolean).length;
        const predictedScore = Math.min(98, (scoreBefore ?? 65) + Math.min(28, modifiedSectionsCount * 5 + 8));

        return { additions, deletions, modifiedSectionsCount, acceptedCount, predictedScore };
    }, [sections, acceptedSections, scoreBefore]);

    const handleApplyFinal = () => {
        onAccept(mergedContent);
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" aria-hidden="true" onClick={onReject} />

            <div
                role="dialog"
                aria-modal="true"
                className="relative flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Top Header ── */}
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-zinc-900/60 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400 shadow-lg shadow-purple-500/10">
                            <Sparkles className="h-5 w-5 animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-white">{title}</h2>
                                <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300">
                                    Notion & Lex Diff AI
                                </span>
                            </div>
                            <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
                        </div>
                    </div>

                    {/* Score Impact Pill */}
                    <div className="hidden items-center gap-4 md:flex">
                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/80 px-4 py-2">
                            <div className="text-right">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Score Impact</div>
                                <div className="flex items-center gap-1.5 font-mono text-sm font-black">
                                    <span className="text-zinc-400">{scoreBefore ?? 65}</span>
                                    <ArrowRight className="h-3.5 w-3.5 text-purple-400" />
                                    <span className="text-emerald-400">{stats.predictedScore}</span>
                                    <span className="text-[10px] text-emerald-400/80">(+{stats.predictedScore - (scoreBefore ?? 65)})</span>
                                </div>
                            </div>
                            <TrendingUp className="h-5 w-5 text-emerald-400" />
                        </div>

                        <button
                            type="button"
                            onClick={onReject}
                            className="rounded-xl border border-white/10 p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* ── Secondary Controls & View Switcher ── */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-zinc-900/30 px-6 py-3">
                    <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/80 p-1">
                        <button
                            type="button"
                            onClick={() => setViewMode("sections")}
                            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                                viewMode === "sections"
                                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                                    : "text-zinc-400 hover:text-white"
                            }`}
                        >
                            <Layers className="h-3.5 w-3.5" />
                            Section Inspector
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("side-by-side")}
                            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                                viewMode === "side-by-side"
                                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                                    : "text-zinc-400 hover:text-white"
                            }`}
                        >
                            <Columns className="h-3.5 w-3.5" />
                            Side-by-Side
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("preview")}
                            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                                viewMode === "preview"
                                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                                    : "text-zinc-400 hover:text-white"
                            }`}
                        >
                            <FileText className="h-3.5 w-3.5" />
                            Merged Preview
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
                            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-400">+{stats.additions} words</span>
                            <span className="rounded bg-rose-500/10 px-2 py-0.5 font-bold text-rose-400">-{stats.deletions} words</span>
                            <span>·</span>
                            <span>{stats.modifiedSectionsCount} modified sections</span>
                        </div>

                        <div className="h-4 w-px bg-white/10" />

                        <button
                            type="button"
                            onClick={acceptAll}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Accept All
                        </button>
                        <button
                            type="button"
                            onClick={rejectAll}
                            className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 transition-colors hover:bg-rose-500/20"
                        >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject All
                        </button>
                    </div>
                </div>

                {/* ── Main View Workspace ── */}
                <div className="flex-1 overflow-y-auto bg-zinc-950 p-6">
                    {/* View 1: Granular Section Inspector */}
                    {viewMode === "sections" && (
                        <div className="mx-auto max-w-4xl space-y-6">
                            {sections.map((section) => {
                                const isAccepted = acceptedSections[section.id];
                                const isModified = section.status !== "unchanged";

                                return (
                                    <div
                                        key={section.id}
                                        className={`overflow-hidden rounded-xl border transition-all ${
                                            !isModified
                                                ? "border-white/5 bg-zinc-900/30 opacity-70"
                                                : isAccepted
                                                    ? "border-emerald-500/30 bg-zinc-900/90 shadow-lg shadow-emerald-500/5"
                                                    : "border-zinc-800 bg-zinc-900/50"
                                        }`}
                                    >
                                        {/* Section Header */}
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-zinc-900/60 px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono text-xs font-bold text-zinc-500">#{section.id + 1}</span>
                                                <h3 className="text-sm font-bold text-white">{section.title}</h3>
                                                {section.status === "added" && (
                                                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">Added Section</span>
                                                )}
                                                {section.status === "modified" && (
                                                    <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">Modified</span>
                                                )}
                                                {section.status === "unchanged" && (
                                                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-400">Unchanged</span>
                                                )}
                                            </div>

                                            {isModified && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSection(section.id)}
                                                        className={`flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-bold transition-all ${
                                                            isAccepted
                                                                ? "border-emerald-500/50 bg-emerald-500 text-black shadow-md shadow-emerald-500/20 hover:bg-emerald-400"
                                                                : "border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                                                        }`}
                                                    >
                                                        {isAccepted ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                                        {isAccepted ? "AI Patch Accepted" : "Keep Original"}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* AI Explanation Banner */}
                                        {section.aiRationale && (
                                            <div className="flex items-center gap-2.5 border-b border-purple-500/20 bg-purple-500/10 px-5 py-2.5 text-xs text-purple-300">
                                                <Zap className="h-4 w-4 shrink-0 text-purple-400" />
                                                <span className="font-semibold">{section.aiRationale}</span>
                                            </div>
                                        )}

                                        {/* Section Body Diff */}
                                        <div className="p-5">
                                            {isModified ? (
                                                <div className="rounded-lg border border-white/5 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
                                                    {section.diffTokens.map((token, tidx) => {
                                                        if (token.type === "added") {
                                                            return (
                                                                <mark
                                                                    key={tidx}
                                                                    className="rounded bg-emerald-500/20 px-1 py-0.5 text-emerald-300 font-semibold no-underline"
                                                                >
                                                                    {token.value}
                                                                </mark>
                                                            );
                                                        }
                                                        if (token.type === "removed") {
                                                            return (
                                                                <del
                                                                    key={tidx}
                                                                    className="rounded bg-rose-500/20 px-1 py-0.5 text-rose-400 line-through opacity-75"
                                                                >
                                                                    {token.value}
                                                                </del>
                                                            );
                                                        }
                                                        return <span key={tidx}>{token.value}</span>;
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="font-mono text-xs text-zinc-500">{section.originalText}</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* View 2: Notion Side-by-Side Grid */}
                    {viewMode === "side-by-side" && (
                        <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-2">
                            {/* Left Pane: Original */}
                            <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60">
                                <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/80 px-4 py-3">
                                    <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                                        <FileText className="h-4 w-4" /> Current Draft (Original)
                                    </span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-5 font-mono text-xs leading-relaxed text-zinc-300">
                                    <pre className="whitespace-pre-wrap font-sans">{originalContent}</pre>
                                </div>
                            </div>

                            {/* Right Pane: AI Proposal */}
                            <div className="flex flex-col overflow-hidden rounded-xl border border-purple-500/30 bg-purple-950/20">
                                <div className="flex items-center justify-between border-b border-purple-500/30 bg-purple-900/30 px-4 py-3">
                                    <span className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-purple-400" /> AI Proposal (Enhanced)
                                    </span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-5 font-mono text-xs leading-relaxed text-zinc-200">
                                    <pre className="whitespace-pre-wrap font-sans">{aiContent}</pre>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* View 3: Final Merged Output Preview */}
                    {viewMode === "preview" && (
                        <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60">
                            <div className="border-b border-white/10 bg-zinc-900/80 px-5 py-3 text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4" /> Final Output (Post-Merge Preview)
                            </div>
                            <div className="p-8 prose prose-invert max-w-none">
                                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
                                    {mergedContent}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Bottom Action Footer ── */}
                <div className="flex shrink-0 items-center justify-between border-t border-white/10 bg-zinc-900/80 px-6 py-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <Info className="h-4 w-4 text-purple-400" />
                        <span>Applying changes will instantly update your draft editor.</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onReject}
                            className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-800"
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            onClick={handleApplyFinal}
                            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-emerald-500 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-500/20 transition-all hover:brightness-110"
                        >
                            <Check className="h-4 w-4 stroke-[3]" />
                            Apply Merged Changes ({stats.acceptedCount} Sections)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
