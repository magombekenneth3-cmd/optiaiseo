"use client";

import { useEffect, useRef, useState } from "react";
import {
    CheckCircle2,
    Circle,
    Loader2,
    AlertTriangle,
    Clock3,
    ArrowRight,
    Sparkles,
} from "lucide-react";
import Link from "next/link";

/* ── Step definitions ──────────────────────────────────────────────── */

const STEPS = [
    { key: "researching", label: "Research",  detail: "Analyzing keywords & SERP competitors" },
    { key: "drafting",    label: "Draft",     detail: "Writing introduction and comparison sections..." },
    { key: "fact_check",  label: "Evidence",  detail: "Fact-checking & evidence validation" },
    { key: "schema",      label: "Editorial", detail: "Schema markup & publication gate" },
    { key: "widget",      label: "Publish",   detail: "Saving & publishing content" },
] as const;

type StepKey = typeof STEPS[number]["key"];

const STEP_ORDER: StepKey[] = STEPS.map(s => s.key);

function stepIndex(step: string): number {
    const idx = STEP_ORDER.indexOf(step as StepKey);
    return idx >= 0 ? idx : 0;
}

function computePercent(step: string): number {
    const idx = stepIndex(step);
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
    const blog = generatingBlogs[0];
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

    // Track elapsed time
    useEffect(() => {
        const id = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - lastChangeRef.current) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    const currentIdx = stepIndex(step);
    const percent = computePercent(step);
    const stalled = elapsedSec > 120;
    const title = blog.title || blog.targetKeywords?.[0] || "Generating article";
    const keyword = blog.targetKeywords?.[0] ?? "";
    const estMinutes = Math.max(1, Math.ceil((100 - percent) / 15));

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
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-300">
                        <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm font-bold text-foreground">Active Generation</span>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                        Writing
                    </span>
                    <span className="font-mono text-xs font-bold text-blue-400/80">{percent}%</span>
                    {elapsedSec > 20 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                            <Clock3 className="h-3 w-3" />
                            ~{estMinutes} min left
                        </span>
                    )}
                </div>
            </div>

            {/* Content area — article info + steps side by side */}
            <div className="mt-4 flex gap-5">
                {/* Left — Article thumbnail + title */}
                <div className="flex gap-3.5 min-w-0 flex-1">
                    {/* Thumbnail placeholder with SEO badge */}
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-emerald-900/30 to-card">
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-400">
                                SEO
                            </span>
                        </div>
                    </div>

                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{title}</p>
                        {keyword && (
                            <p className="mt-1 text-xs text-muted-foreground truncate">{keyword}</p>
                        )}

                        {/* Step list */}
                        <div className="mt-3 space-y-1">
                            {STEPS.map((s, idx) => {
                                const done = idx < currentIdx;
                                const active = idx === currentIdx;
                                return (
                                    <div key={s.key} className="flex items-center gap-2">
                                        {done ? (
                                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                                        ) : active ? (
                                            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-400" />
                                        ) : (
                                            <Circle className="h-3 w-3 shrink-0 text-muted-foreground/30" />
                                        )}
                                        <span className={`text-xs ${
                                            done ? "text-muted-foreground" :
                                            active ? "font-medium text-foreground" :
                                            "text-muted-foreground/40"
                                        }`}>
                                            {s.label}
                                        </span>
                                        <span className={`ml-auto text-[10px] ${
                                            done ? "text-emerald-400" :
                                            active ? "text-blue-300" :
                                            "text-muted-foreground/30"
                                        }`}>
                                            {done ? "✓ Complete" : active ? `● ${s.detail.split(" ").slice(0, 3).join(" ")}...` : "○ Pending"}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right — Current task card */}
                <div className="hidden lg:flex w-48 shrink-0 flex-col justify-between rounded-xl border border-border bg-muted/20 p-3.5">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">Current task</p>
                        <p className="mt-1.5 text-xs leading-5 text-foreground/80">
                            {STEPS[currentIdx]?.detail ?? "Processing..."}
                        </p>
                    </div>
                    <Link
                        href={`/dashboard/blogs/generating/${blog.id}`}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                        View draft
                        <ArrowRight className="h-3 w-3" />
                    </Link>
                </div>
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

            {/* Stall warning */}
            {stalled && (
                <div className="mt-2 flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span>No response for {elapsedSec}s — still processing</span>
                </div>
            )}

            {/* Multiple blogs indicator */}
            {totalCount > 1 && (
                <p className="mt-2 text-[10px] text-muted-foreground/50">
                    + {totalCount - 1} more article{totalCount - 1 > 1 ? "s" : ""} generating
                </p>
            )}
        </div>
    );
}
