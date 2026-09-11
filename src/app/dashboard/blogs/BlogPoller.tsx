"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

const STEP_AT = [0, 3, 7, 11];
const MAX_ATTEMPTS = 75;
const POLL_INTERVAL_MS = 8_000;

function computeProgress(attempt: number): number {
    const stepIdx = STEP_AT.reduce((acc, min, i) => (attempt >= min ? i : acc), 0);
    const base      = STEPS[stepIdx].pct;
    const next      = STEPS[Math.min(stepIdx + 1, STEPS.length - 1)].pct;
    const stepRange = next - base;
    const nextAt    = STEP_AT[Math.min(stepIdx + 1, STEP_AT.length - 1)] ?? MAX_ATTEMPTS;
    const stepsInBand = Math.max(nextAt - STEP_AT[stepIdx], 1);
    return Math.min(
        base + stepRange * ((attempt - STEP_AT[stepIdx]) / stepsInBand),
        93
    );
}

function computeStepIdx(attempt: number): number {
    return STEP_AT.reduce((acc, min, i) => (attempt >= min ? i : acc), 0);
}

export function BlogPoller({ generatingBlogIds }: { generatingBlogIds: string[] }) {
    const router = useRouter();

    const [gaveUp, setGaveUp]           = useState(false);
    const [displayPct, setDisplayPct]   = useState(0);
    const attemptRef                    = useRef(0);
    const prevLengthRef                 = useRef(generatingBlogIds.length);
    const resetTimerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Detect transition from "generating" → "done"
    useEffect(() => {
        const prev = prevLengthRef.current;
        const curr = generatingBlogIds.length;
        prevLengthRef.current = curr;

        if (prev > 0 && curr === 0) {
            setDisplayPct(100);
            resetTimerRef.current = setTimeout(() => setDisplayPct(0), 600);

            toast.custom(
                (id) => (
                    <div
                        className="flex w-full max-w-sm cursor-pointer items-start gap-3 rounded-2xl border border-emerald-500/30 bg-card px-4 py-3 shadow-2xl"
                        onClick={() => toast.dismiss(id)}
                    >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-sm font-bold text-foreground">
                                Blog{prev > 1 ? "s" : ""} ready to review!
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {prev > 1 ? `${prev} posts are` : "Your post is"} ready for editorial review.
                            </p>
                            <Link
                                href="/dashboard/blogs"
                                onClick={() => toast.dismiss(id)}
                                className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                            >
                                <FileText className="h-3.5 w-3.5" />
                                Review &amp; publish →
                            </Link>
                        </div>
                    </div>
                ),
                { duration: 12000 }
            );
        }

        if (curr === 0) {
            attemptRef.current = 0;
            setGaveUp(false);
        }
    }, [generatingBlogIds.length]);

    // Cleanup the 600ms display reset timer on unmount
    useEffect(() => {
        return () => {
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        };
    }, []);

    // Polling loop via setInterval
    useEffect(() => {
        if (generatingBlogIds.length === 0 || gaveUp) return;

        const id = setInterval(() => {
            if (document.visibilityState !== "visible") return;

            attemptRef.current += 1;

            if (attemptRef.current >= MAX_ATTEMPTS) {
                setGaveUp(true);
                clearInterval(id);
                return;
            }

            setDisplayPct(Math.round(computeProgress(attemptRef.current)));
            router.refresh();
        }, POLL_INTERVAL_MS);

        return () => clearInterval(id);
    }, [generatingBlogIds.length, gaveUp, router]);

    const handleRefresh = useCallback(() => window.location.reload(), []);

    if (generatingBlogIds.length === 0) return null;

    const stepIdx   = computeStepIdx(attemptRef.current);
    const stepLabel = STEPS[stepIdx].label;

    if (gaveUp) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                <span className="flex-1">
                    Generation is taking longer than expected — Inngest may be offline.
                </span>
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="shrink-0 font-semibold underline transition-colors hover:text-amber-300"
                >
                    Refresh
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="relative h-5 w-5 shrink-0">
                        <svg className="h-5 w-5 text-blue-500/20" viewBox="0 0 20 20" fill="currentColor">
                            <circle cx="10" cy="10" r="10" />
                        </svg>
                        <svg
                            className="absolute inset-0 h-5 w-5 animate-spin text-blue-400"
                            viewBox="0 0 20 20"
                            fill="none"
                            strokeWidth="2"
                        >
                            <circle
                                cx="10" cy="10" r="8"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeDasharray="26"
                                strokeDashoffset="18"
                            />
                        </svg>
                    </div>
                    <div>
                        <p className="text-sm font-semibold leading-none text-blue-200">
                            Generating {generatingBlogIds.length === 1 ? "1 post" : `${generatingBlogIds.length} posts`}
                        </p>
                        <p className="mt-0.5 text-xs text-blue-400/70">{stepLabel}</p>
                    </div>
                </div>
                <span className="shrink-0 font-mono text-xs font-bold text-blue-400/80">{displayPct}%</span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-500/10">
                <div
                    className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-[2000ms] ease-out"
                    style={{ width: `${displayPct}%` }}
                >
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                {STEPS.map((s, i) => (
                    <div key={s.label} className="flex flex-1 items-center gap-1.5">
                        <div className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500 ${
                            i < stepIdx  ? "bg-emerald-400"                  :
                            i === stepIdx ? "animate-pulse bg-blue-400"       :
                            "bg-muted-foreground/30"
                        }`} />
                        <span className={`truncate text-[10px] font-medium transition-colors duration-500 ${
                            i < stepIdx  ? "text-emerald-400"          :
                            i === stepIdx ? "text-blue-300"             :
                            "text-muted-foreground/50"
                        }`}>
                            {s.label}
                        </span>
                        {i < STEPS.length - 1 && (
                            <span className="shrink-0 text-xs text-muted-foreground/30">›</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
