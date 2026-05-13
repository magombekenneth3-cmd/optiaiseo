"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";

const STEPS = [
    { label: "Researching keywords & SERP", pct: 15 },
    { label: "Writing draft with AI",        pct: 45 },
    { label: "Editorial & fact-check pass",  pct: 75 },
    { label: "Finalising & saving",          pct: 95 },
];

// poll cycles each step covers
const STEP_AT = [0, 3, 7, 11];

export function BlogPoller({ generatingBlogIds }: { generatingBlogIds: string[] }) {
    const router      = useRouter();
    const routerRef   = useRef(router);
    useEffect(() => { routerRef.current = router; });

    const [gaveUp, setGaveUp]       = useState(false);
    const [displayPct, setDisplayPct] = useState(0);
    const attemptRef                  = useRef(0);
    const prevLengthRef               = useRef(generatingBlogIds.length);

    useEffect(() => {
        const prev = prevLengthRef.current;
        const curr = generatingBlogIds.length;
        prevLengthRef.current = curr;

        // Went from "some generating" → "none" — jobs finished
        if (prev > 0 && curr === 0) {
            setDisplayPct(100);
            setTimeout(() => setDisplayPct(0), 600);
            toast.custom(
                (id) => (
                    <div
                        className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-card border border-emerald-500/30 shadow-2xl max-w-sm w-full cursor-pointer"
                        onClick={() => toast.dismiss(id)}
                    >
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                            <p className="text-sm font-bold text-foreground">Blog{prev > 1 ? "s" : ""} ready to review!</p>
                            <p className="text-xs text-muted-foreground">
                                {prev > 1 ? `${prev} posts are` : "Your post is"} ready for editorial review.
                            </p>
                            <Link
                                href="/dashboard/blogs"
                                onClick={() => toast.dismiss(id)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors mt-0.5"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                Review &amp; publish →
                            </Link>
                        </div>
                    </div>
                ),
                { duration: 12000 }
            );
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generatingBlogIds.length]);

    useEffect(() => {
        if (generatingBlogIds.length === 0) {
            attemptRef.current = 0;
            setGaveUp(false);
        }
    }, [generatingBlogIds.length]);

    useEffect(() => {
        if (generatingBlogIds.length === 0 || gaveUp) return;

        let timeoutId: ReturnType<typeof setTimeout>;

        function scheduleNext() {
            if (attemptRef.current >= 75) { setGaveUp(true); return; }

            timeoutId = setTimeout(() => {
                if (document.visibilityState !== "visible") { scheduleNext(); return; }
                attemptRef.current += 1;

                // Smoothly advance the progress percentage
                const stepIdx = STEP_AT.reduce(
                    (acc, min, i) => (attemptRef.current >= min ? i : acc), 0
                );
                const base    = STEPS[stepIdx].pct;
                const next    = STEPS[Math.min(stepIdx + 1, STEPS.length - 1)].pct;
                const stepRange = next - base;
                const stepsInBand = Math.max((STEP_AT[Math.min(stepIdx + 1, STEP_AT.length - 1)] ?? 75) - STEP_AT[stepIdx], 1);
                const progress = Math.min(
                    base + (stepRange * ((attemptRef.current - STEP_AT[stepIdx]) / stepsInBand)),
                    93
                );
                setDisplayPct(Math.round(progress));

                routerRef.current.refresh();
                scheduleNext();
            }, 8_000);
        }

        scheduleNext();
        return () => clearTimeout(timeoutId);
    }, [generatingBlogIds.length, gaveUp]);

    if (generatingBlogIds.length === 0) return null;

    const attempt   = attemptRef.current;
    const stepIdx   = STEP_AT.reduce((acc, min, i) => (attempt >= min ? i : acc), 0);
    const stepLabel = STEPS[stepIdx].label;

    if (gaveUp) {
        return (
            <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-sm flex items-center gap-3">
                <span className="flex-1">
                    Generation is taking longer than expected — Inngest may be offline.
                </span>
                <button
                    onClick={() => window.location.reload()}
                    className="shrink-0 underline font-semibold hover:text-amber-300 transition-colors"
                >
                    Refresh
                </button>
            </div>
        );
    }

    return (
        <div className="px-4 py-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2.5">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="relative w-5 h-5 shrink-0">
                        <svg className="w-5 h-5 text-blue-500/20" viewBox="0 0 20 20" fill="currentColor">
                            <circle cx="10" cy="10" r="10" />
                        </svg>
                        <svg className="w-5 h-5 text-blue-400 animate-spin absolute inset-0" viewBox="0 0 20 20" fill="none" strokeWidth="2">
                            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeLinecap="round"
                                strokeDasharray="26" strokeDashoffset="18" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-blue-200 font-semibold text-sm leading-none">
                            Generating {generatingBlogIds.length === 1 ? "1 post" : `${generatingBlogIds.length} posts`}
                        </p>
                        <p className="text-blue-400/70 text-xs mt-0.5">{stepLabel}</p>
                    </div>
                </div>
                <span className="text-xs font-mono font-bold text-blue-400/80 shrink-0">{displayPct}%</span>
            </div>

            {/* Animated progress bar */}
            <div className="h-1.5 rounded-full bg-blue-500/10 overflow-hidden w-full">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-[2000ms] ease-out relative overflow-hidden"
                    style={{ width: `${displayPct}%` }}
                >
                    {/* Shimmer */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                </div>
            </div>

            {/* Step dots */}
            <div className="flex items-center gap-1.5">
                {STEPS.map((s, i) => (
                    <div key={s.label} className="flex items-center gap-1.5 flex-1">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${
                            i < stepIdx  ? "bg-emerald-400" :
                            i === stepIdx ? "bg-blue-400 animate-pulse" :
                            "bg-zinc-700"
                        }`} />
                        <span className={`text-[10px] font-medium truncate transition-colors duration-500 ${
                            i < stepIdx  ? "text-emerald-400" :
                            i === stepIdx ? "text-blue-300" :
                            "text-zinc-600"
                        }`}>{s.label}</span>
                        {i < STEPS.length - 1 && <span className="text-zinc-700 text-xs shrink-0">›</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}
