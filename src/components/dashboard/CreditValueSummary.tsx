import Link from "next/link";
import { Zap, FileText, BarChart2, Mic, GitBranch } from "lucide-react";

interface CreditSummaryItem {
    icon: React.ReactNode;
    label: string;
    count: number;
    colour: string;
}

interface Props {
    auditsThisMonth: number;
    blogsThisMonth: number;
    aeoChecksThisMonth: number;
    keywordsTracked: number;
    prsThisMonth: number;
    creditsRemaining: number;
    creditLimit: number;
}

/**
 * CreditValueSummary
 * ─────────────────────────────────────────────────────────────────────────────
 * Transforms the raw "credits remaining" number into a "what you got this
 * month" narrative. Users who see VALUE feel less like they are burning money
 * and more like they have an active, working asset.
 *
 * Server component — data passed from dashboard/page.tsx.
 */
export function CreditValueSummary({
    auditsThisMonth,
    blogsThisMonth,
    aeoChecksThisMonth,
    keywordsTracked,
    prsThisMonth,
    creditsRemaining,
    creditLimit,
}: Props) {
    const usedPct = creditLimit > 0
        ? Math.min(100, Math.round(((creditLimit - creditsRemaining) / creditLimit) * 100))
        : 0;

    const items: CreditSummaryItem[] = [
        {
            icon: <BarChart2 className="w-3.5 h-3.5" />,
            label: `${auditsThisMonth} audit${auditsThisMonth !== 1 ? "s" : ""} run`,
            count: auditsThisMonth,
            colour: "emerald",
        },
        {
            icon: <FileText className="w-3.5 h-3.5" />,
            label: `${blogsThisMonth} blog post${blogsThisMonth !== 1 ? "s" : ""} generated`,
            count: blogsThisMonth,
            colour: "violet",
        },
        {
            icon: <Mic className="w-3.5 h-3.5" />,
            label: `${aeoChecksThisMonth} AEO check${aeoChecksThisMonth !== 1 ? "s" : ""} run`,
            count: aeoChecksThisMonth,
            colour: "amber",
        },
        {
            icon: <GitBranch className="w-3.5 h-3.5" />,
            label: `${prsThisMonth} auto-fix PR${prsThisMonth !== 1 ? "s" : ""} created`,
            count: prsThisMonth,
            colour: "blue",
        },
    ].filter((i) => i.count > 0);

    const colourMap: Record<string, string> = {
        emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
        violet:  "text-violet-400 bg-violet-500/10 border-violet-500/20",
        amber:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
        blue:    "text-blue-400 bg-blue-500/10 border-blue-500/20",
    };

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                        <Zap className="w-4 h-4 text-violet-400" />
                    </div>
                    <div>
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                            This Month&apos;s Activity
                        </p>
                        <p className="text-sm font-bold text-foreground leading-tight">
                            What your credits built
                        </p>
                    </div>
                </div>
                <Link
                    href="/dashboard/billing"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                    {creditsRemaining} left
                </Link>
            </div>

            {/* Activity items */}
            {items.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                    {items.map((item) => (
                        <div
                            key={item.label}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${colourMap[item.colour]}`}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </div>
                    ))}
                    {keywordsTracked > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold text-blue-400 bg-blue-500/10 border-blue-500/20 col-span-2">
                            <BarChart2 className="w-3.5 h-3.5" />
                            <span>{keywordsTracked} keyword{keywordsTracked !== 1 ? "s" : ""} tracked daily</span>
                        </div>
                    )}
                </div>
            ) : (
                <p className="text-xs text-muted-foreground italic">
                    No activity this month yet — run an audit to get started.
                </p>
            )}

            {/* Credit bar */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium">
                    <span>{creditLimit - creditsRemaining} credits used</span>
                    <span>{usedPct}% of {creditLimit}</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all ${
                            usedPct >= 90 ? "bg-rose-500" : usedPct >= 70 ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                        style={{ width: `${usedPct}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
