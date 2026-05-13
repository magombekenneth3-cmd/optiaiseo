"use client";

import { useState } from "react";
import { Search, ArrowUpDown, Zap, Microscope } from "lucide-react";
import { KeywordSparkline } from "@/components/dashboard/KeywordSparkline";
import { DifficultyBadge } from "@/components/dashboard/DifficultyBadge";
import { IntentBadge } from "@/components/dashboard/IntentBadge";
import { KeywordSerpPanel } from "@/components/dashboard/KeywordSerpPanel";

function PositionBadge({ position }: { position: number }) {
    if (position <= 3)  return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[11px] font-bold border border-emerald-500/20">#{position}</span>;
    if (position <= 10) return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[11px] font-bold border border-blue-500/20">#{position}</span>;
    if (position <= 20) return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-[11px] font-bold border border-amber-500/20">#{position}</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-[11px] font-bold border border-red-500/20">#{position}</span>;
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

function opportunityClicks(kw: GscKeyword): number {
    if (kw.position <= 3) return 0;
    return Math.max(0, Math.round(kw.impressions * 0.278) - kw.clicks);
}

type FilterTab = "all" | "page1" | "page2" | "quickwins";
type SortKey = "impressions" | "position" | "clicks" | "opportunity";
type SortDir = "asc" | "desc";

interface Props {
    keywords: GscKeyword[];
    siteId: string;
}

const PAGE_SIZE = 100;

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export function AllKeywordsTable({ keywords, siteId }: Props) {
    const [query, setQuery]           = useState("");
    const [tab, setTab]               = useState<FilterTab>("all");
    const [sortKey, setSortKey]       = useState<SortKey>("impressions");
    const [sortDir, setSortDir]       = useState<SortDir>("desc");
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    const byTab = keywords.filter(kw => {
        if (tab === "page1")     return kw.position <= 10;
        if (tab === "page2")     return kw.position >= 11 && kw.position <= 20;
        if (tab === "quickwins") return kw.position >= 11 && kw.position <= 20 && opportunityClicks(kw) > 100;
        return true;
    });

    const filtered = query.trim()
        ? byTab.filter(kw => kw.keyword.toLowerCase().includes(query.toLowerCase()))
        : byTab;

    const sorted = [...filtered].sort((a, b) => {
        const mult = sortDir === "desc" ? -1 : 1;
        if (sortKey === "opportunity") return (opportunityClicks(a) - opportunityClicks(b)) * mult;
        if (sortKey === "position")    return (a.position - b.position) * mult;
        if (sortKey === "clicks")      return (a.clicks - b.clicks) * mult;
        return (a.impressions - b.impressions) * mult;
    });

    const visible = sorted.slice(0, PAGE_SIZE);
    const quickWinCount = keywords.filter(kw => kw.position >= 11 && kw.position <= 20 && opportunityClicks(kw) > 100).length;

    function toggleSort(key: SortKey) {
        if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortKey(key); setSortDir("desc"); }
    }

    function SortIcon({ col }: { col: SortKey }) {
        if (col !== sortKey) return <ArrowUpDown className="w-3 h-3 opacity-30 inline" />;
        return <span className="text-[#388bfd]">{sortDir === "desc" ? " ↓" : " ↑"}</span>;
    }

    const filterTabs = [
        { id: "all"      as FilterTab, label: `All (${keywords.length})`,                                                    highlight: false },
        { id: "page1"    as FilterTab, label: `Page 1 (${keywords.filter(k => k.position <= 10).length})`,                  highlight: false },
        { id: "page2"    as FilterTab, label: `Page 2 (${keywords.filter(k => k.position >= 11 && k.position <= 20).length})`, highlight: false },
        { id: "quickwins"as FilterTab, label: `⚡ Quick Wins (${quickWinCount})`,                                            highlight: true  },
    ];

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            {/* Header controls */}
            <div className="flex flex-col gap-3 px-5 py-4 border-b border-[#21262d]">
                <div className="flex items-center gap-3 flex-wrap">
                    <div>
                        <h2 className="text-[15px] font-semibold text-[#e6edf3]">All Keywords</h2>
                        <p className="text-[11px] text-[#6e7681] mt-0.5">
                            {query.trim() ? `${filtered.length} of ${keywords.length} keywords` : `${keywords.length} unique keywords · sorted by impressions`}
                        </p>
                    </div>
                    <div className="ml-auto relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681] pointer-events-none" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Filter keywords…"
                            className="w-52 pl-8 pr-3 py-1.5 text-[12px] rounded-lg bg-[#161b22] border border-[#30363d] focus:outline-none focus:border-[#388bfd] text-[#c9d1d9] placeholder:text-[#6e7681] transition-colors"
                        />
                    </div>
                </div>

                {/* Filter tabs */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    {filterTabs.map(({ id, label, highlight }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors border ${
                                tab === id
                                    ? highlight
                                        ? "bg-[#d29922]/20 border-[#d29922]/30 text-[#d29922]"
                                        : "bg-[#388bfd]/15 border-[#388bfd]/25 text-[#388bfd]"
                                    : "border-[#30363d] text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#161b22]"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-[#161b22]">
                {visible.map((kw, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                        <PositionBadge position={kw.position} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-[#e6edf3] truncate">{kw.keyword}</p>
                            <p className="text-[11px] text-[#6e7681] mt-0.5">
                                {fmt(kw.clicks)} clicks · {fmt(kw.impressions)} impr · {kw.ctr}% CTR
                            </p>
                        </div>
                    </div>
                ))}
                {visible.length === 0 && (
                    <div className="px-4 py-12 text-center text-[13px] text-[#6e7681]">
                        {query.trim() ? `No keywords matching "${query}"` : "No keyword data yet."}
                    </div>
                )}
            </div>

            {/* Desktop table — 6 columns (was 10) */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                        <tr className="border-b border-[#21262d] bg-[#0a0d11]">
                            <th className="px-5 py-3 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Keyword</th>
                            <th
                                className="px-4 py-3 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none hover:text-[#8b949e]"
                                onClick={() => toggleSort("position")}
                            >
                                Position <SortIcon col="position" />
                            </th>
                            <th
                                className="px-4 py-3 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em] cursor-pointer select-none hover:text-[#8b949e]"
                                onClick={() => toggleSort("clicks")}
                            >
                                Clicks <SortIcon col="clicks" />
                            </th>
                            <th className="px-4 py-3 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">CTR</th>
                            <th
                                className="px-4 py-3 text-[10px] font-bold text-[#d29922]/80 uppercase tracking-[0.06em] cursor-pointer select-none hover:text-[#d29922]"
                                onClick={() => toggleSort("opportunity")}
                            >
                                <span className="flex items-center gap-1"><Zap className="w-3 h-3" />Opportunity <SortIcon col="opportunity" /></span>
                            </th>
                            <th className="px-4 py-3 text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Analyse</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#161b22]">
                        {visible.map((kw, i) => {
                            const opp = opportunityClicks(kw);
                            const isExpanded = expandedRow === kw.keyword;
                            const isTrendingUp   = kw.position <= 10 && kw.ctr > 2;
                            const isTrendingDown = kw.position > 20  && kw.ctr < 1;

                            return (
                                <>
                                    <tr
                                        key={i}
                                        className={`transition-colors group ${isExpanded ? "bg-[#161b22]" : "hover:bg-[#0f1318]"}`}
                                    >
                                        {/* Keyword cell — keyword + url + sparkline */}
                                        <td className="px-5 py-3 max-w-[240px]">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-medium text-[#e6edf3] truncate" title={kw.keyword}>
                                                        {kw.keyword}
                                                    </p>
                                                    <p className="text-[10px] text-[#6e7681] truncate mt-0.5 max-w-[200px]">
                                                        {kw.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                                                    </p>
                                                    {/* Intent + Difficulty folded inline at xs size */}
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <IntentBadge intent={kw.intent ?? null} />
                                                        <DifficultyBadge score={kw.difficulty ?? null} />
                                                    </div>
                                                </div>
                                                <KeywordSparkline
                                                    data={kw.positionHistory && kw.positionHistory.length >= 2 ? kw.positionHistory : [{ date: "now", position: kw.position }]}
                                                    trend={isTrendingUp ? "up" : isTrendingDown ? "down" : "flat"}
                                                    width={56}
                                                    height={22}
                                                />
                                            </div>
                                        </td>

                                        {/* Position */}
                                        <td className="px-4 py-3">
                                            <PositionBadge position={kw.position} />
                                        </td>

                                        {/* Clicks + impressions sub-line */}
                                        <td className="px-4 py-3">
                                            <p className="text-[13px] font-semibold text-[#2ea043]">{fmt(kw.clicks)}</p>
                                            <p className="text-[10px] text-[#6e7681] mt-0.5">{fmt(kw.impressions)} impr</p>
                                        </td>

                                        {/* CTR */}
                                        <td className="px-4 py-3 text-[13px] text-[#8b949e]">{kw.ctr}%</td>

                                        {/* Opportunity */}
                                        <td className="px-4 py-3">
                                            {opp > 50 ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d29922]/10 border border-[#d29922]/20 text-[#d29922] text-[11px] font-semibold">
                                                    <Zap className="w-2.5 h-2.5" />+{fmt(opp)}/mo
                                                </span>
                                            ) : opp > 0 ? (
                                                <span className="text-[11px] text-[#6e7681]">+{opp}/mo</span>
                                            ) : (
                                                <span className="text-[11px] text-emerald-400/60">✓ Top 3</span>
                                            )}
                                        </td>

                                        {/* Analyse */}
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => setExpandedRow(isExpanded ? null : kw.keyword)}
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                                                    isExpanded
                                                        ? "bg-[#388bfd]/15 border-[#388bfd]/25 text-[#388bfd]"
                                                        : "border-[#30363d] text-[#6e7681] hover:text-[#c9d1d9] hover:border-[#388bfd]/30"
                                                }`}
                                            >
                                                <Microscope className="w-3 h-3" />
                                                {isExpanded ? "Close" : "Analyse"}
                                            </button>
                                        </td>
                                    </tr>

                                    {/* Expanded SERP panel */}
                                    {isExpanded && (
                                        <tr key={`serp-${i}`}>
                                            <td colSpan={6} className="p-0">
                                                <KeywordSerpPanel
                                                    keyword={kw.keyword}
                                                    position={kw.position}
                                                    impressions={kw.impressions}
                                                    clicks={kw.clicks}
                                                    landingUrl={kw.url}
                                                    siteId={siteId}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}

                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-[#6e7681] text-[13px]">
                                    {query.trim()
                                        ? `No keywords matching "${query}"`
                                        : tab === "quickwins"
                                            ? "No quick-win keywords found. Come back once you have page-2 rankings."
                                            : "No keyword data yet. Make sure your site is verified in Search Console."}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {filtered.length > PAGE_SIZE && (
                    <div className="px-5 py-3 border-t border-[#21262d] text-[11px] text-[#6e7681]">
                        Showing top {PAGE_SIZE} of {filtered.length} keywords{query.trim() && ` matching "${query}"`}
                    </div>
                )}
            </div>
        </div>
    );
}
