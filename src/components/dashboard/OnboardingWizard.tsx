"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface OnboardingWizardProps {
    show: boolean;
    userName: string;
}

const STEPS = ["welcome", "add_site", "connect_gsc", "ready"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
    welcome:     "Welcome",
    add_site:    "Add your website",
    connect_gsc: "Connect Google Search Console",
    ready:       "You're all set",
};

export function OnboardingWizard({ show, userName }: OnboardingWizardProps) {
    const [step, setStep] = useState<Step>("welcome");
    const [dismissed, setDismissed] = useState(false);
    const router = useRouter();

    const triggerRef = useRef<HTMLButtonElement>(null); // no external trigger for this modal
    const panelRef   = useRef<HTMLDivElement>(null);
    const open = show && !dismissed;
    useFocusTrap(panelRef, open, triggerRef);

    if (!open) return null;

    const dismiss = async () => {
        await fetch("/api/user/onboarding-done", { method: "POST" }).catch(() => null);
        setDismissed(true);
    };

    const currentIdx = STEPS.indexOf(step);

    return (
        <div
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
            onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="onboarding-wizard-title"
                tabIndex={-1}
                className="w-full max-w-md rounded-2xl border border-border bg-card shadow-[0_0_80px_rgba(0,0,0,0.6)] p-8 relative focus:outline-none"
                style={{ animation: "fadeIn 0.2s ease forwards" }}
            >
                {/* Step progress bar */}
                <div className="flex items-center gap-2 mb-8" role="progressbar" aria-valuenow={currentIdx + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={`Step ${currentIdx + 1} of ${STEPS.length}`}>
                    {STEPS.map((s, i) => (
                        <div
                            key={s}
                            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                                i <= currentIdx ? "bg-brand" : "bg-muted"
                            }`}
                        />
                    ))}
                </div>

                {step === "welcome" && (
                    <>
                        <h2 id="onboarding-wizard-title" className="text-2xl font-bold tracking-tight mb-2">
                            Welcome, {userName.split(" ")[0]} 👋
                        </h2>
                        <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
                            OptiAISEO tracks your brand&apos;s visibility in ChatGPT, Claude,
                            Perplexity, and Google AI. Setup takes under 2 minutes.
                        </p>
                        <button
                            onClick={() => setStep("add_site")}
                            className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity"
                        >
                            Get started →
                        </button>
                    </>
                )}

                {step === "add_site" && (
                    <>
                        <h2 id="onboarding-wizard-title" className="text-xl font-bold tracking-tight mb-2">
                            Add your website
                        </h2>
                        <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
                            Enter your domain and we&apos;ll crawl it, run your first audit,
                            and email you your AI visibility score within 2 minutes.
                        </p>
                        <button
                            onClick={async () => {
                                await dismiss();
                                router.push("/dashboard/sites/new?onboarding=1");
                            }}
                            className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity mb-3"
                        >
                            Add my site →
                        </button>
                        <button
                            onClick={() => setStep("connect_gsc")}
                            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Skip for now
                        </button>
                    </>
                )}

                {step === "connect_gsc" && (
                    <>
                        <h2 id="onboarding-wizard-title" className="text-xl font-bold tracking-tight mb-2">
                            Connect Google Search Console
                        </h2>
                        <p className="text-muted-foreground text-sm mb-2 leading-relaxed">
                            See the exact keywords driving your traffic — and which are losing
                            ground. Takes 30 seconds.
                        </p>
                        <p className="text-xs text-muted-foreground/60 mb-6">
                            Optional — you can connect this later in Settings.
                        </p>
                        <button
                            onClick={async () => {
                                await dismiss();
                                router.push("/api/auth/signin/google-gsc");
                            }}
                            className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity mb-3"
                        >
                            Connect Google Search Console →
                        </button>
                        <button
                            onClick={() => setStep("ready")}
                            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Skip
                        </button>
                    </>
                )}

                {step === "ready" && (
                    <>
                        <h2 id="onboarding-wizard-title" className="text-xl font-bold tracking-tight mb-2">
                            You&apos;re all set
                        </h2>
                        <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
                            Add your first site from the dashboard to get your AI visibility
                            score. Check the sidebar for all features.
                        </p>
                        <button
                            onClick={dismiss}
                            className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 transition-opacity"
                        >
                            Go to dashboard
                        </button>
                    </>
                )}

                {/* visually hidden step label for screen readers */}
                <span className="sr-only">
                    Currently on step: {STEP_TITLES[step]}
                </span>
            </div>
            <style>{`
                @media (prefers-reduced-motion: no-preference) {
                    @keyframes fadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
                }
            `}</style>
        </div>
    );
}
