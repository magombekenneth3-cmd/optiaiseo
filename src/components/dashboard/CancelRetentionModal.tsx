"use client";

/**
 * CancelRetentionModal
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the raw downgrade confirmation modal in billing/page.tsx with a
 * 3-step retention funnel:
 *
 * Step 1 — "Why are you leaving?" (5 radio options)
 * Step 2 — Tailored soft-save offer based on their reason:
 *   • Too expensive    → 30-day pause button + discount notice
 *   • Not getting results → show best result + book onboarding call
 *   • Missing feature  → feature request form (saves to DB)
 *   • Using competitor → competitor comparison deeplink
 *   • Need a break     → 30-day pause button
 * Step 3 — If user still proceeds → record churnReason then fire checkout
 *
 * IMPORTANT: This component receives `onProceed` and `onDismiss` as props.
 * The parent (billing/page.tsx) still owns the Stripe checkout logic.
 */

import Link from "next/link";
import { useState } from "react";
import { X, AlertTriangle, Pause, Calendar, Sparkles, ArrowRight, MessageSquare } from "lucide-react";

export type ChurnReason =
    | "too_expensive"
    | "no_results"
    | "missing_feature"
    | "using_competitor"
    | "need_break"
    | null;

interface Props {
    targetTier: string;
    lostFeatures: string[];
    onProceed: (reason: ChurnReason) => void;   // call Stripe checkout
    onDismiss: () => void;                       // keep current plan
    onPause?: () => void;                        // optional pause handler
}

const REASONS: { id: ChurnReason; label: string; emoji: string }[] = [
    { id: "too_expensive",     label: "It's too expensive right now",           emoji: "💸" },
    { id: "no_results",        label: "I'm not seeing results yet",              emoji: "📉" },
    { id: "missing_feature",   label: "I need a feature that isn't here",       emoji: "🔧" },
    { id: "using_competitor",  label: "I'm switching to another tool",          emoji: "🔄" },
    { id: "need_break",        label: "I just need a break / not using it now", emoji: "⏸️" },
];

