"use client";

/**
 * UpgradeModal
 * ─────────────
 * Shown when a user hits their blog generation limit (code: "insufficient_credits"
 * or code: "rate_limit"). Presents the 3 paid plans with the recommended plan
 * highlighted, and links to /dashboard/billing to complete checkout.
 *
 * Design: dark glassmorphism, gradient spotlight, animated plan cards.
 */

import { useEffect } from "react";
import {
    X, Sparkles, Zap, Building2, Check, ArrowRight, Lock,
} from "lucide-react";

interface Plan {
    id: string;
    name: string;
    price: number;
    period: string;
    color: string;
    glow: string;
    badge?: string;
    icon: React.ReactNode;
    blogs: string;
    features: string[];
    cta: string;
    href: string;
}

const PLANS: Plan[] = [
    {
        id: "starter",
        name: "Starter",
        price: 19,
        period: "/mo",
        color: "border-blue-500/30 hover:border-blue-500/60",
        glow: "hover:shadow-[0_0_40px_rgba(59,130,246,0.15)]",
        icon: <Zap className="w-4 h-4 text-blue-400" />,
        blogs: "30 blogs/month",
        features: [
            "30 AI blog posts/month",
            "GSC keyword gap analysis",
            "Competitor gap blogging",
            "Citation readiness score",
            "E-E-A-T editorial pass",
        ],
        cta: "Start with Starter",
        href: "/dashboard/billing?plan=starter",
    },
    {
        id: "pro",
        name: "Pro",
        price: 49,
        period: "/mo",
        color: "border-emerald-500/50 hover:border-emerald-500/80",
        glow: "hover:shadow-[0_0_60px_rgba(16,185,129,0.2)] shadow-[0_0_30px_rgba(16,185,129,0.1)]",
        badge: "Most Popular",
        icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
        blogs: "300 blogs/month",
        features: [
            "300 AI blog posts/month",
            "Full AEO visibility audits",
            "Semantic gap analysis",
            "90-day visibility forecast",
            "Claude editorial rewrite",
            "CMS auto-publishing",
        ],
        cta: "Upgrade to Pro",
        href: "/dashboard/billing?plan=pro",
    },
    {
        id: "agency",
        name: "Agency",
        price: 149,
        period: "/mo",
        color: "border-violet-500/30 hover:border-violet-500/60",
        glow: "hover:shadow-[0_0_40px_rgba(139,92,246,0.15)]",
        icon: <Building2 className="w-4 h-4 text-violet-400" />,
        blogs: "Unlimited blogs",
        features: [
            "Unlimited AI blog posts",
            "Multi-site management",
            "White-label reports",
            "Priority generation queue",
            "Dedicated Slack support",
        ],
        cta: "Go Agency",
        href: "/dashboard/billing?plan=agency",
    },
];

interface Props {
    onClose: () => void;
    /** Which plan the user is currently on — used to highlight the upgrade */
    currentTier?: string;
    /** How many blogs they've used / limit */
    usedCount?: number;
    limitCount?: number;
}

export function UpgradeModal({ onClose, currentTier = "FREE", usedCount, limitCount }: Props) {
    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    // Lock body scroll
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    const recommended = currentTier === "FREE" ? "pro" : currentTier === "STARTER" ? "pro" : "agency";

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

            {/* Modal */}
            <div className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0a0a0f] shadow-[0_0_120px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Gradient spotlight top */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-40 bg-gradient-to-b from-emerald-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />

                {/* Header */}
                <div className="relative flex items-start justify-between p-6 pb-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                                <Lock className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                                Limit Reached
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-white leading-tight">
                            Unlock more AI blog posts
                        </h2>
                        {usedCount !== undefined && limitCount !== undefined ? (
                            <p className="text-sm text-muted-foreground mt-1">
                                You&apos;ve used{" "}
                                <span className="text-white font-semibold">{usedCount}/{limitCount}</span>{" "}
                                posts this month on the <span className="capitalize">{currentTier.toLowerCase()}</span> plan.
                                Upgrade to keep publishing.
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground mt-1">
                                You&apos;ve hit your monthly blog limit. Upgrade to keep publishing AI content that drives organic traffic.
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Plan cards */}
                <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 px-6 pb-6 pt-2">
                    {PLANS.map((plan) => {
                        const isRecommended = plan.id === recommended;
                        return (
                            <div
                                key={plan.id}
                                className={`relative flex flex-col rounded-xl border p-4 transition-all duration-200 cursor-default
                                    ${plan.color} ${plan.glow}
                                    ${isRecommended ? "bg-gradient-to-b from-emerald-500/5 to-transparent" : "bg-white/[0.02]"}
                                `}
                            >
                                {/* Badge */}
                                {plan.badge && (
                                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                                        <span className="px-3 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500 text-black uppercase tracking-wider shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                                            {plan.badge}
                                        </span>
                                    </div>
                                )}

                                {/* Plan name + icon */}
                                <div className="flex items-center gap-2 mb-3">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center border
                                        ${plan.id === "pro" ? "bg-emerald-500/10 border-emerald-500/20" :
                                          plan.id === "agency" ? "bg-violet-500/10 border-violet-500/20" :
                                          "bg-blue-500/10 border-blue-500/20"}
                                    `}>
                                        {plan.icon}
                                    </div>
                                    <span className="text-sm font-bold text-white">{plan.name}</span>
                                </div>

                                {/* Price */}
                                <div className="flex items-baseline gap-0.5 mb-1">
                                    <span className="text-2xl font-black text-white">${plan.price}</span>
                                    <span className="text-xs text-muted-foreground">{plan.period}</span>
                                </div>
                                <p className="text-[11px] font-semibold text-muted-foreground mb-3">
                                    {plan.blogs}
                                </p>

                                {/* Features */}
                                <ul className="space-y-1.5 flex-1 mb-4">
                                    {plan.features.map((f) => (
                                        <li key={f} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                                            <Check className={`w-3 h-3 mt-0.5 shrink-0
                                                ${plan.id === "pro" ? "text-emerald-400" :
                                                  plan.id === "agency" ? "text-violet-400" :
                                                  "text-blue-400"}
                                            `} />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA */}
                                <a
                                    href={plan.href}
                                    className={`inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-sm font-bold transition-all
                                        ${isRecommended
                                            ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.25)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)]"
                                            : "bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20"
                                        }
                                    `}
                                >
                                    {plan.cta}
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </a>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">
                        All plans include a 14-day money-back guarantee. Cancel anytime.
                    </p>
                    <button
                        onClick={onClose}
                        className="text-[11px] text-muted-foreground hover:text-white transition-colors"
                    >
                        Continue on free plan
                    </button>
                </div>
            </div>
        </div>
    );
}
