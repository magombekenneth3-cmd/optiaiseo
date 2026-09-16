"use client";

import Link from "next/link";
import { Zap, Clock } from "lucide-react";

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
    siteId,
    statusHeadline,
}: Props) {
    const seoPillTone = seoScore >= 80 ? "text-emerald-300 border-emerald-500/25 bg-emerald-500/10" : seoScore >= 60 ? "text-amber-300 border-amber-500/25 bg-amber-500/10" : "text-rose-300 border-rose-500/25 bg-rose-500/10";
    const aeoPillTone = aeoScore >= 80 ? "text-sky-300 border-sky-500/25 bg-sky-500/10" : aeoScore >= 60 ? "text-violet-300 border-violet-500/25 bg-violet-500/10" : "text-muted-foreground border-border bg-background/50";

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <h1
                    className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                >
                    {domain || "Command Center"}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-brand/20 bg-brand/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">
                        {statusHeadline}
                    </span>

                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${seoPillTone}`}>
                        SEO {seoScore}
                    </span>

                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${aeoPillTone}`}>
                        AEO {aeoScore}
                    </span>

                    {lastAuditDate && (
                        <span className="flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                            <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                            {lastAuditDate}
                        </span>
                    )}
                </div>
            </div>

            {siteId && (
                <Link
                    href={`/dashboard/audits?siteId=${siteId}`}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-brand/20 transition-colors hover:bg-brand/90"
                >
                    <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                    Run Audit
                </Link>
            )}
        </div>
    );
}