function Step1({ selected, onSelect, onNext, onDismiss }: {
    selected: ChurnReason;
    onSelect: (r: ChurnReason) => void;
    onNext: () => void;
    onDismiss: () => void;
}) {
    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold">Before you go…</h2>
                        <p className="text-xs text-muted-foreground">Help us understand what went wrong</p>
                    </div>
                </div>
                <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <p className="text-sm text-muted-foreground">
                What&apos;s the main reason you&apos;re downgrading?
            </p>

            <div className="space-y-2">
                {REASONS.map((r) => (
                    <button
                        key={r.id}
                        onClick={() => onSelect(r.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium text-left transition-all ${
                            selected === r.id
                                ? "border-violet-500/50 bg-violet-500/10 text-foreground"
                                : "border-border hover:border-border/80 hover:bg-muted/40 text-muted-foreground"
                        }`}
                    >
                        <span className="text-base leading-none">{r.emoji}</span>
                        {r.label}
                    </button>
                ))}
            </div>

            <div className="flex gap-3 pt-1">
                <button
                    onClick={onDismiss}
                    className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                    Keep my plan
                </button>
                <button
                    onClick={onNext}
                    disabled={!selected}
                    className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all hover:scale-[1.02] active:scale-95"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}

function Step2({ reason, targetTier, onProceed, onDismiss, onPause }: {
    reason: ChurnReason;
    targetTier: string;
    onProceed: () => void;
    onDismiss: () => void;
    onPause?: () => void;
}) {
    const [featureRequest, setFeatureRequest] = useState("");
    const [featureSent, setFeatureSent] = useState(false);
    const [sendingFeature, setSendingFeature] = useState(false);

    async function submitFeatureRequest() {
        if (!featureRequest.trim()) return;
        setSendingFeature(true);
        try {
            await fetch("/api/feature-request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request: featureRequest }),
            });
            setFeatureSent(true);
        } catch { /* ignore — fire and forget */ } finally {
            setSendingFeature(false);
        }
    }

    const offers: Record<NonNullable<ChurnReason>, React.ReactNode> = {
        too_expensive: (
            <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/20">
                    <p className="text-sm font-bold text-emerald-400 mb-1">💡 Pause instead of cancel</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Pause your subscription for 30 days — no charge, data preserved, reactivates automatically.
                        Perfect if it&apos;s a tight month.
                    </p>
                    {onPause && (
                        <button
                            onClick={onPause}
                            className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
                        >
                            <Pause className="w-3.5 h-3.5" />
                            Pause for 30 days
                        </button>
                    )}
                </div>
                <p className="text-xs text-center text-muted-foreground">
                    Or continue to downgrade to {targetTier.charAt(0) + targetTier.slice(1).toLowerCase()} below.
                </p>
            </div>
        ),
        no_results: (
            <div className="space-y-4">
                <div className="p-4 rounded-xl bg-blue-950/40 border border-blue-500/20">
                    <p className="text-sm font-bold text-blue-400 mb-1">🎯 Book a free strategy call</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        SEO takes 90+ days to compound. Let us walk you through your specific site and
                        show you exactly where to focus for the fastest results.
                    </p>
                    <a
                        href="https://cal.com/optiaiseo/strategy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
                    >
                        <Calendar className="w-3.5 h-3.5" />
                        Book 30-min call (free)
                    </a>
                </div>
            </div>
        ),
        missing_feature: (
            <div className="space-y-4">
                <div className="p-4 rounded-xl bg-violet-950/40 border border-violet-500/20">
                    <p className="text-sm font-bold text-violet-400 mb-1">🔧 Tell us what you need</p>
                    <p className="text-xs text-muted-foreground mb-3">
                        We ship features weekly. Your request goes directly to the roadmap.
                    </p>
                    {featureSent ? (
                        <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                            <Sparkles className="w-4 h-4" /> Request received — thank you!
                        </p>
                    ) : (
                        <div className="space-y-2">
                            <textarea
                                value={featureRequest}
                                onChange={(e) => setFeatureRequest(e.target.value)}
                                placeholder="What would make OptiAISEO perfect for your use case?"
                                className="w-full h-20 px-3 py-2 rounded-xl bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                            />
                            <button
                                onClick={submitFeatureRequest}
                                disabled={!featureRequest.trim() || sendingFeature}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold transition-all"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                                {sendingFeature ? "Sending…" : "Submit request"}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        ),
        using_competitor: (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/20">
                <p className="text-sm font-bold text-amber-400 mb-1">⚡ See how we compare</p>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    OptiAISEO is the only platform that combines traditional SEO + AI visibility (AEO) + 
                    auto-fix PRs in one tool. Most competitors don&apos;t cover all three.
                </p>
                <Link
                    href="/vs/surfer-seo"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors"
                >
                    View comparison <ArrowRight className="w-3 h-3" />
                </Link>
            </div>
        ),
        need_break: (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/20">
                <p className="text-sm font-bold text-emerald-400 mb-1">⏸️ Pause instead</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    No need to lose your data and settings. Pause for 30 days — free, automatic
                    reactivation, everything preserved.
                </p>
                {onPause && (
                    <button
                        onClick={onPause}
                        className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
                    >
                        <Pause className="w-3.5 h-3.5" />
                        Pause for 30 days
                    </button>
                )}
            </div>
        ),
    };

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold">We have an idea…</h2>
                <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {reason && offers[reason]}

            <div className="flex gap-3 pt-2">
                <button
                    onClick={onDismiss}
                    className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                    Keep my plan
                </button>
                <button
                    onClick={onProceed}
                    className="flex-1 h-10 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground text-sm font-medium transition-colors"
                >
                    Downgrade anyway
                </button>
            </div>
        </div>
    );
}

export function CancelRetentionModal({ targetTier, lostFeatures, onProceed, onDismiss, onPause }: Props) {
    const [step, setStep] = useState<1 | 2>(1);
    const [reason, setReason] = useState<ChurnReason>(null);

    function handleNext() {
        if (!reason) return;
        setStep(2);
    }

    function handleProceed() {
        onProceed(reason);
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div
                className="bg-card border border-border rounded-2xl p-7 max-w-md w-full shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="Cancellation retention dialog"
            >
                {/* Feature losses strip — always visible */}
                {lostFeatures.length > 0 && step === 1 && (
                    <div className="mb-5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-400/70 mb-2">
                            You&apos;ll lose access to:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {lostFeatures.map((f) => (
                                <span key={f} className="text-[11px] font-medium text-amber-300/80 bg-amber-500/10 border border-amber-500/15 px-2 py-0.5 rounded-md">
                                    {f}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Progress dots */}
                <div className="flex items-center gap-1.5 mb-5">
                    {[1, 2].map((s) => (
                        <div
                            key={s}
                            className={`h-1 rounded-full transition-all ${
                                s === step ? "w-6 bg-violet-500" : s < step ? "w-3 bg-violet-500/50" : "w-3 bg-border"
                            }`}
                        />
                    ))}
                </div>

                {step === 1 && (
                    <Step1
                        selected={reason}
                        onSelect={setReason}
                        onNext={handleNext}
                        onDismiss={onDismiss}
                    />
                )}
                {step === 2 && (
                    <Step2
                        reason={reason}
                        targetTier={targetTier}
                        onProceed={handleProceed}
                        onDismiss={onDismiss}
                        onPause={onPause}
                    />
                )}
            </div>
        </div>
    );
}
