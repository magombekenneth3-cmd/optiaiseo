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
    siteId,
    statusHeadline,
}: Props) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
                <h1
                    className="text-2xl font-bold tracking-tight text-foreground leading-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                >
                    {domain || "Command Center"}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-sm text-muted-foreground font-medium">
                        {statusHeadline}
                    </span>
                    {lastAuditDate && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                            <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                            {lastAuditDate}
                        </span>
                    )}
                </div>
            </div>

            {siteId && (
                <Link
                    href={`/dashboard/audits?siteId=${siteId}`}
                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors"
                >
                    <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                    Run Audit
                </Link>
            )}
        </div>
    );
}
