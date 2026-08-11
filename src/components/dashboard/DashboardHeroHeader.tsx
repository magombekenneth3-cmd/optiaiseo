import Link from "next/link";
import { Zap, ArrowUpRight, TrendingUp, ShieldCheck, Activity, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/button";

interface Props {
    domain: string;
    lastAuditDate: string | null;
    seoScore: number;
    aeoScore: number;
    clicksDeltaPct: number | null;
    rankDelta: number | null;
    pendingPrsCount: number;
    siteId: string | null;
    statusHeadline: string;
}

export function DashboardHeroHeader({
    domain,
    lastAuditDate,
    seoScore,
    aeoScore,
    clicksDeltaPct,
    rankDelta,
    pendingPrsCount,
    siteId,
    statusHeadline,
}: Props) {
    const seoBadgeVariant = seoScore >= 80 ? "success" : seoScore >= 50 ? "warning" : "danger";
    const aeoBadgeVariant = aeoScore >= 70 ? "success" : aeoScore >= 40 ? "warning" : "danger";

    return (
        <div className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-6 shadow-xl shadow-black/10">
            {/* Top row: Site domain + Last audit timestamp + Run Audit CTA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5">
                <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate">
                            {domain || "Connect Domain"}
                        </h1>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {statusHeadline} {lastAuditDate ? `· Last audit ${lastAuditDate}` : ""}
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {siteId && (
                        <Link
                            href={`/dashboard/audits?siteId=${siteId}`}
                            className={buttonVariants({ variant: "default", size: "sm" })}
                        >
                            <Zap className="w-3.5 h-3.5 mr-1.5" />
                            Run Audit
                        </Link>
                    )}
                </div>
            </div>

            {/* Middle row: HOW AM I DOING? vs WHAT CHANGED? */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* How Am I Doing? */}
                <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-brand" />
                        How Am I Doing?
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-card border border-border/50 flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground">SEO Score</p>
                                <p className="text-lg font-bold text-foreground mt-0.5">{seoScore > 0 ? seoScore : "—"}</p>
                            </div>
                            <Badge variant={seoBadgeVariant}>
                                {seoScore >= 80 ? "Good" : seoScore >= 50 ? "Fair" : "Needs Fix"}
                            </Badge>
                        </div>
                        <div className="p-3 rounded-lg bg-card border border-border/50 flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground">AEO Score</p>
                                <p className="text-lg font-bold text-foreground mt-0.5">{aeoScore > 0 ? aeoScore : "—"}</p>
                            </div>
                            <Badge variant={aeoBadgeVariant}>
                                {aeoScore >= 70 ? "Good" : aeoScore >= 40 ? "Fair" : "Unranked"}
                            </Badge>
                        </div>
                    </div>
                </div>

                {/* What Changed? */}
                <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-brand" />
                        What Changed?
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-card border border-border/50">
                            <p className="text-[11px] font-medium text-muted-foreground">Organic Clicks</p>
                            <p className="text-lg font-bold text-foreground mt-0.5">
                                {clicksDeltaPct !== null ? `${clicksDeltaPct >= 0 ? "+" : ""}${clicksDeltaPct}%` : "—"}
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-card border border-border/50">
                            <p className="text-[11px] font-medium text-muted-foreground">Rank Movement</p>
                            <p className="text-lg font-bold text-foreground mt-0.5">
                                {rankDelta !== null ? `${rankDelta > 0 ? "↑ " : rankDelta < 0 ? "↓ " : ""}${Math.abs(rankDelta)}` : "—"}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom row: WHAT SHOULD I DO NEXT? */}
            <div className="p-4 rounded-xl bg-brand/5 border border-brand/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-brand flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" />
                        What Should I Do Next?
                    </p>
                    <p className="text-xs font-semibold text-foreground">
                        {pendingPrsCount > 0
                            ? `Review and deploy ${pendingPrsCount} pending GitHub auto-fix PR${pendingPrsCount !== 1 ? "s" : ""}`
                            : "Run a fresh technical audit to uncover new optimization opportunities"}
                    </p>
                </div>

                <Link
                    href={pendingPrsCount > 0 ? "/dashboard/audits" : siteId ? `/dashboard/audits?siteId=${siteId}` : "/dashboard/sites/new"}
                    className={buttonVariants({ variant: "default", size: "sm" })}
                >
                    {pendingPrsCount > 0 ? "Review PRs" : "Start Next Action"}
                    <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Link>
            </div>
        </div>
    );
}
