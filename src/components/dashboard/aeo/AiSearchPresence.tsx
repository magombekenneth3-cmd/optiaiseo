"use client";
import React from "react";
import { Zap, Loader2, HelpCircle } from "lucide-react";

interface LlmModel {
    name: string;
    score: number;
}

interface AiSearchPresenceProps {
    models: LlmModel[];
    onScan: () => void;
    scanning: boolean;
}

const LLM_META: Record<string, { color: string; bg: string; ring: string; initial: string }> = {
    chatgpt:    { color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/30", initial: "G" },
    gemini:     { color: "text-blue-400",    bg: "bg-blue-500/10",    ring: "ring-blue-500/30",    initial: "G" },
    perplexity: { color: "text-purple-400",  bg: "bg-purple-500/10",  ring: "ring-purple-500/30",  initial: "P" },
    claude:     { color: "text-amber-400",   bg: "bg-amber-500/10",   ring: "ring-amber-500/30",   initial: "C" },
};

function getLlmMeta(name: string) {
    const key = name.toLowerCase();
    return (
        LLM_META[key] ??
        LLM_META[Object.keys(LLM_META).find((k) => key.includes(k)) ?? ""] ?? {
            color: "text-zinc-400",
            bg: "bg-zinc-500/10",
            ring: "ring-zinc-500/30",
            initial: name[0]?.toUpperCase() ?? "?",
        }
    );
}

// Default placeholder rows when no scan data exists
const PLACEHOLDER_MODELS: LlmModel[] = [
    { name: "ChatGPT", score: 0 },
    { name: "Gemini", score: 0 },
    { name: "Perplexity", score: 0 },
    { name: "Claude", score: 0 },
];

export function AiSearchPresence({ models, onScan, scanning }: AiSearchPresenceProps) {
    const display = models.length > 0 ? models : PLACEHOLDER_MODELS;
    const hasData = models.length > 0;

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-foreground">AI Search Presence</p>
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        Your brand's current visibility in AI platforms.
                    </p>
                </div>
            </div>

            {/* Per-LLM rows */}
            <div className="flex flex-col gap-3">
                {display.map((m) => {
                    const meta = getLlmMeta(m.name);
                    return (
                        <div key={m.name} className="flex items-center gap-3">
                            {/* LLM icon */}
                            <div
                                className={`w-7 h-7 rounded-full ring-1 ${meta.ring} ${meta.bg} flex items-center justify-center shrink-0 text-[11px] font-black ${meta.color}`}
                            >
                                {meta.initial}
                            </div>

                            {/* Name + bar */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-foreground">{m.name}</span>
                                    <span
                                        className={`text-xs font-bold tabular-nums ${
                                            m.score >= 65
                                                ? "text-emerald-400"
                                                : m.score >= 40
                                                ? "text-amber-400"
                                                : "text-muted-foreground"
                                        }`}
                                    >
                                        {m.score}%
                                    </span>
                                </div>
                                <div className="h-1 rounded-full bg-muted overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ${
                                            m.score >= 65
                                                ? "bg-emerald-500"
                                                : m.score >= 40
                                                ? "bg-amber-500"
                                                : m.score > 0
                                                ? "bg-rose-500"
                                                : "bg-muted-foreground/20"
                                        }`}
                                        style={{ width: `${Math.max(m.score, m.score > 0 ? 2 : 0)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* No data note */}
            {!hasData && (
                <p className="text-[10px] text-muted-foreground/60 text-center">
                    Run a scan to see real citation rates per AI platform.
                </p>
            )}

            {/* Scan CTA */}
            <button
                onClick={onScan}
                disabled={scanning}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/8 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/15 hover:border-emerald-500/50 active:scale-[.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {scanning ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
                ) : (
                    <><Zap className="w-4 h-4" /> Run AI Visibility Scan</>
                )}
            </button>
        </div>
    );
}
