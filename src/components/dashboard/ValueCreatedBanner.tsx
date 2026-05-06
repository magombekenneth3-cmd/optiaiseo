import Link from "next/link";
import { TrendingUp, GitBranch, Cpu } from "lucide-react";

interface Props {
    clicksGained: number | null;       // GSC clicks delta this month vs last month
    prsCreatedThisMonth: number;       // GitHub auto-fix PRs merged/opened this month
    aiCitationsThisMonth: number;      // AeoEvent count with eventType "CITED" this month
    organicTrafficDelta: number | null; // from MetricSnapshot delta
}

/**
 * ValueCreatedBanner
 * ─────────────────────────────────────────────────────────────────────────────
 * A persistent top-of-dashboard banner that answers "what has OptiAISEO
 * actually done for me this month?" in concrete, verifiable numbers.
 *
 * This is the single most important anti-churn signal — users who SEE value
 * are 3× less likely to cancel than users who only see features.
 *
 * Only rendered if there is at least one non-zero value to show.
 * Server component — data resolved in dashboard/page.tsx.
 */
export function ValueCreatedBanner({
    clicksGained,
    prsCreatedThisMonth,
    aiCitationsThisMonth,
    organicTrafficDelta,
}: Props) {
    const items = [
        clicksGained !== null && clicksGained > 0 && {
            icon: <TrendingUp className="w-4 h-4 text-emerald-400" />,
            value: `+${clicksGained.toLocaleString()}`,
            label: "estimated clicks gained",
            colour: "emerald",
            href: "/dashboard/keywords",
        },
        prsCreatedThisMonth > 0 && {
            icon: <GitBranch className="w-4 h-4 text-blue-400" />,
            value: String(prsCreatedThisMonth),
            label: `issue${prsCreatedThisMonth !== 1 ? "s" : ""} auto-fixed via PR`,
            colour: "blue",
            href: "/dashboard/audits",
        },
        aiCitationsThisMonth > 0 && {
            icon: <Cpu className="w-4 h-4 text-violet-400" />,
            value: String(aiCitationsThisMonth),
            label: `AI citation${aiCitationsThisMonth !== 1 ? "s" : ""} detected`,
            colour: "violet",
            href: "/dashboard/aeo",
        },
        organicTrafficDelta !== null && organicTrafficDelta > 0 && {
            icon: <TrendingUp className="w-4 h-4 text-amber-400" />,
            value: `+${organicTrafficDelta.toLocaleString()}`,
            label: "organic visitors this month",
            colour: "amber",
            href: "/dashboard/keywords",
        },
    ].filter(Boolean) as Array<{
        icon: React.ReactNode;
        value: string;
        label: string;
        colour: string;
        href: string;
    }>;

    // Don't show if nothing to surface
    if (items.length === 0) return null;

    const colourMap: Record<string, { text: string; bg: string; border: string }> = {
        emerald: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
        blue:    { text: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20"    },
        violet:  { text: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/20"  },
        amber:   { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"   },
    };

    return (
        <div className="fade-in-up w-full rounded-2xl border border-emerald-500/20 bg-emerald-950/30 p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* Label */}
                <div className="shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/70 mb-0.5">
                        📈 This Month
                    </p>
                    <p className="text-sm font-bold text-foreground whitespace-nowrap">
                        OptiAISEO delivered:
                    </p>
                </div>

                {/* Divider */}
                <div className="hidden sm:block w-px h-8 bg-border shrink-0" />

                {/* Value items */}
                <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                    {items.map((item) => {
                        const c = colourMap[item.colour];
                        return (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all hover:scale-105 ${c.text} ${c.bg} ${c.border}`}
                            >
                                {item.icon}
                                <span className="font-black">{item.value}</span>
                                <span className="opacity-80">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
