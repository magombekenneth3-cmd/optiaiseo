"use client";
import React from "react";

const STEPS = [
    { label: "Fetching site pages", sub: "Discovered pages via sitemap" },
    { label: "Schema gap detection", sub: "Checking JSON-LD on all pages" },
    { label: "Checking Gemini citations", sub: "Verifying brand presence" },
    { label: "Checking Perplexity citations", sub: "Verifying citation links" },
    { label: "Checking ChatGPT mentions", sub: "Verifying response text" },
    { label: "Semantic vector analysis", sub: "Calculating concept relevance" },
    { label: "Building report", sub: "Building final insights" },
] as const;

export function ScanProgress({ currentStep }: { currentStep: number }) {
    const pct = Math.round((Math.max(1, currentStep) / STEPS.length) * 100);
    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 text-lg animate-pulse select-none">
                    ⟳
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">AI Visibility Scan Running</div>
                    <div className="text-xs text-muted-foreground">
                        Step {Math.max(1, currentStep)} of {STEPS.length} · ~45 seconds remaining
                    </div>
                </div>
                <div className="text-sm font-bold text-blue-400 tabular-nums">{pct}%</div>
            </div>

            <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>

            <div className="flex flex-col gap-2">
                {STEPS.map((s, i) => {
                    const done = currentStep > i + 1;
                    const active = currentStep === i + 1 || (currentStep === 0 && i === 0);
                    const pending = !done && !active;
                    return (
                        <div
                            key={i}
                            className={`flex items-center gap-3 transition-opacity duration-300 ${pending ? "opacity-40" : ""}`}
                        >
                            <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border font-bold shrink-0 ${
                                    done
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                        : active
                                        ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                                        : "bg-muted/30 text-muted-foreground border-border"
                                }`}
                            >
                                {done ? "✓" : i + 1}
                            </div>
                            <div className="min-w-0">
                                <p className={`text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                                    {s.label}
                                </p>
                                {(done || active) && (
                                    <p className="text-[10px] text-muted-foreground/60">{s.sub}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
