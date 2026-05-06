"use client";

import { useState } from "react";
import {
    Globe, Zap, CheckCircle, ChevronRight, Loader2,
    TrendingUp, Shield, Cpu, FileText, BarChart2,
    MessageCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props { onComplete?: () => void; }

// ── Quick-check result shape ──────────────────────────────────────────────────
interface QuickCheckResult {
    titleScore: number;
    metaScore:  number;
    speedScore: number;
    httpsOk:    boolean;
    aeoScore:   number;
    lowestKey:  string;
}

const SCORE_ROWS: {
    key:   keyof QuickCheckResult;
    label: string;
    icon:  React.ComponentType<{ className?: string }>;
    fmt:   (v: number | boolean) => string;
}[] = [
    { key: "titleScore", label: "Page Title",        icon: FileText,    fmt: (v) => `${v}/100` },
    { key: "metaScore",  label: "Meta Description",  icon: FileText,    fmt: (v) => `${v}/100` },
    { key: "speedScore", label: "Page Speed",        icon: TrendingUp,  fmt: (v) => `${v}/100` },
    { key: "httpsOk",    label: "HTTPS",             icon: Shield,      fmt: (v) => (v ? "Secure ✓" : "Missing!") },
    { key: "aeoScore",   label: "AI Answer Score",   icon: Cpu,         fmt: (v) => `${v}/100` },
];

const LOWEST_LABELS: Record<string, string> = {
    titleScore: "Your page title needs work — this is the #1 ranking signal.",
    metaScore:  "Missing or poor meta description reduces click-through rate.",
    speedScore: "Slow page speed hurts rankings and conversions.",
    aeoScore:   "Your site rarely appears in AI-generated answers.",
};

function scoreColor(value: number | boolean): string {
    if (typeof value === "boolean") return value ? "text-emerald-400" : "text-red-400";
    if (value >= 75) return "text-emerald-400";
    if (value >= 50) return "text-yellow-400";
    return "text-red-400";
}

function scoreBg(value: number | boolean): string {
    if (typeof value === "boolean") return value ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5";
    if (value >= 75) return "border-emerald-500/20 bg-emerald-500/5";
    if (value >= 50) return "border-yellow-500/20 bg-yellow-500/5";
    return "border-red-500/20 bg-red-500/5";
}

const STEPS = [
    { id: "domain",   label: "Add domain",   icon: Globe },
    { id: "check",    label: "Quick check",  icon: BarChart2 },
    { id: "done",     label: "Ready",        icon: CheckCircle },
];

export function OnboardingInline({ onComplete }: Props) {
    const [step,         setStep]         = useState(0);
    const [domain,       setDomain]       = useState("");
    const [domainError,  setDomainError]  = useState("");
    const [saving,       setSaving]       = useState(false);
    const [checking,     setChecking]     = useState(false);
    const [siteId,       setSiteId]       = useState<string | null>(null);
    const [quickResult,  setQuickResult]  = useState<QuickCheckResult | null>(null);
    const router = useRouter();

    const validateDomain = (v: string) => {
        try {
            const url  = v.startsWith("http") ? v : `https://${v}`;
            const h    = new URL(url).hostname;
            return h.includes(".") ? h : null;
        } catch { return null; }
    };

    // Step 0 → Step 1: Add domain + immediately run quick check
    const handleAddDomain = async () => {
        const hostname = validateDomain(domain);
        if (!hostname) { setDomainError("Enter a valid domain, e.g. example.com"); return; }
        setDomainError("");
        setSaving(true);

        try {
            // Create site
            const res = await fetch("/api/sites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain: hostname }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setDomainError(data.error ?? "Failed to add site. Please try again.");
                return;
            }
            const { id } = await res.json();
            setSiteId(id);

            // Also track onboarding step
            await fetch("/api/settings/preferences", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ onboardingStep: "domain_added" }),
            }).catch(() => null);

            setStep(1);
            setSaving(false);
            setChecking(true);

            // Run quick check in background
            const checkRes = await fetch("/api/free-seo-check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain: hostname }),
            });
            if (checkRes.ok) {
                const data = await checkRes.json() as QuickCheckResult;
                setQuickResult(data);

                // Track that user reached scores screen
                await fetch("/api/settings/preferences", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ onboardingStep: "scores_viewed" }),
                }).catch(() => null);
            }
        } catch {
            setDomainError("Network error. Please try again.");
        } finally {
            setSaving(false);
            setChecking(false);
        }
    };

    const handleAskAria = () => {
        try { localStorage.setItem("aiseo_inline_complete", "1"); } catch { }
        router.push(siteId ? `/aria?siteId=${siteId}` : "/aria");
        onComplete?.();
    };

    const handleRunAudit = () => {
        try { localStorage.setItem("aiseo_inline_complete", "1"); } catch { }
        router.push(siteId ? `/dashboard/audits?siteId=${siteId}` : "/dashboard/audits");
        onComplete?.();
    };

    return (
        <div className="card-surface p-6 max-w-xl">
            {/* Step pills */}
            <div className="flex items-center gap-2 mb-6">
                {STEPS.map((s, i) => {
                    const Icon   = s.icon;
                    const done   = i < step;
                    const active = i === step;
                    return (
                        <div key={s.id} className="flex items-center gap-2">
                            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                                done   ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                active ? "bg-foreground/8 text-foreground border-border" :
                                         "text-muted-foreground/50 border-transparent"
                            }`}>
                                <Icon className="w-3 h-3" />
                                {s.label}
                            </div>
                            {i < STEPS.length - 1 && (
                                <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Step 0: Add domain ─────────────────────────────────────────── */}
            {step === 0 && (
                <div className="flex flex-col gap-4">
                    <div>
                        <h3 className="text-base font-semibold mb-1">Add your first domain</h3>
                        <p className="text-sm text-muted-foreground">
                            We'll run an instant 5-point health check — results in under 8 seconds.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <input
                                id="onboarding-domain-input"
                                type="text"
                                value={domain}
                                onChange={e => { setDomain(e.target.value); setDomainError(""); }}
                                onKeyDown={e => e.key === "Enter" && handleAddDomain()}
                                placeholder="yoursite.com"
                                className="w-full bg-background border border-border focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 rounded-lg px-3 py-2.5 text-sm transition-all outline-none placeholder:text-muted-foreground"
                                autoFocus
                            />
                        </div>
                        <button
                            id="onboarding-add-site-btn"
                            onClick={handleAddDomain}
                            disabled={saving || !domain.trim()}
                            className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center gap-2"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check Site →"}
                        </button>
                    </div>
                    {domainError && <p className="text-xs text-red-400 -mt-2">{domainError}</p>}
                    <p className="text-xs text-muted-foreground">
                        Or{" "}
                        <Link href="/dashboard/sites/new" className="text-brand hover:underline">
                            use the full setup form
                        </Link>{" "}
                        to connect GitHub and GSC at the same time.
                    </p>
                </div>
            )}

            {/* ── Step 1: Quick check results ────────────────────────────────── */}
            {step === 1 && (
                <div className="flex flex-col gap-4">
                    {checking ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                            <p className="text-sm text-muted-foreground">Running 5-point SEO health check…</p>
                            <div className="flex gap-4 text-xs text-muted-foreground/60">
                                <span>Title ✓</span>
                                <span>Meta ✓</span>
                                <span>Speed…</span>
                                <span>HTTPS…</span>
                                <span>AI…</span>
                            </div>
                        </div>
                    ) : quickResult ? (
                        <>
                            {/* Scores card */}
                            <div>
                                <h3 className="text-base font-semibold mb-1">Your SEO Health Check</h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    {domain} — scanned just now
                                </p>
                                <div className="space-y-2">
                                    {SCORE_ROWS.map(row => {
                                        const val = quickResult[row.key] as number | boolean;
                                        const Icon = row.icon;
                                        return (
                                            <div
                                                key={row.key}
                                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${scoreBg(val)}`}
                                            >
                                                <Icon className={`w-4 h-4 shrink-0 ${scoreColor(val)}`} />
                                                <span className="text-sm flex-1">{row.label}</span>
                                                <span className={`text-sm font-bold ${scoreColor(val)}`}>
                                                    {row.fmt(val)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Biggest issue callout */}
                            {quickResult.lowestKey && LOWEST_LABELS[quickResult.lowestKey] && (
                                <div className="flex items-start gap-3 px-3 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                                    <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-300/80">
                                        <strong className="text-amber-300">Biggest opportunity: </strong>
                                        {LOWEST_LABELS[quickResult.lowestKey]}
                                    </p>
                                </div>
                            )}

                            {/* CTAs */}
                            <div className="flex gap-2">
                                <button
                                    id="onboarding-ask-aria-btn"
                                    onClick={handleAskAria}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
                                >
                                    <MessageCircle className="w-4 h-4" />
                                    Ask Aria to fix it
                                </button>
                                <button
                                    id="onboarding-run-audit-btn"
                                    onClick={handleRunAudit}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border hover:border-brand/30 text-sm font-semibold transition-colors"
                                >
                                    <Zap className="w-4 h-4 text-brand" />
                                    Run full audit
                                </button>
                            </div>
                            <button
                                onClick={() => {
                                    try { localStorage.setItem("aiseo_inline_complete", "1"); } catch { }
                                    setStep(2);
                                    onComplete?.();
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                            >
                                Skip for now
                            </button>
                        </>
                    ) : (
                        // Check failed — fallback
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
                                <div>
                                    <h3 className="text-base font-semibold">Site added!</h3>
                                    <p className="text-sm text-muted-foreground">Run a full audit to see your detailed results.</p>
                                </div>
                            </div>
                            <button
                                onClick={handleRunAudit}
                                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
                            >
                                <Zap className="w-4 h-4" />
                                View Audit Queue →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Step 2: Done ───────────────────────────────────────────────── */}
            {step === 2 && (
                <div className="flex items-center gap-3">
                    <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
                    <div>
                        <h3 className="text-base font-semibold">You&apos;re all set</h3>
                        <p className="text-sm text-muted-foreground">Explore audits, keywords, and AI content from the sidebar.</p>
                    </div>
                </div>
            )}
        </div>
    );
}