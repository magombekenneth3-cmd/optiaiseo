"use client";

import { useState } from "react";
import { Search, ArrowUpDown, ExternalLink, ChevronDown } from "lucide-react";
import { KeywordDetailDrawer, type DrawerKeyword } from "./KeywordDetailDrawer";

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
        return { label: "Top 3", color: "#2ea043", bg: "rgba(46,160,67,0.1)" };
    if (kw.position <= 10 && kw.ctr < b * 0.6)
        return { label: "Fix CTR", color: "#f85149", bg: "rgba(248,81,73,0.1)" };
    if (kw.position <= 20)
        return { label: "Improve", color: "#d29922", bg: "rgba(210,153,34,0.1)" };
    return { label: "Create", color: "#388bfd", bg: "rgba(56,139,253,0.1)" };
}

function posChange(kw: GscKeyword): number | null {
    const h = kw.positionHistory;
    if (!h || h.length < 2) return null;
    return h[0].position - h[h.length - 1].position;
}

function PositionBadge({ position }: { position: number }) {
    if (position <= 3) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">#{position}</span>;
    if (position <= 10) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">#{position}</span>;
    if (position <= 20) return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">#{position}</span>;
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">#{position}</span>;
}

type FilterTab = "all" | "critical" | "page1" | "improving" | "quickwins";
type SortKey = "opportunity" | "position" | "impressions" | "clicks" | "ctr";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 100;

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export function AllKeywordsTable({ keywords, siteId }: { keywords: GscKeyword[]; siteId: string }) {
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<FilterTab>("all");
    const [sortKey, setSortKey] = useState<SortKey>("opportunity");
    const [sortDir, setSortDir] = useState<SortDir>("desc");
    const [drawerKw, setDrawerKw] = useState<DrawerKeyword | null>(null);

    const byTab = keywords.filter(kw => {
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

    const visible = sorted.slice(0, PAGE_SIZE);

    function toggleSort(key: SortKey) {
        if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortKey(key); setSortDir("desc"); }
    }

    const SortIcon = ({ col }: { col: SortKey }) =>
        col !== sortKey
            ? <ArrowUpDown className="w-3 h-3 opacity-30 inline ml-0.5" />
            : <span className="text-[#388bfd] ml-0.5">{sortDir === "desc" ? "↓" : "↑"}</span>;

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
                <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-[#21262d]">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap flex-1">
                            {tabs.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                                        tab === t.id
                                            ? "bg-[#388bfd]/15 text-[#388bfd]"
                                            : "text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#161b22]"
                                    }`}
                                >
                                    {t.label} <span className="opacity-60">{t.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681] pointer-events-none" />
                            <input
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search keywords…"
                                className="w-48 pl-8 pr-3 py-1.5 text-[11px] rounded-lg bg-[#161b22] border border-[#30363d] focus:outline-none focus:border-[#388bfd] text-[#c9d1d9] placeholder:text-[#6e7681] transition-colors"
                            />
                        </div>
                    </div>
                </div>

                <div className="md:hidden divide-y divide-[#161b22]">
                    {visible.map((kw, i) => {
                        const oLabel = opportunityLabel(kw);
                        return (
                            <button key={i} onClick={() => setDrawerKw(kw)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#0f1318] text-left transition-colors">
                                <PositionBadge position={kw.position} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-medium text-[#e6edf3] truncate">{kw.keyword}</p>
                                    <p className="text-[10px] text-[#6e7681] mt-0.5">{fmt(kw.clicks)} clicks · {fmt(kw.impressions)} impr</p>
                                </div>
                                <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: oLabel.color, background: oLabel.bg }}>{oLabel.label}</span>
                            </button>
                        );
                    })}
                    {visible.length === 0 && (
                        <div className="px-4 py-12 text-center text-[12px] text-[#6e7681]">
                            {query.trim() ? `No keywords matching "${query}"` : "No keyword data yet."}
                        </div>
                    )}
                </div>

                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead>
                            <tr className="border-b border-[#21262d] bg-[#0a0d11]">
                                <th className="px-5 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Keyword</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("position")}>Pos <SortIcon col="position" /></th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Trend</th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("impressions")}>Impressions <SortIcon col="impressions" /></th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("ctr")}>CTR <SortIcon col="ctr" /></th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none" onClick={() => toggleSort("opportunity")}>Opportunity <SortIcon col="opportunity" /></th>
                                <th className="px-3 py-2.5 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#161b22]">
                            {visible.map((kw, i) => {
                                const oLabel = opportunityLabel(kw);
                                const change = posChange(kw);
                                return (
                                    <tr key={i} className="hover:bg-[#0f1318] transition-colors group">
                                        <td className="px-5 py-2.5 max-w-[220px]">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <p className="text-[12px] font-medium text-[#e6edf3] truncate">{kw.keyword}</p>
                                                <a href={kw.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#30363d] hover:text-[#388bfd] opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5"><PositionBadge position={kw.position} /></td>
                                        <td className="px-3 py-2.5 text-[11px]">
                                            {change === null ? (
                                                <span className="text-[#6e7681]">—</span>
                                            ) : change > 0 ? (
                                                <span className="text-[#2ea043] font-medium">↑{change}</span>
                                            ) : change < 0 ? (
                                                <span className="text-[#f85149] font-medium">↓{Math.abs(change)}</span>
                                            ) : (
                                                <span className="text-[#6e7681]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-[12px] text-[#c9d1d9] tabular-nums">{fmt(kw.impressions)}</td>
                                        <td className="px-3 py-2.5 text-[12px] tabular-nums" style={{ color: kw.ctr > 5 ? "#2ea043" : kw.ctr > 2 ? "#c9d1d9" : "#d29922" }}>{kw.ctr}%</td>
                                        <td className="px-3 py-2.5">
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: oLabel.color, background: oLabel.bg }}>{oLabel.label}</span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <button
                                                onClick={() => setDrawerKw(kw)}
                                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] border border-[#30363d] transition-colors"
                                            >
                                                View<ChevronDown className="w-3 h-3" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {visible.length === 0 && (
                                <tr><td colSpan={7} className="px-6 py-12 text-center text-[#6e7681] text-[12px]">
                                    {query.trim() ? `No keywords matching "${query}"` : tab === "quickwins" ? "No quick-win keywords found." : "No keyword data yet."}
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                    {filtered.length > PAGE_SIZE && (
                        <div className="px-5 py-2.5 border-t border-[#21262d] text-[11px] text-[#6e7681]">
                            Showing top {PAGE_SIZE} of {filtered.length} keywords
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
