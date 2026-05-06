import Link from "next/link";

interface UpgradeGateProps {
    reason: "credits" | "sites" | "audits" | "blogs" | "aeo";
    currentTier: string;
}

const UPGRADE_COPY = {
    credits: {
        title: "Out of credits",
        body: "Credits refill monthly. Buy 50 more for $9, or upgrade your plan for a larger monthly allowance.",
        cta: "Buy credits — $9",
        href: "/dashboard/billing?tab=credits",
    },
    sites: {
        title: "Site limit reached",
        body: "Your plan includes your current site limit. Upgrade to monitor more domains.",
        cta: "See plans",
        href: "/dashboard/billing",
    },
    audits: {
        title: "Monthly audit limit reached",
        body: "You've reached your plan's monthly audit allowance. Upgrade for more.",
        cta: "Upgrade plan",
        href: "/dashboard/billing",
    },
    blogs: {
        title: "Monthly blog limit reached",
        body: "You've reached your plan's monthly AI Content posts. Upgrade for more.",
        cta: "Upgrade plan",
        href: "/dashboard/billing",
    },
    aeo: {
        title: "AI Visibility check limit reached",
        body: "You've reached your plan's monthly AI Visibility check limit.",
        cta: "Upgrade plan",
        href: "/dashboard/billing",
    },
} satisfies Record<UpgradeGateProps["reason"], { title: string; body: string; cta: string; href: string }>;

export function UpgradeGate({ reason, currentTier: _currentTier }: UpgradeGateProps) {
    const copy = UPGRADE_COPY[reason];
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm mb-1">{copy.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{copy.body}</p>
            </div>
            <Link
                href={copy.href}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
            >
                {copy.cta} →
            </Link>
        </div>
    );
}
