import Link from "next/link";
import { Lock, CheckCircle2 } from "lucide-react";

const CREDITS_PRICE = "$9";

interface UpgradeGateProps {
    reason: "credits" | "sites" | "audits" | "blogs" | "aeo";
    currentTier: string;
}

const UPGRADE_COPY = {
    credits: {
        title: "You've run out of credits",
        body: `Credits refill monthly on your plan. Buy a one-time top-up for ${CREDITS_PRICE}, or upgrade for a larger monthly allowance.`,
        cta: `Buy 50 credits — ${CREDITS_PRICE}`,
        secondaryCta: "View plans",
        href: "/dashboard/billing?tab=credits",
        secondaryHref: "/dashboard/billing",
        features: ["Instant delivery", "Never expire", "Stack with plan credits"],
    },
    sites: {
        title: "Site limit reached",
        body: "Upgrade to monitor more domains and unlock multi-site reporting.",
        cta: "Upgrade plan",
        secondaryCta: "Compare plans",
        href: "/dashboard/billing",
        secondaryHref: "/dashboard/billing",
        features: ["Unlimited sites on Agency", "Cross-site reporting", "White-label reports"],
    },
    audits: {
        title: "Monthly audit limit reached",
        body: "You've used all audits for this billing period. Upgrade for more monthly audits.",
        cta: "Upgrade plan",
        secondaryCta: "See plans",
        href: "/dashboard/billing",
        secondaryHref: "/dashboard/billing",
        features: ["Daily audits on Pro", "Auto-scheduled audits", "Historical score tracking"],
    },
    blogs: {
        title: "AI Content limit reached",
        body: "You've used this month's AI Content posts. Upgrade to publish more SEO-optimised content.",
        cta: "Upgrade plan",
        secondaryCta: null as string | null,
        href: "/dashboard/billing",
        secondaryHref: null as string | null,
        features: ["Unlimited posts on Agency", "Auto-publish to WordPress", "Featured snippet optimizer"],
    },
    aeo: {
        title: "AI Visibility limit reached",
        body: "You've reached your monthly AI Visibility check limit. Upgrade to track more queries.",
        cta: "Upgrade plan",
        secondaryCta: null as string | null,
        href: "/dashboard/billing",
        secondaryHref: null as string | null,
        features: ["Daily AI Visibility checks", "ChatGPT + Gemini + Perplexity", "Citation gap analysis"],
    },
} satisfies Record<UpgradeGateProps["reason"], {
    title: string; body: string; cta: string;
    secondaryCta: string | null; href: string; secondaryHref: string | null;
    features: string[];
}>;

export function UpgradeGate({ reason, currentTier }: UpgradeGateProps) {
    const copy = UPGRADE_COPY[reason];
    const isPaidUser = ["STARTER", "PRO", "AGENCY"].includes((currentTier ?? "").toUpperCase());

    const body = (reason === "credits" && isPaidUser)
        ? "Credits refill monthly. Buy more credits to continue, or contact support about higher limits."
        : copy.body;

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Top accent bar */}
            <div className="h-1 w-full" style={{ background: "var(--brand)" }} />

            <div className="p-6 flex flex-col sm:flex-row gap-6 items-start">
                {/* Lock icon */}
                <div className="shrink-0 w-12 h-12 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-brand" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base text-foreground mb-1">{copy.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">{body}</p>

                    {/* Feature bullets */}
                    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mb-5">
                        {copy.features.map(f => (
                            <li key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <CheckCircle2 className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
                                {f}
                            </li>
                        ))}
                    </ul>

                    {/* CTAs */}
                    <div className="flex flex-wrap gap-3">
                        <Link
                            href={copy.href}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold hover:brightness-110 transition-all"
                            style={{ boxShadow: "0 4px 14px rgba(16,185,129,0.25)" }}
                        >
                            {copy.cta}
                        </Link>
                        {copy.secondaryCta && copy.secondaryHref && (
                            <Link
                                href={copy.secondaryHref}
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                                {copy.secondaryCta}
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
