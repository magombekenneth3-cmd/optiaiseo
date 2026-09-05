import Link from "next/link";
import {
    Link2,
    FileText,
    Mic,
    BarChart2,
    Users,
    Zap,
    ChevronRight,
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
 * NextBestActionCard — Compact inline strip
 * ─────────────────────────────────────────────────────────────────────────────
 * Single-row action prompt with left accent border. Replaces the large
 * full-width banner. First unmet condition wins.
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
    if (!hasSite || !hasAudit) return null;

    const actions = [
        {
            condition: !hasGsc,
            icon: Link2,
            label: "Connect Google Search Console",
            impact: "High impact",
            effort: "Low effort",
            cta: "Connect GSC",
            href: "/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard",
        },
        {
            condition: !hasKeywords,
            icon: BarChart2,
            label: "Start tracking your rankings",
            impact: "High impact",
            effort: "Low effort",
            cta: "Add keywords",
            href: "/dashboard/keywords",
        },
        {
            condition: !hasBlogs,
            icon: FileText,
            label: "Publish your first AI blog post",
            impact: "Medium impact",
            effort: "Low effort",
            cta: "Generate post",
            href: "/dashboard/blogs",
        },
        {
            condition: !hasAeo,
            icon: Mic,
            label: "Check if ChatGPT cites you",
            impact: "Medium impact",
            effort: "Low effort",
            cta: "Run AEO check",
            href: "/dashboard/aeo",
        },
        {
            condition: !hasTeam,
            icon: Users,
            label: "Invite a team member",
            impact: "Low impact",
            effort: "Low effort",
            cta: "Invite team",
            href: "/dashboard/team",
        },
    ];

    const active = actions.find((a) => a.condition);

    if (!active) {
        // All done — evergreen nudge
        return (
            <div className="rounded-[10px] border-l-2 border-l-brand border border-border bg-card px-4 py-3 flex items-center gap-3">
                <Zap className="w-4 h-4 text-brand shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Next Best Action</p>
                    <p className="text-[13px] font-medium text-foreground">Run a fresh audit to stay ahead of new issues</p>
                </div>
                {siteId && (
                    <Link
                        href="/dashboard/audits"
                        className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-accent transition-colors"
                    >
                        Run audit <ChevronRight className="w-3 h-3" />
                    </Link>
                )}
            </div>
        );
    }

    const ActiveIcon = active.icon;

    return (
        <div className="rounded-[10px] border-l-2 border-l-brand border border-border bg-card px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <ActiveIcon className="w-4 h-4 text-brand shrink-0 mt-0.5 sm:mt-0" />
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Next Best Action</p>
                <p className="text-[13px] font-medium text-foreground leading-snug">{active.label}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                    {active.impact}
                </span>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[10px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/20">
                    {active.effort}
                </span>
                <Link
                    href={active.href}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-accent transition-colors whitespace-nowrap"
                >
                    {active.cta} <ChevronRight className="w-3 h-3" />
                </Link>
            </div>
        </div>
    );
}
