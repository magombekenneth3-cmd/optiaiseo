"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCircle2, Circle, Loader2, AlertTriangle, Clock3, ArrowRight } from "lucide-react";
import Link from "next/link";

/* ── Step definitions ──────────────────────────────────────────────── */

const STEPS = [
    { key: "researching", label: "Research",  detail: "Analyzing keywords & SERP competitors" },
    { key: "drafting",    label: "Draft",     detail: "Writing article content" },
    { key: "fact_check",  label: "Evidence",  detail: "Fact-checking & evidence validation" },
    { key: "schema",      label: "Editorial", detail: "Schema markup & publication gate" },
    { key: "widget",      label: "Finalize",  detail: "Interactive widget & saving" },
] as const;

type StepKey = typeof STEPS[number]["key"];

const STEP_ORDER: StepKey[] = STEPS.map(s => s.key);

function stepIndex(step: string): number {
    const idx = STEP_ORDER.indexOf(step as StepKey);
    return idx >= 0 ? idx : 0;
}

function computePercent(step: string): number {
    const idx = stepIndex(step);
    // 0→10, 1→35, 2→60, 3→80, 4→93
    const map = [10, 35, 60, 80, 93];
    return map[idx] ?? 10;
}

/* ── Main component ────────────────────────────────────────────────── */

interface GeneratingBlog {
    id: string;
    title?: string;
    targetKeywords?: string[];
    createdAt: string | Date;
}

export function ActiveGenerationCard({
    generatingBlogs,
}: {
    generatingBlogs: GeneratingBlog[];
}) {
    const blog = generatingBlogs[0]; // Show the first generating blog
    if (!blog) return null;

    return <GenerationTracker blog={blog} totalCount={generatingBlogs.length} />;
}

function GenerationTracker({
    blog,
    totalCount,
}: {
    blog: GeneratingBlog;
    totalCount: number;
}) {
    const [step, setStep] = useState<string>("researching");
    const [failReason, setFailReason] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const lastChangeRef = useRef(Date.now());
    const prevStepRef = useRef("researching");

    // Poll status every 3 seconds
    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await fetch(`/api/blogs/${blog.id}/status`);
                if (!res.ok || cancelled) return;
                const data = await res.json() as {
                    status: string;
                    generationStep?: string;
                    failReason?: string;
                };
                if (data.status === "FAILED") {
                    setFailed(true);
                    setFailReason(data.failReason ?? null);
                    return;
                }
                if (data.status !== "GENERATING" && data.status !== "QUEUED" && data.status !== "PENDING") {
                    // Generation finished — let BlogPoller handle the toast
                    return;
                }
                const newStep = data.generationStep ?? "researching";
                if (newStep !== prevStepRef.current) {
                    prevStepRef.current = newStep;
                    lastChangeRef.current = Date.now();
                }
                setStep(newStep);
            } catch {
                // Network error — keep polling
            }
        };

        poll();
        const id = setInterval(poll, 3000);
        return () => { cancelled = true; clearInterval(id); };
    }, [blog.id]);

    // Track elapsed time since last step change
    useEffect(() => {
        const id = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - lastChangeRef.current) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const currentIdx = stepIndex(step);
    const percent = computePercent(step);
    const stalled = elapsedSec > 120; // 2 minutes without progress
    const title = blog.title || blog.targetKeywords?.[0] || "Generating article";
    const keyword = blog.targetKeywords?.[0] ?? "";

    if (failed) {
        return (
            <div className="flex-1 rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-5">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-red-300">Generation failed</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Credits have been refunded</p>
                    </div>
                </div>
                {failReason && (
                    <p className="mt-3 rounded-xl border border-red-500/10 bg-red-500/5 px-3 py-2 text-xs leading-5 text-red-300/80">
                        {failReason}
                    </p>
                )}
                <p className="mt-3 text-xs text-muted-foreground line-clamp-1">{title}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 rounded-2xl border border-border bg-card/40 p-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{title}</p>
                        {keyword && (
                            <p className="mt-0.5 text-xs text-muted-foreground truncate">{keyword}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                        Writing
                    </span>
                    <span className="font-mono text-xs font-bold text-blue-400/80">{percent}%</span>
                    {elapsedSec > 30 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                            <Clock3 className="h-3 w-3" />
                            ~{Math.max(1, Math.ceil((100 - percent) / 15))}m left
                        </span>
                    )}
                </div>
            </div>

            {/* Pipeline steps */}
            <div className="mt-5 flex items-center gap-1">
                {STEPS.map((s, idx) => {
                    const done = idx < currentIdx;
                    const active = idx === currentIdx;
                    return (
                        <div key={s.key} className="flex flex-1 items-center gap-1.5">
                            {idx > 0 && (
                                <div className={`h-px flex-1 transition-colors duration-500 ${
                                    done ? "bg-emerald-500/40" : "bg-border"
                                }`} />
                            )}
                            <div className="flex flex-col items-center gap-1">
                                <div className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-500 ${
                                    done
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : active
                                            ? "border-2 border-blue-400/50 bg-blue-500/10 text-blue-400"
                                            : "border border-border bg-muted text-muted-foreground/40"
                                }`}>
                                    {done ? (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                    ) : active ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <Circle className="h-3 w-3" />
                                    )}
                                </div>
                                <span className={`text-[10px] font-medium leading-none transition-colors duration-500 ${
                                    done
                                        ? "text-emerald-400"
                                        : active
                                            ? "text-blue-300"
                                            : "text-muted-foreground/40"
                                }`}>
                                    {s.label}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                <div
                    className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-[2000ms] ease-out"
                    style={{ width: `${percent}%` }}
                >
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
            </div>

            {/* Current task / stalled warning */}
            <div className="mt-3 flex items-center justify-between">
                {stalled ? (
                    <div className="flex items-center gap-2 text-xs text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        <span>
                            No response for {elapsedSec}s — still processing
                        </span>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60">Current task: </span>
                        {STEPS[currentIdx]?.detail ?? "Processing..."}
                    </p>
                )}
                <Link
                    href={`/dashboard/blogs/generating/${blog.id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 transition-colors hover:text-blue-300"
                >
                    View draft
                    <ArrowRight className="h-3 w-3" />
                </Link>
            </div>

            {/* Multiple blogs indicator */}
            {totalCount > 1 && (
                <p className="mt-2 text-[10px] text-muted-foreground/50">
                    + {totalCount - 1} more article{totalCount - 1 > 1 ? "s" : ""} generating
                </p>
            )}
        </div>
    );
}
