"use client";

import { AlertTriangle, Ban, X, Sparkles } from "lucide-react";
import type { SerpGateDecision } from "@/lib/blog/serp-gate";

interface SerpGateBannerProps {
    decision: SerpGateDecision;
    keyword: string;
    onConfirm: () => void;    // proceed despite WARN
    onCancel: () => void;     // dismiss without generating
}

/**
 * Shown when the SERP pre-gate returns WARN or BLOCK.
 * WARN  → shows the reason + format hint + confirm/cancel buttons.
 * BLOCK → shows the reason only, no confirm button.
 */
export function SerpGateBanner({
    decision,
    keyword,
    onConfirm,
    onCancel,
}: SerpGateBannerProps) {
    if (decision.verdict === "ALLOW" || decision.verdict === "SKIP") return null;

    const isBlock = decision.verdict === "BLOCK";
    const reason  = "reason" in decision ? decision.reason : "";
    const hint    = "hint"   in decision ? decision.hint   : "";
    const format  = "format" in decision ? decision.format : "";

    const FORMAT_LABELS: Record<string, string> = {
        tool:       "Interactive Tool",
        listicle:   "Listicle",
        comparison: "Comparison",
        guide:      "How-To Guide",
        product:    "Buying Guide",
        video:      "Video",
        general:    "General",
    };

    return (
        <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="serp-gate-title"
            className={`
                relative rounded-xl border p-4 text-sm
                ${isBlock
                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"}
            `}
        >
            {/* Header */}
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${isBlock ? "bg-red-500/20" : "bg-amber-500/20"}`}>
                    {isBlock
                        ? <Ban className="h-4 w-4 text-red-400" />
                        : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                </div>

                <div className="min-w-0 flex-1">
                    <p
                        id="serp-gate-title"
                        className={`font-semibold ${isBlock ? "text-red-300" : "text-amber-300"}`}
                    >
                        {isBlock
                            ? "Generation blocked — SERP format mismatch"
                            : "SERP format mismatch — confirm to proceed"}
                    </p>

                    {format && (
                        <p className="mt-0.5 text-[11px] uppercase tracking-widest opacity-60">
                            Keyword: <span className="font-semibold">"{keyword}"</span>
                            {" · "}Detected format: <span className="font-semibold">{FORMAT_LABELS[format] ?? format}</span>
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Dismiss"
                    className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Reason */}
            {reason && (
                <p className="mt-3 text-[13px] leading-relaxed opacity-80">
                    {reason}
                </p>
            )}

            {/* Hint */}
            {hint && !isBlock && (
                <div className={`mt-3 rounded-lg border p-3 text-[12px] leading-relaxed border-amber-500/20 bg-amber-500/5 text-amber-300`}>
                    <span className="font-semibold">Recommended: </span>
                    {hint}
                </div>
            )}

            {/* Actions */}
            {!isBlock && (
                <div className="mt-4 flex items-center gap-2">
                    <button
                        type="button"
                        id="serp-gate-confirm"
                        onClick={onConfirm}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-all hover:bg-amber-500/25"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        Generate anyway
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold opacity-60 transition-opacity hover:opacity-100"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}
