"use client";

import Link from "next/link";
import { Zap, Globe, Clock } from "lucide-react";

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

/**
 * DashboardHeroHeader
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal single-row header: page title + domain/last-audit context + Run Audit CTA.
 * No nested card containers, no decorative backgrounds.
 * Score data surfaces in the KPI row below; this header is purely contextual.
 */
export function DashboardHeroHeader({
    domain,
    lastAuditDate,
    siteId,
    statusHeadline,
}: Props) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            {/* Left: title + context */}
            <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-foreground leading-tight">
                    Dashboard
                </h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    {domain && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                            <Globe className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span className="truncate max-w-[200px]">{domain}</span>
                        </span>
                    )}
                    {lastAuditDate && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                            Last audit {lastAuditDate}
                        </span>
                    )}
                    {!lastAuditDate && !domain && (
                        <span className="text-xs text-muted-foreground">{statusHeadline}</span>
                    )}
                </div>
            </div>

            {/* Right: Run Audit CTA */}
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
