"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, BarChart2 } from "lucide-react";
import Link from "next/link";

interface AuditPollerProps {
    /** IDs of audits currently IN_PROGRESS or PENDING */
    processingAuditIds: string[];
    initialIntervalMs?: number;
}

const AUDIT_STEPS = [
    { label: "Crawling pages",            pct: 12 },
    { label: "Checking SEO signals",      pct: 40 },
    { label: "AI analysis",               pct: 68 },
    { label: "Scoring & recommendations", pct: 90 },
];

const STEP_AT = [0, 4, 8, 12]; // attempt index at which each step becomes active

/**
 * Shows a live progress bar while audits are in-flight.
 * Polls on an exponential back-off schedule (6s → 30s max).
 * Stops after 60 attempts (~20 min) and shows a timeout banner.
 * Fires a completion toast when processingAuditIds goes to zero.
 */
export function AuditPoller({ processingAuditIds, initialIntervalMs = 6000 }: AuditPollerProps) {
    const router    = useRouter();
    const routerRef = useRef(router);
    useEffect(() => { routerRef.current = router; });

    const MAX_ATTEMPTS = 60;
    const MAX_INTERVAL = 30_000;

    const attemptRef      = useRef(0);
    const [gaveUp, setGaveUp]         = useState(false);
    const [displayPct, setDisplayPct] = useState(0);
    const prevLengthRef               = useRef(processingAuditIds.length);

    useEffect(() => {
        const prev = prevLengthRef.current;
        const curr = processingAuditIds.length;
        prevLengthRef.current = curr;

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
                            <p className="text-sm font-bold text-foreground">
                                Audit{prev > 1 ? "s" : ""} complete!
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {prev > 1 ? `${prev} audits have` : "Your audit has"} finished — view your full report.
                            </p>
                            <Link
                                href="/dashboard/audits"
                                onClick={() => toast.dismiss(id)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors mt-0.5"
                            >
                                <BarChart2 className="w-3.5 h-3.5" />
                                View audit report →
                            </Link>
                        </div>
                    </div>
                ),
                { duration: 12000 }
            );
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [processingAuditIds.length]);

    useEffect(() => {
        if (processingAuditIds.length === 0) {
            attemptRef.current = 0;
            setGaveUp(false);
            return;
        }
        if (gaveUp) return;

        let timeoutId: ReturnType<typeof setTimeout>;

        function scheduleNext() {
            if (attemptRef.current >= MAX_ATTEMPTS) { setGaveUp(true); return; }

            // Exponential back-off: 6s → 30s cap
            const delay = Math.min(
                initialIntervalMs * Math.pow(1.25, attemptRef.current),
                MAX_INTERVAL
            );

            timeoutId = setTimeout(() => {
                if (document.visibilityState !== "visible") { scheduleNext(); return; }
                attemptRef.current += 1;

                // Advance % estimate
                const stepIdx = STEP_AT.reduce(
                    (acc, min, i) => (attemptRef.current >= min ? i : acc), 0
                );
                const base       = AUDIT_STEPS[stepIdx].pct;
                const next       = AUDIT_STEPS[Math.min(stepIdx + 1, AUDIT_STEPS.length - 1)].pct;
                const stepRange  = next - base;
                const stepsInBand = (STEP_AT[Math.min(stepIdx + 1, STEP_AT.length - 1)] ?? 60) - STEP_AT[stepIdx];
                const progress = Math.min(
                    base + stepRange * ((attemptRef.current - STEP_AT[stepIdx]) / stepsInBand),
                    93
                );
                setDisplayPct(Math.round(progress));

                routerRef.current.refresh();
                scheduleNext();
            }, delay);
        }

        scheduleNext();
        return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [processingAuditIds.length, gaveUp, initialIntervalMs]);

    if (processingAuditIds.length === 0) return null;

    const stepIdx   = STEP_AT.reduce((acc, min, i) => (attemptRef.current >= min ? i : acc), 0);
    const stepLabel = AUDIT_STEPS[stepIdx].label;

    if (gaveUp) {
        return (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-sm">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
                </svg>
                <span className="flex-1">
                    Audit is taking longer than expected.{" "}
                    <button
                        onClick={() => window.location.reload()}
                        className="underline font-semibold hover:text-amber-300 transition-colors"
                    >
                        Refresh the page
                    </button>{" "}
                    to check the latest status.
                </span>
            </div>
        );
    }

    return (
        <div className="mt-4 px-4 py-3.5 rounded-xl border border-emerald-500/15 bg-emerald-500/5 space-y-2.5">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="relative w-5 h-5 shrink-0">
                        <svg className="w-5 h-5 text-emerald-500/20" viewBox="0 0 20 20" fill="currentColor">
                            <circle cx="10" cy="10" r="10" />
                        </svg>
                        <svg className="w-5 h-5 text-emerald-400 animate-spin absolute inset-0" viewBox="0 0 20 20" fill="none" strokeWidth="2">
                            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeLinecap="round"
                                strokeDasharray="26" strokeDashoffset="18" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-emerald-200 font-semibold text-sm leading-none">
                            Running {processingAuditIds.length === 1 ? "1 audit" : `${processingAuditIds.length} audits`}
                        </p>
                        <p className="text-emerald-400/70 text-xs mt-0.5">{stepLabel}</p>
                    </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-400/80 shrink-0">{displayPct}%</span>
            </div>

            {/* Animated progress bar */}
            <div className="h-1.5 rounded-full bg-emerald-500/10 overflow-hidden w-full">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-[2000ms] ease-out relative overflow-hidden"
                    style={{ width: `${displayPct}%` }}
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                </div>
            </div>

            {/* Step dots */}
            <div className="flex items-center gap-1.5 flex-wrap">
                {AUDIT_STEPS.map((s, i) => (
                    <div key={s.label} className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${
                            i < stepIdx  ? "bg-emerald-400" :
                            i === stepIdx ? "bg-emerald-300 animate-pulse" :
                            "bg-zinc-700"
                        }`} />
                        <span className={`text-[10px] font-medium transition-colors duration-500 ${
                            i < stepIdx  ? "text-emerald-400" :
                            i === stepIdx ? "text-emerald-300" :
                            "text-zinc-600"
                        }`}>{s.label}</span>
                        {i < AUDIT_STEPS.length - 1 && (
                            <span className={`text-xs shrink-0 ${i < stepIdx ? "text-emerald-600" : "text-zinc-700"}`}>›</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
