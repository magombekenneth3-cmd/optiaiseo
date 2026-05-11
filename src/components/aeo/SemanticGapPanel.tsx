"use client";

/**
 * SemanticGapPanel
 * ────────────────
 * Renders the result of performVectorGapAnalysis() from src/lib/aeo/vector-gap.ts.
 * Displayed inside the expanded SiteRow on the AEO dashboard after a full audit.
 *
 * Props:
 *   gaps — SemanticGapResult[] from AeoResult.semanticGaps (undefined = lite audit)
 *
 * Features:
 *  • Per-keyword tabs (up to 2)
 *  • Semantic coverage bar: userScore vs competitor baseline (85)
 *  • Missing concept chips
 *  • SERP feature badges (Answer Box, Local Pack, Shopping)
 *  • setupWarning banner when no SERP source is configured
 */

import { useState } from "react";
import {
    Brain, AlertTriangle, CheckCircle2, XCircle,
    ShoppingCart, MapPin, Lightbulb,
} from "lucide-react";

interface SemanticGapResult {
    keyword: string;
    userScore: number;
    competitorAvgScore: number;
    missingConcepts: string[];
    serpFeatures?: {
        hasAnswerBox: boolean;
        hasLocalPack: boolean;
        hasShopping: boolean;
    };
    setupWarning?: string;
}

interface Props {
    gaps: SemanticGapResult[] | undefined;
}

const COMPETITOR_BASELINE = 85;

function ScoreBar({
    score,
    baseline,
}: {
    score: number;
    baseline: number;
}) {
    const isAbove = score >= baseline;
    const color = isAbove
        ? "bg-emerald-500"
        : score >= 60
            ? "bg-amber-500"
            : "bg-rose-500";
    const textColor = isAbove
        ? "text-emerald-400"
        : score >= 60
            ? "text-amber-400"
            : "text-rose-400";

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Semantic coverage</span>
                <span className={`font-black tabular-nums ${textColor}`}>
                    {score}
                    <span className="text-muted-foreground font-normal"> / 100</span>
                </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted/40 overflow-hidden">
                {/* Your score */}
                <div
                    className={`h-full rounded-full transition-all duration-700 ${color}`}
                    style={{ width: `${score}%` }}
                />
                {/* Competitor baseline marker */}
                <div
                    className="absolute top-0 h-full w-0.5 bg-white/30"
                    style={{ left: `${baseline}%` }}
                    title={`Competitor average: ${baseline}`}
                />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Your content</span>
                <span>Competitor avg {baseline}</span>
            </div>
        </div>
    );
}

export function SemanticGapPanel({ gaps }: Props) {
    const [activeIdx, setActiveIdx] = useState(0);

    // Not run on lite audits
    if (!gaps || gaps.length === 0) return null;

    const active = gaps[activeIdx];

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-400 shrink-0" />
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Semantic Gap Analysis
                </p>
                <span className="text-[10px] text-muted-foreground/60 ml-auto">
                    Full audit only · powered by vector embeddings
                </span>
            </div>

            {/* Keyword tabs */}
            {gaps.length > 1 && (
                <div className="flex gap-1.5">
                    {gaps.map((g, i) => (
                        <button
                            key={g.keyword}
                            onClick={() => setActiveIdx(i)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors truncate max-w-[180px] ${
                                i === activeIdx
                                    ? "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                                    : "bg-muted/20 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                            }`}
                            title={g.keyword}
                        >
                            {g.keyword}
                        </button>
                    ))}
                </div>
            )}

            {/* Setup warning — no SERP source configured */}
            {active.setupWarning && (
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[11px] font-semibold text-amber-300 mb-0.5">
                            Analysis unavailable
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {active.setupWarning}
                        </p>
                    </div>
                </div>
            )}

            {/* Score + missing concepts (only when no warning) */}
            {!active.setupWarning && (
                <>
                    {/* Coverage bar */}
                    <div className="p-4 rounded-xl bg-muted/20 border border-border/60">
                        <ScoreBar
                            score={active.userScore}
                            baseline={COMPETITOR_BASELINE}
                        />
                    </div>

                    {/* Missing concepts */}
                    {active.missingConcepts.length > 0 ? (
                        <div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Lightbulb className="w-3 h-3 text-amber-400" />
                                Missing concepts competitors cover
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {active.missingConcepts.map((concept) => (
                                    <span
                                        key={concept}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-rose-500/10 border border-rose-500/20 text-rose-300"
                                    >
                                        <XCircle className="w-3 h-3 shrink-0" />
                                        {concept}
                                    </span>
                                ))}
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 mt-2 leading-relaxed">
                                Add these topics to your content to close the semantic gap vs top-ranking competitors.
                            </p>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-[11px] text-emerald-400">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            Your content covers all key semantic concepts for this keyword.
                        </div>
                    )}

                    {/* SERP feature badges */}
                    {active.serpFeatures && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                                SERP features:
                            </span>
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                    active.serpFeatures.hasAnswerBox
                                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                        : "bg-muted/20 border-border/40 text-muted-foreground/50"
                                }`}
                                title="Google Answer Box detected for this keyword"
                            >
                                <Brain className="w-3 h-3" />
                                Answer Box
                            </span>
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                    active.serpFeatures.hasLocalPack
                                        ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                        : "bg-muted/20 border-border/40 text-muted-foreground/50"
                                }`}
                                title="Local Pack detected for this keyword"
                            >
                                <MapPin className="w-3 h-3" />
                                Local Pack
                            </span>
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                    active.serpFeatures.hasShopping
                                        ? "bg-violet-500/10 border-violet-500/20 text-violet-400"
                                        : "bg-muted/20 border-border/40 text-muted-foreground/50"
                                }`}
                                title="Shopping results detected for this keyword"
                            >
                                <ShoppingCart className="w-3 h-3" />
                                Shopping
                            </span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
