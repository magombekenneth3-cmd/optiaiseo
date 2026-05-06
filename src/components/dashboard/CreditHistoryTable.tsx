"use client";

/**
 * CreditHistoryTable
 * ──────────────────
 * Paginated credit ledger showing every deduction with action label,
 * cost, balance-after, and timestamp.
 *
 * Fetches from /api/credits/history — cursor-paginated.
 */

import { useEffect, useState, useCallback } from "react";
import { Zap, Loader2, ChevronDown, Clock } from "lucide-react";

interface LedgerRow {
    id: string;
    action: string;
    label: string;
    cost: number;
    balanceAfter: number;
    createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
    full_site_audit:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
    aeo_check:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
    blog_generation:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    competitor_analysis: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    github_pr_fix:       "bg-sky-500/10 text-sky-400 border-sky-500/20",
    voice_session:       "bg-pink-500/10 text-pink-400 border-pink-500/20",
    citation_gap_check:  "bg-violet-500/10 text-violet-400 border-violet-500/20",
    repurpose_format:    "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  <  1) return "just now";
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  <  7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CreditHistoryTable() {
    const [rows, setRows]           = useState<LedgerRow[]>([]);
    const [loading, setLoading]     = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor]   = useState<string | null>(null);
    const [hasMore, setHasMore]         = useState(false);
    const [empty, setEmpty]             = useState(false);

    const fetchPage = useCallback(async (cursor?: string) => {
        if (cursor) { setLoadingMore(true); } else { setLoading(true); }
        try {
            const url = `/api/credits/history?take=15${cursor ? `&cursor=${cursor}` : ""}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            setRows(prev => cursor ? [...prev, ...data.rows] : data.rows);
            setNextCursor(data.nextCursor);
            setHasMore(data.hasMore);
            if (!cursor && data.rows.length === 0) setEmpty(true);
        } finally {
            if (cursor) { setLoadingMore(false); } else { setLoading(false); }
        }
    }, []);

    useEffect(() => { fetchPage(); }, [fetchPage]);

    if (loading) return (
        <div className="card-surface p-6 flex items-center gap-3 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading credit history…
        </div>
    );

    if (empty) return (
        <div className="card-surface p-6 text-center text-sm text-muted-foreground">
            <Zap className="w-5 h-5 mx-auto mb-2 text-amber-400/50" />
            No credit activity yet. Credits are logged after each action.
        </div>
    );

    return (
        <div className="card-surface overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold">Credit History</h3>
                    <p className="text-[11px] text-muted-foreground">Full audit log of every credit spent</p>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/30">
                            <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
                            <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Cost</th>
                            <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Balance after</th>
                            <th className="text-right px-5 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">When</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {rows.map(row => {
                            const colorCls = ACTION_COLORS[row.action] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
                            return (
                                <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                                    <td className="px-5 py-3">
                                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border ${colorCls}`}>
                                            <Zap className="w-2.5 h-2.5 shrink-0" />
                                            {row.label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`text-sm font-bold tabular-nums ${row.cost > 0 ? "text-rose-400" : "text-muted-foreground/50"}`}>
                                            {row.cost > 0 ? `−${row.cost}` : "free"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-sm font-bold tabular-nums text-foreground/70">{row.balanceAfter}</span>
                                        <span className="text-[10px] text-muted-foreground ml-1">cr</span>
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <span className="text-xs text-muted-foreground" title={new Date(row.createdAt).toLocaleString()}>
                                            {timeAgo(row.createdAt)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Load more */}
            {hasMore && (
                <div className="px-5 py-3 border-t border-border">
                    <button
                        onClick={() => fetchPage(nextCursor ?? undefined)}
                        disabled={loadingMore}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                        {loadingMore
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</>
                            : <><ChevronDown className="w-3.5 h-3.5" /> Load more</>}
                    </button>
                </div>
            )}
        </div>
    );
}
