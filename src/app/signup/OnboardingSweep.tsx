"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSite } from "@/app/actions/site";
import {
    runOnboardingSpotCheck,
    type SpotCheckResult,
} from "@/app/actions/onboarding";

type Step = "domain" | "scanning" | "result" | "gsc";

const STEP_ORDER: Step[] = ["domain", "scanning", "result", "gsc"];

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function ProgressDots({ current }: { current: Step }) {
    const idx = STEP_ORDER.indexOf(current);
    return (
        <div className="flex items-center justify-center gap-2 mb-6">
            {STEP_ORDER.map((s, i) => (
                <div
                    key={s}
                    className={`rounded-full transition-all duration-300 ${
                        i < idx
                            ? "w-2 h-2 bg-emerald-500"
                            : i === idx
                            ? "w-3 h-3 bg-emerald-400 ring-2 ring-emerald-500/30"
                            : "w-2 h-2 bg-border"
                    }`}
                />
            ))}
        </div>
    );
}

function GoogleIcon() {
    return (
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

function ContinueButton({
    onClick,
    loading,
    label,
}: {
    onClick: () => void;
    loading: boolean;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black px-4 py-3 rounded-xl font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed transform hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2"
        >
            {loading ? <><Spinner />Setting up your site…</> : label}
        </button>
    );
}

const SCAN_STAGES = [
    { label: "Analysing your domain…", pct: 12 },
    { label: "Inferring your industry and queries…", pct: 28 },
    { label: "Asking Gemini about your space…", pct: 52 },
    { label: "Parsing AI citation data…", pct: 74 },
    { label: "Building your First Win report…", pct: 90 },
] as const;

function ScanningStep({ domain }: { domain: string }) {
    const [stageIdx, setStageIdx] = useState(0);

    useEffect(() => {
        const id = setInterval(() => {
            setStageIdx((i) => Math.min(i + 1, SCAN_STAGES.length - 1));
        }, 1600);
        return () => clearInterval(id);
    }, []);

    const stage = SCAN_STAGES[stageIdx];

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="space-y-2 text-center">
                <div className="w-16 h-16 rounded-full bg-violet-500/10 text-violet-400 flex items-center justify-center mx-auto mb-4 border border-violet-500/20">
                    <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ animationDuration: "2s" }}>
                        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold">Checking AI visibility…</h2>
                <p className="text-sm text-muted-foreground">
                    Scanning how AI models respond to queries in{" "}
                    <span className="font-semibold text-foreground">{domain}</span>&apos;s space.
                </p>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="transition-all duration-700">{stage.label}</span>
                    <span className="font-mono font-semibold tabular-nums">{stage.pct}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-1000"
                        style={{ width: `${stage.pct}%` }}
                    />
                </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
                {[
                    { label: "Gemini", color: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
                    { label: "ChatGPT", color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
                    { label: "Perplexity", color: "bg-violet-500/10 border-violet-500/20 text-violet-400" },
                ].map(({ label, color }, i) => (
                    <span
                        key={label}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color} transition-opacity duration-700`}
                        style={{ opacity: stageIdx >= i + 1 ? 1 : 0.35 }}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${stageIdx >= i + 1 ? "animate-pulse" : "opacity-30"}`} />
                        {label}
                    </span>
                ))}
            </div>

            <p className="text-center text-xs text-muted-foreground">This usually takes 8–12 seconds</p>
        </div>
    );
}

