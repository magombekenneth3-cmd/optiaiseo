/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Check, Loader2, ArrowRight, Zap, Building2, Rocket, Star, CreditCard, AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { getUserBillingTier } from "@/app/actions/get-tier";
import { UsageDashboard } from "./UsageDashboard";
import { CreditUsagePanel } from "@/components/dashboard/CreditUsagePanel";
import { CreditHistoryTable } from "@/components/dashboard/CreditHistoryTable";
import { PLANS } from "@/lib/stripe/plans";
import { CancelRetentionModal, type ChurnReason } from "@/components/dashboard/CancelRetentionModal";

const plans = [
    {
        name: "Free",
        tier: "FREE",
        price: "$0",
        period: "/mo",
        description: "Explore the platform free. No credit card needed.",
        features: [
            `${PLANS.FREE.limits.auditsPerMonth} Audits per month`,
            "1 Website",
            `${PLANS.FREE.limits.blogsPerMonth} Blogs per month`,
            `${PLANS.FREE.limits.aeoAuditsPerMonth} AEO checks / month`,
            "Google Search Console",
            "50 credits / month",
        ],
        icon: Rocket,
        accent: "emerald",
        cta: "Get Started",
    },
    {
        name: "Starter",
        tier: "STARTER",
        price: "$19",
        period: "/mo",
        description: "For individuals and small sites who want more than free.",
        features: [
            `${PLANS.STARTER.limits.auditsPerMonth} Audits per month`,
            `${PLANS.STARTER.limits.sites} Websites`,
            `${PLANS.STARTER.limits.blogsPerMonth} Blogs per month`,
            `${PLANS.STARTER.limits.aeoAuditsPerMonth} AEO checks / month`,
            "Rank tracking",
            "Competitor tracking (2/site)",
            "150 credits / month",
        ],
        icon: Star,
        accent: "sky",
        cta: "Upgrade to Starter",
    },
    {
        name: "Pro",
        tier: "PRO",
        price: "$49",
        period: "/mo",
        description: "Full automation for growing teams winning in AI search.",
        features: [
            `${PLANS.PRO.limits.auditsPerMonth} Audits per month`,
            `${PLANS.PRO.limits.sites} Websites`,
            `${PLANS.PRO.limits.blogsPerMonth} Blogs per month`,
            `${PLANS.PRO.limits.aeoAuditsPerMonth} AEO checks / month`,
            "Ahrefs + backlink data",
            "GitHub auto-fix PRs",
            "Developer API",
            "500 credits / month",
        ],
        icon: Zap,
        accent: "blue",
        cta: "Upgrade to Pro",
        popular: true,
    },
    {
        name: "Agency",
        tier: "AGENCY",
        price: "$149",
        period: "/mo",
        description: "Unlimited scale for agencies managing multiple clients.",
        features: [
            "Unlimited Audits",
            "Unlimited Websites",
            "Unlimited Blogs",
            "Unlimited AEO checks",
            "All Pro features",
            "White-label PDF exports",
            "Client portal",
            "2,000 credits / month",
        ],
        icon: Building2,
        accent: "purple",
        cta: "Upgrade to Agency",
    },
] as const;

const TIER_ORDER: Record<string, number> = { FREE: 0, STARTER: 1, PRO: 2, AGENCY: 3 };

const DOWNGRADE_LOSSES: Record<string, string[]> = {
    FREE:    ["Rank tracking", "Competitor tracking", "All AI automation", "Priority support"],
    STARTER: ["Full AI automation", "Ahrefs backlink data", "GitHub auto-fix PRs", "Developer API"],
    PRO:     ["Client portal", "White-label exports", "Unlimited scale features"],
};

type Accent = "emerald" | "sky" | "blue" | "purple";

const accentMap: Record<Accent, { ring: string; badge: string; btn: string; iconBg: string; check: string; glow: string }> = {
    emerald: {
        ring: "border-emerald-500/40",
        badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        btn: "bg-emerald-600 hover:bg-emerald-500 text-white",
        iconBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
        check: "text-emerald-400",
        glow: "shadow-emerald-500/10",
    },
    sky: {
        ring: "border-sky-500/40",
        badge: "bg-sky-500/10 text-sky-400 border-sky-500/20",
        btn: "bg-sky-600 hover:bg-sky-500 text-white",
        iconBg: "bg-sky-500/10 border-sky-500/20 text-sky-400",
        check: "text-sky-400",
        glow: "shadow-sky-500/10",
    },
    blue: {
        ring: "border-blue-500/40",
        badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        btn: "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20",
        iconBg: "bg-blue-500/10 border-blue-500/20 text-blue-400",
        check: "text-blue-400",
        glow: "shadow-blue-500/20",
    },
    purple: {
        ring: "border-purple-500/40",
        badge: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        btn: "bg-purple-600 hover:bg-purple-500 text-white",
        iconBg: "bg-purple-500/10 border-purple-500/20 text-purple-400",
        check: "text-purple-400",
        glow: "shadow-purple-500/10",
    },
};

