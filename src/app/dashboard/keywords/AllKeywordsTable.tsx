"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, ArrowUpDown, ExternalLink } from "lucide-react";
import { KeywordDetailDrawer, type DrawerKeyword } from "./KeywordDetailDrawer";
import { PositionBadge } from "./components/PositionBadge";

const CTR_BENCH: Record<number, number> = {
    1: 27.6, 2: 15.8, 3: 11.0, 4: 8.4, 5: 6.3,
    6: 4.9, 7: 3.9, 8: 3.3, 9: 2.7, 10: 2.4,
};

function benchCtr(pos: number) {
    if (pos <= 10) return CTR_BENCH[pos] ?? 2.4;
    return 0;
}

interface GscKeyword {
    keyword: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
    url: string;
    intent?: string | null;
    difficulty?: number | null;
    positionHistory?: { date: string; position: number }[];
}

function opportunityClicks(kw: GscKeyword) {
    if (kw.position <= 3) return 0;
    return Math.max(0, Math.round(kw.impressions * 0.278) - kw.clicks);
}

function opportunityLabel(kw: GscKeyword) {
    const b = benchCtr(kw.position);
    if (kw.position <= 3)
        return { label: "Top 3", tone: "text-brand bg-brand/10 border-brand/20" };
    if (kw.position <= 10 && kw.ctr < b * 0.6)
        return { label: "Fix CTR", tone: "text-destructive bg-destructive/10 border-destructive/20" };
    if (kw.position <= 20)
        return { label: "Improve", tone: "text-warning bg-warning/10 border-warning/20" };
    return { label: "Create", tone: "text-info bg-info/10 border-info/20" };
}

function posChange(kw: GscKeyword): number | null {
    const h = kw.positionHistory;
    if (!h || h.length < 2) return null;
    return h[0].position - h[h.length - 1].position;
}

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

type FilterTab = "all" | "critical" | "page1" | "improving" | "quickwins";
type SortKey = "opportunity" | "position" | "impressions" | "clicks" | "ctr";
type SortDir = "asc" | "desc";
const PAGE_INCREMENT = 100;

