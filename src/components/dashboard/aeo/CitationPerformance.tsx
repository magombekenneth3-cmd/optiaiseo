"use client";
import React from "react";
import { ArrowRight } from "lucide-react";

interface LlmCitation {
    modelName: string;
    citationRate: number;
    citationCount: number;
    queriesRun: number;
}

interface CitationPerformanceProps {
    models: LlmCitation[];
    lastScanAt?: string | null;
    onViewEvidence?: () => void;
}

const LLM_META: Record<string, { initial: string; color: string; bg: string; ring: string; barColor: string }> = {
    chatgpt:    { initial: "G", color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/25", barColor: "bg-emerald-500" },
    gemini:     { initial: "G", color: "text-blue-400",    bg: "bg-blue-500/10",    ring: "ring-blue-500/25",    barColor: "bg-blue-500" },
    perplexity: { initial: "P", color: "text-purple-400",  bg: "bg-purple-500/10",  ring: "ring-purple-500/25",  barColor: "bg-purple-500" },
    claude:     { initial: "C", color: "text-amber-400",   bg: "bg-amber-500/10",   ring: "ring-amber-500/25",   barColor: "bg-amber-400" },
};

const PLACEHOLDER: LlmCitation[] = [
    { modelName: "ChatGPT",    citationRate: 0, citationCount: 0, queriesRun: 120 },
    { modelName: "Gemini",     citationRate: 0, citationCount: 0, queriesRun: 120 },
    { modelName: "Perplexity", citationRate: 0, citationCount: 0, queriesRun: 120 },
    { modelName: "Claude",     citationRate: 0, citationCount: 0, queriesRun: 120 },
];

function getMeta(modelName: string) {
    const key = modelName.toLowerCase();
    return (
        LLM_META[key] ??
        LLM_META[Object.keys(LLM_META).find((k) => key.includes(k)) ?? ""] ?? {
            initial: modelName[0]?.toUpperCase() ?? "?",
            color: "text-zinc-400",
            bg: "bg-zinc-500/10",
            ring: "ring-zinc-500/25",
            barColor: "bg-zinc-500",
        }
    );
}

export function CitationPerformance({ models, lastScanAt, onViewEvidence }: CitationPerformanceProps) {
    const display = models.length > 0 ? models : PLACEHOLDER;
    const hasData = models.length > 0;
    const totalQueries = display.reduce((s, m) => s + (m.queriesRun ?? 0), 0);
    const platforms = display.length;

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-sm font-bold text-foreground">Citation Performance</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        How often your brand is cited across AI platforms (last 7 days).
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {hasData && (
                        <span className="text-[10px] text-muted-foreground">
                            {totalQueries} queries · {platforms} platforms · 7 days
                        </span>
                    )}
                    {onViewEvidence && (
                        <button
                            onClick={onViewEvidence}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            View evidence <ArrowRight className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Per-model grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {display.map((m) => {
                    const meta = getMeta(m.modelName);
                    return (
                        <div
                            key={m.modelName}
                            className="rounded-xl border border-border/60 bg-muted/10 p-4 flex flex-col gap-2"
                        >
                            {/* Icon + name */}
                            <div className="flex items-center gap-2">
                                <div
                                    className={`w-6 h-6 rounded-full ring-1 ${meta.ring} ${meta.bg} ${meta.color} flex items-center justify-center text-[10px] font-black shrink-0`}
                                >
                                    {meta.initial}
                                </div>
                                <span className="text-xs font-medium text-foreground truncate">{m.modelName}</span>
                            </div>

                            {/* Rate */}
                            <span
                                className={`text-2xl font-black tabular-nums leading-none ${
                                    m.citationRate >= 65
                                        ? "text-emerald-400"
                                        : m.citationRate >= 40
                                        ? "text-amber-400"
                                        : "text-muted-foreground"
                                }`}
                            >
                                {m.citationRate}%
                            </span>

                            {/* Progress bar */}
                            <div className="h-1 rounded-full bg-muted overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${
                                        m.citationRate > 0 ? meta.barColor : "bg-muted-foreground/20"
                                    }`}
                                    style={{ width: `${Math.max(m.citationRate, m.citationRate > 0 ? 2 : 0)}%` }}
                                />
                            </div>

                            {/* Count */}
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                                {m.citationCount ?? 0}/{m.queriesRun ?? 0} citations
                            </span>
                        </div>
                    );
                })}
            </div>

            {!hasData && (
                <p className="text-[11px] text-muted-foreground/60 text-center">
                    Run an AI Visibility Scan to see real citation data.
                </p>
            )}
        </div>
    );
}