// Search-param handler — MUST live in its own component inside <Suspense>
// because Next.js 14 throws on useSearchParams() called outside Suspense.
function BillingSearchParamsReader({ onMount }: { onMount: (success: boolean, canceled: boolean, billing: string | null, plan: string | null) => void }) {
    const searchParams = useSearchParams();
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current) return;
        firedRef.current = true;
        onMount(
            searchParams.get("success") === "true",
            searchParams.get("canceled") === "true",
            searchParams.get("billing"),
            searchParams.get("plan"),
        );
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
}

export default function BillingPage() {
    const { data: session, status } = useSession();

    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [isPortalLoading, setIsPortalLoading] = useState(false);
    const [isBuyingCredits, setIsBuyingCredits] = useState(false);
    const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
    const [realTier, setRealTier] = useState<string | null>(null);
    const [isFetchingTier, setIsFetchingTier] = useState(true);
    const [downgradeTarget, setDowngradeTarget] = useState<string | null>(null);
    const [churnReason, setChurnReason] = useState<ChurnReason>(null);

    // Derive tier from session — only used once session is fully loaded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionTier = realTier || ((session?.user as any)?.subscriptionTier as string | undefined)
        ?.toUpperCase() || "FREE";
    const sessionLoading = status === "loading" || isFetchingTier;

    // Called once by BillingSearchParamsReader after mount.
    const handleSearchParams = (success: boolean, canceled: boolean, billingParam: string | null, planParam: string | null) => {
        if (billingParam === "annual") setBilling("annual");
        if (planParam) {
            const tierName = planParam.charAt(0).toUpperCase() + planParam.slice(1).toLowerCase();
            toast.info(`Complete your upgrade to ${tierName} below.`, { duration: 6000 });
            window.history.replaceState(null, "", "/dashboard/billing" + (billingParam === "annual" ? "?billing=annual" : ""));
        }
        if (success || canceled) {
            ["FREE", "STARTER", "PRO", "AGENCY"].forEach(t => sessionStorage.removeItem(`checkout_pending_${t}`));
        }
        if (success) {
            toast.success("Subscription updated successfully!");
            window.history.replaceState(null, "", "/dashboard/billing");
            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                const t = await getUserBillingTier();
                const tier = t.toUpperCase();
                if (tier !== "FREE") setRealTier(tier);
                if (tier !== "FREE" || attempts >= 5) clearInterval(poll);
            }, 2000);
            return () => clearInterval(poll);
        }
        if (canceled) {
            toast.info("Checkout was canceled.");
            window.history.replaceState(null, "", "/dashboard/billing");
        }
    };

    // One-time mount: fetch real DB tier
    useEffect(() => {
        getUserBillingTier().then(t => {
            setRealTier(t.toUpperCase());
            setIsFetchingTier(false);
        });
    }, []);


    const handleCheckout = async (tier: string) => {
        const currentOrder = TIER_ORDER[subscriptionTier] ?? 0;
        const targetOrder  = TIER_ORDER[tier] ?? 0;
        if (targetOrder < currentOrder) {
            setDowngradeTarget(tier);
            return;
        }
        await initiateCheckout(tier);
    };

    // Pause: open customer portal (user can pause from there)
    const handlePause = async () => {
        setDowngradeTarget(null);
        await handlePortal();
    };

    const initiateCheckout = async (tier: string) => {
        // Prevent double-submission: check sessionStorage flag first
        const pendingKey = `checkout_pending_${tier}`;
        if (sessionStorage.getItem(pendingKey)) {
            toast.info("A checkout session for this plan is already in progress. Please check your browser tabs.");
            return;
        }

        setIsLoading(tier);
        sessionStorage.setItem(pendingKey, "1");

        try {
            // Use a stable idempotency key: userId + tier + 10-min time bucket
            // This ensures the DB-level idempotency guard catches any duplicate requests
            // within the same 10-minute window, even across page reloads.
             
            const userId = (session?.user as any)?.id || session?.user?.email || "anon";
            const timeBucket = Math.floor(Date.now() / 1000 / 600); // 10-min window
            const rawKey = `${userId}:${tier}:${timeBucket}`;
            const idempotencyKey = Array.from(
                new Uint8Array(
                    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
                )
            ).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 36);

            const res = await fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json", "idempotency-key": idempotencyKey },
                body: JSON.stringify({ tier, billing }),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: "Failed to start checkout" }));
                throw new Error(errData.error || "Failed to start checkout");
            }
            const { url } = await res.json();
            if (url) {
                // Keep button disabled during redirect — do NOT clear the pending flag
                // It will be cleared when the user returns to billing page with ?success or ?canceled
                window.location.href = url;
            } else {
                throw new Error("No checkout URL returned from server.");
             
            }
         
        } catch (err: unknown) {
            // Only clear the flag on error so retries are allowed
            sessionStorage.removeItem(pendingKey);
            toast.error((err as Error).message);
            setIsLoading(null);
        }
        // Note: do NOT setIsLoading(null) on success — keep button disabled until redirect happens
    };

    const handlePortal = async () => {
        setIsPortalLoading(true);
        try {
            const res = await fetch("/api/stripe/portal", { method: "POST" });
             
            if (!res.ok) throw new Error((await res.json()).error || "Failed to open portal");
            window.location.href = (await res.json()).url;
         
        } catch (err: unknown) {
            toast.error((err as Error).message);
        } finally {
            setIsPortalLoading(false);
        }
    };

    const handleBuyCredits = async () => {
        setIsBuyingCredits(true);
        try {
            // Generate an idempotency key — same pattern as tier checkout
            const userId = (session?.user as any)?.id || session?.user?.email || "anon";
            const timeBucket = Math.floor(Date.now() / 1000 / 600); // 10-min window
            const rawKey = `${userId}:credit_pack:${timeBucket}`;
            const idempotencyKey = Array.from(
                new Uint8Array(
                    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
                )
            ).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 36);

            const res = await fetch("/api/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json", "idempotency-key": idempotencyKey },
                body: JSON.stringify({ mode: "payment", priceId: "credit_pack" }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Failed to start checkout");
            const { url } = await res.json();
            if (url) window.location.href = url;
        } catch (err: unknown) {
            toast.error((err as Error).message);
        } finally {
            setIsBuyingCredits(false);
        }
    };

    const getAnnualPrice = (price: string) => {
        const num = parseInt(price.replace("$", ""));
        return num ? `$${Math.round(num * 0.8)}` : price;
    };

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto fade-in-up">

            {/* ── Search-param handler (Suspense required by Next.js 14) ─── */}
            <Suspense fallback={null}>
            <BillingSearchParamsReader onMount={handleSearchParams} />
            </Suspense>

            {/* ── Downgrade confirmation modal ──────────────────────────────── */}
            {downgradeTarget && (
                <CancelRetentionModal
                    targetTier={downgradeTarget}
                    lostFeatures={DOWNGRADE_LOSSES[downgradeTarget] ?? []}
                    onDismiss={() => setDowngradeTarget(null)}
                    onProceed={async (reason: ChurnReason) => {
                        setChurnReason(reason);
                        const t = downgradeTarget;
                        setDowngradeTarget(null);
                        // Fire churn reason to API (best-effort)
                        if (reason) {
                            fetch("/api/user/churn-reason", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ reason }),
                            }).catch(() => {/* ignore */});
                        }
                        await initiateCheckout(t);
                    }}
                    onPause={handlePause}
                />
            )}

            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1">Billing &amp; Plans</h1>
                    <p className="text-muted-foreground text-sm">Manage your subscription and billing details.</p>
                </div>
                {subscriptionTier !== "FREE" && (
                    <button
                        onClick={handlePortal}
                        disabled={isPortalLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg glass border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 self-start sm:self-auto"
                    >
                        {isPortalLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Customer Portal
                    </button>
                )}
            </div>

            {/* Current plan banner */}
            <div className="card-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Current Plan</p>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <p className="text-xl font-bold text-foreground">
                            {subscriptionTier.charAt(0) + subscriptionTier.slice(1).toLowerCase()}
                        </p>
                        <span className={`text-xs px-2.5 py-1 rounded-md font-semibold border ${
                            subscriptionTier === "FREE"    ? "bg-zinc-500/10 text-muted-foreground border-zinc-500/20" :
                            subscriptionTier === "STARTER" ? "bg-sky-500/10 text-sky-400 border-sky-500/20" :
                            subscriptionTier === "PRO"     ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                "bg-purple-500/10 text-purple-400 border-purple-500/20"
                        }`}>
                            {subscriptionTier === "FREE" ? "Free forever" : "Active subscription"}
                        </span>
                    </div>
                    {subscriptionTier === "FREE" && (
                        <p className="text-sm text-muted-foreground mt-1.5">Upgrade to unlock more audits, sites, and AI automation.</p>
                    )}
                </div>
            </div>

            {/* Usage Dashboard */}
            <UsageDashboard />

            {/* Credit Usage Transparency */}
            <CreditUsagePanel />
            <CreditHistoryTable />

            {/* Monthly / Annual toggle */}
            <div className="flex items-center justify-center gap-1 bg-muted rounded-xl p-1 w-fit mx-auto">
                <button
                    onClick={() => setBilling("monthly")}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${billing === "monthly" ? "bg-white/10 text-white shadow" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Monthly
                </button>
                <button
                    onClick={() => setBilling("annual")}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${billing === "annual" ? "bg-white/10 text-white shadow" : "text-muted-foreground hover:text-foreground"
                        }`}
                >
                    Annual
                    <span className="text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold">
                        −20%
                    </span>
                </button>
            </div>

            {/* ── Plan cards ───────────────────────────────────────────────────── */}
            {sessionLoading ? (
                /* Skeleton — same 4-col grid, prevents layout shift */
                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="card-surface p-8 flex flex-col gap-4 animate-pulse">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl bg-muted" />
                                <div className="h-5 w-20 rounded bg-muted" />
                            </div>
                            <div className="h-12 w-28 rounded bg-muted" />
                            <div className="flex flex-col gap-2.5 mt-2">
                                {[0, 1, 2, 3].map(j => <div key={j} className="h-3.5 w-full rounded bg-muted" />)}
                            </div>
                            <div className="mt-auto h-11 rounded-xl bg-muted" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {plans.map((plan) => {
                        const a = accentMap[plan.accent as Accent];
                        const isCurrentTier = plan.tier === subscriptionTier;
                        const displayPrice = billing === "annual" ? getAnnualPrice(plan.price) : plan.price;
                        const Icon = plan.icon;

                        return (
                             
                            <div
                                key={plan.name}
                                className={`card-surface p-8 flex flex-col border ${isCurrentTier ? `${a.ring}` : "border-border"
                                    } ${(plan as any).popular && !isCurrentTier ? `shadow-xl ${a.glow}` : ""}`}
                            >
                                {/* ── Header: icon + name + badge ── */}
                                <div className="flex items-center gap-3 mb-6">
                                    <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${a.iconBg}`}>
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <h3 className="text-lg font-bold leading-none">{plan.name}</h3>
                                        {isCurrentTier && (
                                             
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit ${a.badge}`}>
                                                ✓ Active Plan
                                            </span>
                                        )}
                                        {(plan as any).popular && !isCurrentTier && (
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit ${a.badge}`}>
                                                Most Popular
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* ── Price ── */}
                                <div className="flex items-end gap-1.5 mb-1">
                                    <span className="text-5xl font-black tracking-tight">{displayPrice}</span>
                                    <span className="text-muted-foreground text-base mb-1.5 font-medium">{plan.period}</span>
                                </div>
                                {billing === "annual" && plan.price !== "$0" && (
                                    <p className="text-xs text-emerald-400 mb-0">Billed annually — 2 months free</p>
                                )}

                                <p className="text-sm text-muted-foreground mt-4 mb-6 leading-relaxed">{plan.description}</p>

                                {/* ── Feature list ── */}
                                <ul className="flex flex-col gap-3.5 mb-8 flex-1">
                                    {plan.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-3 text-sm">
                                            <Check className={`w-4 h-4 shrink-0 ${a.check}`} />
                                            <span className="text-foreground/80">{f}</span>
                                        </li>
                                    ))}
                                </ul>

                                {/* ── CTA ── */}
                                <button
                                    onClick={() => !isCurrentTier && handleCheckout(plan.tier)}
                                    disabled={isCurrentTier || isLoading === plan.tier}
                                    className={`w-full h-11 rounded-xl text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 ${isCurrentTier
                                        ? "bg-muted text-muted-foreground border border-border cursor-default"
                                        : `${a.btn} shadow-md hover:scale-[1.01] active:scale-[0.99]`
                                        } disabled:opacity-60`}
                                >
                                    {isLoading === plan.tier ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : isCurrentTier ? (
                                        "Current Plan"
                                    ) : (
                                        <>
                                            {plan.cta}
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Credit pack ─────────────────────────────────────────────────── */}
            <div className="card-surface p-6 border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <CreditCard className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <p className="font-bold text-sm mb-0.5">Credit packs — need more?</p>
                        <p className="text-xs text-muted-foreground max-w-sm">
                            One-time purchase. Adds 50 credits instantly — good for ~10 AEO checks or 3 blog posts.
                            Stacks on your monthly allotment and never expires.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                        <p className="text-2xl font-black">$9</p>
                        <p className="text-xs text-muted-foreground">50 credits</p>
                    </div>
                    <button
                        onClick={handleBuyCredits}
                        disabled={isBuyingCredits}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                    >
                        {isBuyingCredits ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        Buy credits
                    </button>
                </div>
            </div>

        </div>
    );
}