export function AllKeywordsTable({ keywords, siteId }: { keywords: GscKeyword[]; siteId: string }) {
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<FilterTab>("all");
    const [sortKey, setSortKey] = useState<SortKey>("opportunity");
    const [sortDir, setSortDir] = useState<SortDir>("desc");
    const [drawerKw, setDrawerKw] = useState<DrawerKeyword | null>(null);
    const [limit, setLimit] = useState(PAGE_INCREMENT);

    // Step 5: undo-on-remove
    const [pendingRemove, setPendingRemove] = useState<string | null>(null);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup timer on unmount
    useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

    const byTab = keywords.filter(kw => {
        if (pendingRemove === kw.keyword) return false; // optimistically hidden
        if (tab === "critical") return kw.position > 20;
        if (tab === "page1") return kw.position <= 10;
        if (tab === "improving") return posChange(kw) !== null && posChange(kw)! > 0;
        if (tab === "quickwins") return kw.position >= 11 && kw.position <= 20 && opportunityClicks(kw) > 50;
        return true;
    });

    const filtered = query.trim()
        ? byTab.filter(kw => kw.keyword.toLowerCase().includes(query.toLowerCase()))
        : byTab;

    const sorted = [...filtered].sort((a, b) => {
        const m = sortDir === "desc" ? -1 : 1;
        if (sortKey === "opportunity") return (opportunityClicks(a) - opportunityClicks(b)) * m;
        if (sortKey === "position") return (a.position - b.position) * m;
        if (sortKey === "clicks") return (a.clicks - b.clicks) * m;
        if (sortKey === "ctr") return (a.ctr - b.ctr) * m;
        return (a.impressions - b.impressions) * m;
    });

    const visible = sorted.slice(0, limit);
    const hasMore = sorted.length > limit;

    const toggleSort = useCallback((key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortKey(key); setSortDir("desc"); }
    }, [sortKey]);

    const SortIcon = ({ col }: { col: SortKey }) =>
        col !== sortKey
            ? <ArrowUpDown className="w-3 h-3 opacity-30 inline ml-0.5" />
            : <span className="text-info ml-0.5">{sortDir === "desc" ? "↓" : "↑"}</span>;

    const tabs: { id: FilterTab; label: string; count: number }[] = [
        { id: "all", label: "All", count: keywords.length },
        { id: "critical", label: "Critical", count: keywords.filter(k => k.position > 20).length },
        { id: "page1", label: "Page 1", count: keywords.filter(k => k.position <= 10).length },
        { id: "improving", label: "Improving", count: keywords.filter(k => { const c = posChange(k); return c !== null && c > 0; }).length },
        { id: "quickwins", label: "Quick Wins", count: keywords.filter(k => k.position >= 11 && k.position <= 20 && opportunityClicks(k) > 50).length },
    ];

    return (
        <>
            <div>
                <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-border">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap flex-1">
                            {tabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => { setTab(t.id); setLimit(PAGE_INCREMENT); }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                        tab === t.id
                                            ? "bg-info/15 text-info"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    }`}
                                >
                                    {t.label} <span className="opacity-60">{t.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                            <input
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search keywords…"
                                className="w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted border border-border focus:outline-none focus:border-info text-foreground placeholder:text-muted-foreground transition-colors"
                            />
                        </div>
                    </div>
                </div>

                {/* Undo banner */}
                {pendingRemove && (
                    <div className="px-5 py-2 bg-warning/10 text-warning text-xs font-medium flex items-center justify-between border-b border-border">
                        <span>Removed &ldquo;{pendingRemove}&rdquo;</span>
                        <button
                            onClick={() => {
                                if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                                setPendingRemove(null);
                            }}
                            className="underline font-semibold hover:opacity-80"
                        >
                            Undo
                        </button>
                    </div>
                )}

                {/* Mobile list */}
                <div className="md:hidden divide-y divide-border">
                    {visible.map((kw) => {
                        const oLabel = opportunityLabel(kw);
                        const change = posChange(kw);
                        return (
                            <button key={kw.keyword} onClick={() => setDrawerKw(kw)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted text-left transition-colors cursor-pointer">
                                <PositionBadge position={kw.position} change={change} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{kw.keyword}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{fmt(kw.clicks)} clicks · {fmt(kw.impressions)} impr</p>
                                </div>
                                <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded border ${oLabel.tone}`}>{oLabel.label}</span>
                            </button>
                        );
                    })}
                    {visible.length === 0 && (
                        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                            {query.trim() ? `No keywords matching "${query}"` : "No keyword data yet."}
                        </div>
                    )}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border">
                                <th className="px-5 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em]">Keyword</th>
                                <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("position")}>Pos <SortIcon col="position" /></th>
                                <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em]">Trend</th>
                                <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("impressions")}>Impressions <SortIcon col="impressions" /></th>
                                <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("ctr")}>CTR <SortIcon col="ctr" /></th>
                                <th className="px-3 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("opportunity")}>Opportunity <SortIcon col="opportunity" /></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {visible.map((kw) => {
                                const oLabel = opportunityLabel(kw);
                                const change = posChange(kw);
                                const oppClicks = opportunityClicks(kw);
                                return (
                                    <tr key={kw.keyword} onClick={() => setDrawerKw(kw)} className="hover:bg-muted/50 transition-colors group cursor-pointer">
                                        <td className="px-5 py-2.5 max-w-[220px]">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate">{kw.keyword}</p>
                                                <a href={kw.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="shrink-0 text-border hover:text-info opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5"><PositionBadge position={kw.position} change={change} /></td>
                                        <td className="px-3 py-2.5 text-xs">
                                            {change === null ? (
                                                <span className="text-muted-foreground">—</span>
                                            ) : change > 0 ? (
                                                <span className="text-brand font-medium">↑{change}</span>
                                            ) : change < 0 ? (
                                                <span className="text-destructive font-medium">↓{Math.abs(change)}</span>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="text-sm text-foreground/80 tabular-nums px-3 py-2.5">{fmt(kw.impressions)}</td>
                                        <td className={`text-sm tabular-nums px-3 py-2.5 ${kw.ctr > 5 ? "text-brand" : kw.ctr > 2 ? "text-foreground/80" : "text-warning"}`}>{kw.ctr}%</td>
                                        <td className="px-3 py-2.5">
                                            <span className="inline-flex items-center gap-1.5">
                                                {oppClicks > 0 && <span className="text-sm font-medium text-foreground tabular-nums">+{fmt(oppClicks)} clicks/mo</span>}
                                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${oLabel.tone}`}>{oLabel.label}</span>
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {visible.length === 0 && (
                                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground text-sm">
                                    {query.trim() ? `No keywords matching "${query}"` : tab === "quickwins" ? "No quick-win keywords found." : "No keyword data yet."}
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                    {hasMore && (
                        <div className="px-5 py-2.5 border-t border-border text-center">
                            <button
                                onClick={() => setLimit(l => l + PAGE_INCREMENT)}
                                className="text-xs font-semibold text-info hover:text-info/80 transition-colors"
                            >
                                Load {Math.min(PAGE_INCREMENT, sorted.length - limit)} more
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {drawerKw && (
                <KeywordDetailDrawer keyword={drawerKw} siteId={siteId} onClose={() => setDrawerKw(null)} />
            )}
        </>
    );
}
