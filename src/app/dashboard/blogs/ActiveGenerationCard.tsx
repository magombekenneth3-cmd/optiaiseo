"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
    CheckCircle2,
    Circle,
    Loader2,
    AlertTriangle,
    Clock3,
    ArrowRight,
    Sparkles,
    Terminal,
    Zap,
    Search,
    ListTree,
    ShieldCheck,
    FileText,
    Bot,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import Link from "next/link";

/* ── Step definitions ──────────────────────────────────────────────── */
// Matches the keys written to Redis by the Inngest pipeline mark-step-* steps
const STEPS = [
    { key: "researching", label: "Research", icon: Search, detail: "Analyzing GSC search intent & competitor structures" },
    { key: "drafting", label: "Structure", icon: ListTree, detail: "Constructing H2/H3 outline & GEO question nodes" },
    { key: "editorial", label: "E-E-A-T Engine", icon: Bot, detail: "Claude humanisation & verbatim experience injection" },
    { key: "fact_check", label: "Evidence Check", icon: ShieldCheck, detail: "Fact-checking claims & verifying citation provenance" },
    { key: "schema", label: "Citation Audit", icon: FileText, detail: "Auditing Speakable JSON-LD & AI Overview readiness" },
    { key: "widget", label: "Publishing Gate", icon: Zap, detail: "Persisting draft & preparing syndication assets" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
const STEP_ORDER: StepKey[] = STEPS.map((s) => s.key);

function stepIndex(step: string): number {
    const idx = STEP_ORDER.indexOf(step as StepKey);
    return idx >= 0 ? idx : 0;
}

function computePercent(step: string): number {
    const idx = stepIndex(step);
    const map = [12, 32, 58, 76, 90, 98];
    return map[idx] ?? 12;
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

    return <GenerationTracker blog={blog} allBlogs={generatingBlogs} />;
}

function GenerationTracker({
    blog,
    allBlogs,
}: {
    blog: GeneratingBlog;
    allBlogs: GeneratingBlog[];
}) {
    const [step, setStep] = useState<string>("researching");
    const [failReason, setFailReason] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [showTerminal, setShowTerminal] = useState(true);
    const [logs, setLogs] = useState<{ id: string; time: string; text: string; type: "info" | "success" | "warn" }[]>([]);

    const lastChangeRef = useRef(Date.now());
    const prevStepRef = useRef("researching");

    // Add log entry
    const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setLogs((prev) => [...prev.slice(-15), { id: Math.random().toString(), time, text, type }]);
    };

    // Poll status every 3 seconds
    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await fetch(`/api/blogs/${blog.id}/status`);
                if (!res.ok || cancelled) return;
                const data = (await res.json()) as {
                    status: string;
                    generationStep?: string;
                    failReason?: string;
                };

                if (data.status === "FAILED") {
                    setFailed(true);
                    setFailReason(data.failReason ?? null);
                    addLog(`[ERROR] Generation failed: ${data.failReason ?? "Unknown failure"}`, "warn");
                    return;
                }

                if (data.status !== "GENERATING" && data.status !== "QUEUED" && data.status !== "PENDING") {
                    return;
                }

                const newStep = data.generationStep ?? "researching";
                if (newStep !== prevStepRef.current) {
                    const stepObj = STEPS.find((s) => s.key === newStep);
                    if (stepObj) {
                        addLog(`[STEP] Advanced to ${stepObj.label}: ${stepObj.detail}`, "success");
                    }
                    prevStepRef.current = newStep;
                    lastChangeRef.current = Date.now();
                }
                setStep(newStep);
            } catch {
                // Network error — keep polling
            }
        };

        // Initial logs
        setLogs([
            { id: "1", time: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }), text: `[INIT] Initialized Lex AI Pipeline for topic: "${blog.title || blog.targetKeywords?.[0] || "Blog Post"}"`, type: "info" },
            { id: "2", time: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }), text: `[SERP] Crawling competitor H2 structures & GSC intent gaps...`, type: "info" },
        ]);

        poll();
        const id = setInterval(poll, 3000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [blog.id, blog.title, blog.targetKeywords]);

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
            <div className="flex-1 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
                        <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-base font-bold text-rose-300">Generation Pipeline Interrupted</p>
                        <p className="mt-0.5 text-xs text-zinc-400">Credits automatically refunded to your account</p>
                    </div>
                </div>
                {failReason && (
                    <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-relaxed font-mono text-rose-300">
                        {failReason}
                    </p>
                )}
                <p className="mt-3 text-xs font-semibold text-zinc-400 line-clamp-1">{title}</p>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-hidden rounded-2xl border border-purple-500/30 bg-zinc-950/90 shadow-2xl shadow-purple-500/10 backdrop-blur-xl">
            {/* Top Telemetry Banner Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-zinc-900/80 px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/40 bg-purple-500/15 text-purple-400 shadow-lg shadow-purple-500/20">
                        <Sparkles className="h-5 w-5 animate-pulse" />
                        <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-white">Live AI Generation Telemetry</h3>
                            <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300">
                                Active Pipeline
                            </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-semibold text-zinc-400">{title}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Total Completion</div>
                        <div className="font-mono text-lg font-black text-purple-400">{percent}%</div>
                    </div>

                    <div className="h-8 w-px bg-white/10" />

                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
                        <Clock3 className="h-4 w-4 text-purple-400" />
                        <span>~{estMinutes}m remaining</span>
                    </div>

                    <Link
                        href={`/dashboard/blogs/generating/${blog.id}`}
                        className="flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-600/20 px-4 py-2 text-xs font-bold text-purple-200 transition-colors hover:bg-purple-600/30"
                    >
                        View Stream Draft
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </div>

            {/* Glowing Progress Bar */}
            <div className="h-1.5 w-full bg-zinc-900">
                <div
                    className="relative h-full bg-gradient-to-r from-purple-600 via-pink-500 to-emerald-400 transition-all duration-1000 ease-out"
                    style={{ width: `${percent}%` }}
                >
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                </div>
            </div>

            {/* Stage-by-Stage Radar Grid */}
            <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-6">
                {STEPS.map((s, idx) => {
                    const done = idx < currentIdx;
                    const active = idx === currentIdx;
                    const Icon = s.icon;

                    return (
                        <div
                            key={s.key}
                            className={`flex flex-col justify-between rounded-xl border p-3.5 transition-all ${
                                done
                                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                                    : active
                                        ? "border-purple-500/50 bg-purple-500/10 text-white shadow-lg shadow-purple-500/10"
                                        : "border-white/5 bg-zinc-900/30 text-zinc-500 opacity-60"
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                                    done ? "bg-emerald-500/20 text-emerald-400" :
                                    active ? "bg-purple-500/20 text-purple-300" : "bg-zinc-800 text-zinc-500"
                                }`}>
                                    <Icon className="h-3.5 w-3.5" />
                                </div>
                                {done ? (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                ) : active ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                                ) : (
                                    <Circle className="h-4 w-4 text-zinc-700" />
                                )}
                            </div>

                            <div className="mt-3">
                                <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-60">Step {idx + 1}</span>
                                <h4 className="text-xs font-bold leading-snug">{s.label}</h4>
                                <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-zinc-400">
                                    {active ? s.detail : done ? "Stage complete" : "Queued..."}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Live Micro-Log Terminal Stream */}
            <div className="border-t border-white/10 bg-black/90 p-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                        <Terminal className="h-3.5 w-3.5 text-purple-400" />
                        <span className="font-bold text-zinc-300">Live Telemetry Console</span>
                        <span>·</span>
                        <span className="text-emerald-400">{logs.length} logs recorded</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowTerminal((s) => !s)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-white"
                    >
                        {showTerminal ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {showTerminal ? "Hide Console" : "Show Console"}
                    </button>
                </div>

                {showTerminal && (
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                        {logs.map((log) => (
                            <div key={log.id} className="flex items-start gap-2.5">
                                <span className="text-zinc-500 font-bold">[{log.time}]</span>
                                <span className={
                                    log.type === "success" ? "text-emerald-400 font-semibold" :
                                    log.type === "warn" ? "text-rose-400 font-semibold" : "text-purple-300"
                                }>
                                    {log.text}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Multiple Articles Queue Bar */}
            {allBlogs.length > 1 && (
                <div className="flex items-center justify-between border-t border-white/10 bg-zinc-900/60 px-6 py-2.5 text-xs text-zinc-400">
                    <span className="font-semibold text-purple-300">
                        + {allBlogs.length - 1} additional article{allBlogs.length - 1 > 1 ? "s" : ""} in generation queue
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        Parallel Inngest Processing
                    </span>
                </div>
            )}
        </div>
    );
}
