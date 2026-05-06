import Link from "next/link";
import {
    Link2,
    FileText,
    Mic,
    BarChart2,
    Users,
    Zap,
} from "lucide-react";

interface Props {
    hasSite: boolean;
    hasAudit: boolean;
    hasAeo: boolean;
    hasKeywords: boolean;
    hasBlogs: boolean;
    hasTeam: boolean;
    hasGsc: boolean;
    siteId: string | null;
}

/**
 * NextBestActionCard
 * ─────────────────────────────────────────────────────────────────────────────
 * Shown after onboarding is complete (all 3 steps done). Replaces the empty
 * void with a rotating "what to do next" based on the first feature the user
 * hasn't yet touched. Evaluated top-to-bottom — first unmet condition wins.
 *
 * Priority order:
 *  1. GSC not connected          → highest data unlock
 *  2. No tracked keywords        → core loop
 *  3. No blog posts generated    → content value
 *  4. AEO score = 0              → AI visibility
 *  5. No team members            → agency upsell / retention via collaboration
 *  6. All done                   → evergreen "run fresh audit" CTA
 *
 * Server component — no client state needed.
 */
export function NextBestActionCard({
    hasSite,
    hasAudit,
    hasAeo,
    hasKeywords,
    hasBlogs,
    hasTeam,
    hasGsc,
    siteId,
}: Props) {
    if (!hasSite || !hasAudit) return null; // onboarding not complete

    const actions = [
        {
            condition: !hasGsc,
            icon: <Link2 className="w-5 h-5 text-violet-400" />,
            color: "violet",
            label: "Unlock your keyword data",
            desc: "Connect Google Search Console to see exactly which queries bring visitors — and which keywords you're missing.",
            cta: "Connect GSC →",
            href: "/dashboard/settings",
        },
        {
            condition: !hasKeywords,
            icon: <BarChart2 className="w-5 h-5 text-blue-400" />,
            color: "blue",
            label: "Start tracking your rankings",
            desc: "Add your most important keywords to rank tracking so you know the moment you move up or down.",
            cta: "Add Keywords →",
            href: "/dashboard/keywords",
        },
        {
            condition: !hasBlogs,
            icon: <FileText className="w-5 h-5 text-emerald-400" />,
            color: "emerald",
            label: "Publish your first AI blog post",
            desc: "Generate a fully optimised, E-E-A-T-ready article targeting your top keyword — takes 90 seconds.",
            cta: "Generate Post →",
            href: "/dashboard/blogs",
        },
        {
            condition: !hasAeo,
            icon: <Mic className="w-5 h-5 text-amber-400" />,
            color: "amber",
            label: "Check if ChatGPT cites you",
            desc: "Run your first AEO check to see whether AI engines like ChatGPT, Claude, and Perplexity mention your brand.",
            cta: "Run AEO Check →",
            href: "/dashboard/aeo",
        },
        {
            condition: !hasTeam,
            icon: <Users className="w-5 h-5 text-pink-400" />,
            color: "pink",
            label: "Bring in a team member",
            desc: "Invite a colleague or client to collaborate on audits and content — everyone sees results in real time.",
            cta: "Invite Team →",
            href: "/dashboard/team",
        },
    ];

    const active = actions.find((a) => a.condition);

    const colorMap: Record<string, { bg: string; border: string; badgeText: string }> = {
        violet: { bg: "bg-violet-950/40", border: "border-violet-500/30", badgeText: "text-violet-400/70" },
        blue:   { bg: "bg-blue-950/40",   border: "border-blue-500/30",   badgeText: "text-blue-400/70"   },
        emerald:{ bg: "bg-emerald-950/40",border: "border-emerald-500/30",badgeText: "text-emerald-400/70"},
        amber:  { bg: "bg-amber-950/40",  border: "border-amber-500/30",  badgeText: "text-amber-400/70"  },
        pink:   { bg: "bg-pink-950/40",   border: "border-pink-500/30",   badgeText: "text-pink-400/70"   },
        default:{ bg: "bg-card",          border: "border-border",        badgeText: "text-muted-foreground"},
    };

    if (!active) {
        // All actions done — evergreen nudge
        const c = colorMap.default;
        return (
            <div className={`fade-in-up rounded-2xl border ${c.border} ${c.bg} p-5 flex items-center gap-4`}>
                <div className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">You&apos;ve set everything up 🎉</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Keep the momentum going — run a weekly audit to stay ahead of new issues.
                    </p>
                </div>
                {siteId && (
                    <Link
                        href="/dashboard/audits"
                        className="shrink-0 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
                    >
                        Run Audit →
                    </Link>
                )}
            </div>
        );
    }

    const c = colorMap[active.color] ?? colorMap.default;

    return (
        <div className={`fade-in-up rounded-2xl border ${c.border} ${c.bg} p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4`}>
            <div className="shrink-0 w-10 h-10 rounded-xl bg-current/10 border border-current/20 flex items-center justify-center">
                {active.icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-widest ${c.badgeText} mb-0.5`}>
                    ⚡ Next Best Action
                </p>
                <p className="text-sm font-bold text-foreground leading-snug">{active.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-lg leading-relaxed">{active.desc}</p>
            </div>
            <Link
                href={active.href}
                className="shrink-0 px-5 py-2.5 rounded-xl bg-foreground text-background text-xs font-extrabold transition-all hover:scale-105 active:scale-95 shadow-md whitespace-nowrap"
            >
                {active.cta}
            </Link>
        </div>
    );
}