function FirstWinCard({
    result,
    domain,
    onContinue,
    isSaving,
}: {
    result: SpotCheckResult;
    domain: string;
    onContinue: () => void;
    isSaving: boolean;
}) {
    if (result.status === "cited") {
        return (
            <div className="flex flex-col gap-6 w-full">
                <div className="space-y-2 text-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
                        ✓ Already being cited
                    </div>
                    <h2 className="text-2xl font-bold">You&apos;re in Gemini!</h2>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        AI models already mention your site for{" "}
                        <span className="font-semibold text-foreground">&ldquo;{result.query}&rdquo;</span>.
                        Now let&apos;s get you into ChatGPT and Perplexity too.
                    </p>
                </div>

                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            1
                        </span>
                        <div>
                            <p className="text-sm font-semibold text-foreground">Your next milestone</p>
                            <p className="text-sm text-muted-foreground mt-0.5">{result.nextStep}</p>
                        </div>
                    </div>
                </div>

                <ContinueButton onClick={onContinue} loading={isSaving} label="Connect GSC to see all citations →" />
            </div>
        );
    }

    if (result.status === "no_activity") {
        return (
            <div className="flex flex-col gap-6 w-full">
                <div className="space-y-2 text-center">
                    <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold">Fresh territory</h2>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        This looks like a niche or emerging market — you can shape how AI models talk about your space before anyone else does.
                    </p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-sm font-semibold text-foreground mb-1">Your first move</p>
                    <p className="text-sm text-muted-foreground">{result.nextStep}</p>
                </div>
                <ContinueButton onClick={onContinue} loading={isSaving} label="Set up your site →" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="space-y-2 text-center">
                <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold mb-2">
                    Citation gap found
                </div>
                <h2 className="text-2xl font-bold">Not cited yet — but fixable</h2>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    Gemini answered{" "}
                    <span className="font-semibold text-foreground">&ldquo;{result.query}&rdquo;</span>{" "}
                    without mentioning <span className="font-semibold text-foreground">{domain}</span>.
                </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                {result.competitorCited && (
                    <div className="flex items-start gap-3 pb-4 border-b border-border">
                        <span className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            i
                        </span>
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                                Who Gemini cited instead
                            </p>
                            <p className="text-sm font-semibold text-foreground">{result.competitorCited}</p>
                        </div>
                    </div>
                )}

                <div className="flex items-start gap-3 pb-4 border-b border-border">
                    <span className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        ?
                    </span>
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                            Most likely reason
                        </p>
                        <p className="text-sm text-foreground">{result.reason}</p>
                    </div>
                </div>

                <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        ✓
                    </span>
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
                            #1 fix — <span className="text-emerald-400">{result.topFix}</span>
                        </p>
                        <p className="text-sm text-foreground">{result.nextStep}</p>
                    </div>
                </div>
            </div>

            <p className="text-center text-xs text-muted-foreground">
                Connect Google Search Console to see{" "}
                <span className="font-semibold text-foreground">which of your pages</span>{" "}
                have the best chance of getting cited first.
            </p>

            <ContinueButton onClick={onContinue} loading={isSaving} label="Show me how to get cited →" />
        </div>
    );
}

function GscStep({ siteId, alreadyCited, upgradePlan, upgradeBilling }: { siteId: string | null; alreadyCited: boolean; upgradePlan?: string | null; upgradeBilling?: string | null }) {
    const router = useRouter();

    const buildDashboardUrl = () => {
        if (upgradePlan) {
            const bp = new URLSearchParams();
            if (upgradeBilling) bp.set("billing", upgradeBilling);
            bp.set("plan", upgradePlan);
            return `/dashboard/billing?${bp.toString()}`;
        }
        return siteId ? `/dashboard/sites/${siteId}` : "/dashboard";
    };

    const handleConnect = () => {
        const callbackUrl = buildDashboardUrl();
        router.push(`/api/auth/signin/google-gsc?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    };

    const handleSkip = () => {
        if (upgradePlan) {
            toast.success("Welcome! Let's set up your plan.");
        } else {
            toast.success("Welcome! Let's look at your first audit.");
        }
        router.push(buildDashboardUrl());
    };

    const benefits = alreadyCited
        ? [
              "See exactly which pages are being cited and why",
              "Track citation trends week over week",
              "Discover which queries to target next",
          ]
        : [
              "Identify your highest-traffic pages to optimise first",
              "See which queries already drive impressions — quick wins",
              "Get a personalised fix priority list, not generic advice",
          ];

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="space-y-2 text-center">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
                    ✓ Site registered
                </div>
                <h2 className="text-2xl font-bold">Connect Google Search Console</h2>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    {alreadyCited
                        ? "You're already being cited — now let's see the full picture."
                        : "Unlock real data so we can prioritise the fixes that move the needle fastest."}
                </p>
            </div>

            <div className="space-y-3 text-sm">
                {benefits.map((benefit) => (
                    <div key={benefit} className="flex items-center gap-2.5 text-muted-foreground">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                            ✓
                        </span>
                        {benefit}
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={handleConnect}
                className="w-full bg-white hover:bg-white/90 text-zinc-900 px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow"
            >
                <GoogleIcon />
                Connect Google Search Console
            </button>

            <button
                type="button"
                onClick={handleSkip}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
                Skip for now — I&apos;ll connect later
            </button>
        </div>
    );
}

export function OnboardingSweep({ userName, upgradePlan, upgradeBilling }: { userName: string; upgradePlan?: string | null; upgradeBilling?: string | null }) {
    const [step, setStep] = useState<Step>("domain");
    const [domain, setDomain] = useState("");
    const [siteId, setSiteId] = useState<string | null>(null);
    const [spotResult, setSpotResult] = useState<SpotCheckResult | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const firstName = userName.split(" ")[0] || userName;

    const handleDomainSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!domain.trim()) return;
        setStep("scanning");

        try {
            const result = await runOnboardingSpotCheck(domain.trim());
            setSpotResult(result);
            setStep("result");
        } catch {
            toast.error("Couldn't complete the AI check — let's continue anyway.");
            await handleCreateSite();
        }
    };

    const handleCreateSite = async () => {
        if (isSaving) return;
        setIsSaving(true);

        const res = await createSite({ domain: domain.trim(), operatingMode: "REPORT_ONLY" });
        setIsSaving(false);

        if (!res.success) {
            if (res.error === "This site has already been added.") {
                toast("Site already registered — continuing setup.");
            } else {
                toast.error(res.error || "Failed to register site. Please try again.");
                return;
            }
        }

        if (res.success && res.site?.id) {
            setSiteId(res.site.id);
        }

        setStep("gsc");
    };

    return (
        <div className="flex flex-col w-full">
            <ProgressDots current={step} />

            {step === "domain" && (
                <form onSubmit={handleDomainSubmit} className="flex flex-col gap-6 w-full">
                    <div className="space-y-2 text-center">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold">Welcome, {firstName}!</h2>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                            Enter your domain and we&apos;ll show you how AI models talk about your space right now — in under 10 seconds.
                        </p>
                    </div>

                    <input
                        id="onboarding-domain"
                        type="text"
                        placeholder="yourdomain.com"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        required
                        autoFocus
                        autoComplete="url"
                        spellCheck={false}
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-center placeholder:text-muted-foreground/50"
                    />

                    <div className="rounded-xl border border-border bg-card/50 p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            What we&apos;ll check for you
                        </p>
                        {[
                            "Whether Gemini mentions your domain for relevant queries",
                            "Which competitor is being cited instead (if any)",
                            "The single most impactful fix you can make today",
                        ].map((item) => (
                            <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <span className="w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    ✓
                                </span>
                                {item}
                            </div>
                        ))}
                    </div>

                    <button
                        type="submit"
                        disabled={!domain.trim()}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black px-4 py-3 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                    >
                        Check my AI visibility
                    </button>
                </form>
            )}

            {step === "scanning" && <ScanningStep domain={domain} />}

            {step === "result" && spotResult && (
                <FirstWinCard
                    result={spotResult}
                    domain={domain}
                    onContinue={handleCreateSite}
                    isSaving={isSaving}
                />
            )}

            {step === "gsc" && (
                <GscStep
                    siteId={siteId}
                    alreadyCited={spotResult?.status === "cited"}
                    upgradePlan={upgradePlan}
                    upgradeBilling={upgradeBilling}
                />
            )}
        </div>
    );
}
