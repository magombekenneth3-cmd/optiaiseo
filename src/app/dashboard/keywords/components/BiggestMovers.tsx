"use client";

/**
 * Biggest Movers
 *
 * Shows the top gainers and top droppers from the keyword set,
 * based on positionHistory (first vs last entry).
 * Renders two side-by-side lists.
 */

import { TrendingUp, TrendingDown } from "lucide-react";
import { PositionBadge } from "./PositionBadge";

interface GscKeyword {
    keyword: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
    url: string;
    positionHistory?: { date: string; position: number }[];
}

function delta(kw: GscKeyword): number | null {
    const h = kw.positionHistory;
    if (!h || h.length < 2) return null;
    // positive = improved (position went down = good)
    return h[0].position - h[h.length - 1].position;
}

const MAX_SHOW = 5;

export function BiggestMovers({ keywords }: { keywords: GscKeyword[] }) {
    const withDelta = keywords
        .map(kw => ({ kw, d: delta(kw) }))
        .filter((x): x is { kw: GscKeyword; d: number } => x.d !== null && x.d !== 0);

    const gainers = withDelta
        .filter(x => x.d > 0)
        .sort((a, b) => b.d - a.d)
        .slice(0, MAX_SHOW);

    const droppers = withDelta
        .filter(x => x.d < 0)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_SHOW);

    if (gainers.length === 0 && droppers.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Gainers */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-brand" />
                    <h3 className="text-sm font-semibold text-foreground">Biggest Gains</h3>
                    <span className="text-xs text-muted-foreground ml-auto">{gainers.length} keywords</span>
                </div>
                {gainers.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground text-center">No gainers this period</p>
                ) : (
                    <div className="divide-y divide-border/60">
                        {gainers.map(({ kw, d }) => (
                            <div key={kw.keyword} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50 transition-colors">
                                <PositionBadge position={kw.position} />
                                <p className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{kw.keyword}</p>
                                <span className="text-sm font-bold text-brand tabular-nums shrink-0">▲ {d}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Droppers */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-destructive" />
                    <h3 className="text-sm font-semibold text-foreground">Biggest Drops</h3>
                    <span className="text-xs text-muted-foreground ml-auto">{droppers.length} keywords</span>
                </div>
                {droppers.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground text-center">No drops this period</p>
                ) : (
                    <div className="divide-y divide-border/60">
                        {droppers.map(({ kw, d }) => (
                            <div key={kw.keyword} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50 transition-colors">
                                <PositionBadge position={kw.position} />
                                <p className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{kw.keyword}</p>
                                <span className="text-sm font-bold text-destructive tabular-nums shrink-0">▼ {Math.abs(d)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
