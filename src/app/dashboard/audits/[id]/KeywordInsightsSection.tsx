/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback } from "react";
import { getKeywordRankingsFast } from "@/app/actions/keywords";
import QueryDeepDive from "@/components/dashboard/QueryDeepDive";
import {
    TrendingUp, Search, Zap, AlertTriangle,
    ChevronDown, ExternalLink, ArrowUpRight,
} from "lucide-react";

interface KeywordRow {
    keyword: string; url: string;
    clicks: number; impressions: number; ctr: number; position: number;
}
interface Opportunity {
    keyword: string; clicks: number; impressions: number;
    ctr: number; avgPosition: number;
    opportunityScore: number; opportunityType: string; reason: string;
}
interface Summary {
    total: number; avgPosition: number;
    totalClicks: number; totalImpressions: number;
    page1Count: number; page1Pct: number; top3Count: number;
    criticalCount: number; weakCount: number;
    improvingCount: number; strongCount: number;
}
interface CannibalizationIssue {
    keyword: string;
    urls: { url: string; clicks: number; impressions: number; position: number }[];
    severity: "high" | "medium" | "low";
    suggestedFix: "merge" | "canonicalize" | "internal-link";
}
interface KeywordData {
    keywords: KeywordRow[];
    summary: Summary;
    opportunities: Opportunity[];
    cannibalization: CannibalizationIssue[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function posColor(pos: number) {
    if (pos <= 3)  return { text: "#2ea043", bg: "#0d2818", border: "rgba(46,160,67,0.3)" };
    if (pos <= 10) return { text: "#388bfd", bg: "#0d1f3c", border: "rgba(56,139,253,0.3)" };
    if (pos <= 20) return { text: "#d29922", bg: "#2d2208", border: "rgba(210,153,34,0.3)" };
    return { text: "#f85149", bg: "#2c1417", border: "rgba(248,81,73,0.3)" };
}

const OPP_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
    "quick-win":        { label: "Quick Win",  color: "#2ea043", bg: "#0d2818", border: "rgba(46,160,67,0.3)"    },
    "ctr-optimize":     { label: "CTR Fix",    color: "#388bfd", bg: "#0d1f3c", border: "rgba(56,139,253,0.3)"   },
    "ranking-optimize": { label: "Rank Up",    color: "#d29922", bg: "#2d2208", border: "rgba(210,153,34,0.3)"   },
    "new-content":      { label: "New Page",   color: "#a371f7", bg: "#1e1433", border: "rgba(163,113,247,0.3)"  },
};

const FIX_LABELS: Record<string, string> = {
    merge: "Merge pages", canonicalize: "Add canonical", "internal-link": "Internal links",
};

// ── Overview strip ─────────────────────────────────────────────────────────────

function OverviewStrip({ summary }: { summary: Summary }) {
    const buckets = [
        { label: "Strong",    count: summary.strongCount,   color: "#2ea043" },
        { label: "Improving", count: summary.improvingCount, color: "#388bfd" },
        { label: "Weak",      count: summary.weakCount,      color: "#d29922" },
        { label: "Critical",  count: summary.criticalCount,  color: "#f85149" },
    ];
    const total = buckets.reduce((s, b) => s + b.count, 0) || 1;

    const stats = [
        { label: "Keywords",    value: fmt(summary.total),             sub: `${summary.page1Count} on page 1`, color: "#e6edf3" },
        { label: "Clicks",      value: fmt(summary.totalClicks),       sub: "last 90 days",                    color: "#2ea043" },
        { label: "Impressions", value: fmt(summary.totalImpressions),  sub: "last 90 days",                    color: "#388bfd" },
        {
            label: "Avg Position", value: summary.avgPosition.toFixed(1),
            sub: `${summary.top3Count} in top 3`,
            color: summary.avgPosition <= 10 ? "#2ea043" : summary.avgPosition <= 20 ? "#d29922" : "#f85149",
        },
    ];

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#21262d]">
                {stats.map((s) => (
                    <div key={s.label} className="px-5 py-4 flex flex-col gap-0.5">
                        <span className="text-[26px] font-black tabular-nums leading-none" style={{ color: s.color }}>{s.value}</span>
                        <span className="text-[12px] font-medium text-[#c9d1d9] mt-1">{s.label}</span>
                        <span className="text-[11px] text-[#6e7681]">{s.sub}</span>
                    </div>
                ))}
            </div>

            {/* Health bar */}
            <div className="px-5 py-3 border-t border-[#21262d]">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] shrink-0">
                        Keyword health
                    </span>
                    <div className="flex-1 flex h-[6px] rounded-full overflow-hidden gap-[2px]">
                        {buckets.map((b) => (
                            <div
                                key={b.label}
                                className="h-full rounded-full transition-all duration-700"
                                style={{ width: `${(b.count / total) * 100}%`, background: b.color }}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {buckets.map((b) => (
                            <div key={b.label} className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                                <span className="text-[10px] text-[#6e7681]">{b.label} <span className="font-semibold" style={{ color: b.color }}>{b.count}</span></span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Opportunity cards (right column) ─────────────────────────────────────────

function OpportunityCard({ opp }: { opp: Opportunity }) {
    const [open, setOpen] = useState(false);
    const cfg = OPP_LABELS[opp.opportunityType] ?? { label: opp.opportunityType, color: "#6e7681", bg: "#21262d", border: "#30363d" };
    const pc = posColor(opp.avgPosition);

    return (
        <div
            className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden cursor-pointer hover:border-[#30363d] transition-colors"
            onClick={() => setOpen(v => !v)}
        >
            <div className="flex items-start gap-3 px-4 py-3">
                {/* Score ring */}
                <div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5">
                    <div
                        className="w-9 h-9 rounded-full flex items-center justify-center border text-[13px] font-black"
                        style={{ color: opp.opportunityScore >= 60 ? "#2ea043" : "#d29922", borderColor: opp.opportunityScore >= 60 ? "rgba(46,160,67,0.35)" : "rgba(210,153,34,0.35)", background: opp.opportunityScore >= 60 ? "#0d2818" : "#2d2208" }}
                    >
                        {opp.opportunityScore}
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#e6edf3] truncate">{opp.keyword}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ color: pc.text, background: pc.bg, borderColor: pc.border }}>
                            #{opp.avgPosition}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
                            {cfg.label}
                        </span>
                        <span className="text-[10px] text-[#6e7681]">{fmt(opp.impressions)} impr</span>
                    </div>
                </div>
                <ArrowUpRight className={`w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "#6e7681" }} />
            </div>
            {open && (
                <div className="px-4 pb-3 pt-1 border-t border-[#21262d] bg-[#0a0d11]">
                    <p className="text-[11px] text-[#8b949e] leading-relaxed">{opp.reason}</p>
                    <div className="flex gap-4 mt-2">
                        <span className="text-[10px] text-[#6e7681]">Clicks <span className="text-[#e6edf3] font-semibold">{fmt(opp.clicks)}</span></span>
                        <span className="text-[10px] text-[#6e7681]">CTR <span className="text-[#e6edf3] font-semibold">{opp.ctr}%</span></span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Cannibalization alert ─────────────────────────────────────────────────────

function CannibalizationAlert({ issues }: { issues: CannibalizationIssue[] }) {
    const [open, setOpen] = useState(false);
    const high = issues.filter(i => i.severity === "high").length;
    return (
        <div className="rounded-xl border border-[rgba(248,81,73,0.25)] bg-[#2c1417] overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
                <AlertTriangle className="w-4 h-4 text-[#f85149] shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#f85149]">
                        {issues.length} keyword cannibalization {issues.length === 1 ? "issue" : "issues"}
                        {high > 0 && <span className="ml-2 text-[10px] font-bold bg-[#f85149]/20 px-1.5 py-0.5 rounded">{high} high severity</span>}
                    </p>
                    <p className="text-[10px] text-[#8b949e] mt-0.5">Multiple pages competing for the same keywords</p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-[#f85149] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <div className="border-t border-[rgba(248,81,73,0.2)] divide-y divide-[rgba(248,81,73,0.1)]">
                    {issues.slice(0, 5).map((issue, i) => {
                        const pc = posColor(issue.urls[0]?.position ?? 50);
                        return (
                            <div key={i} className="px-4 py-2.5">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <p className="text-[12px] font-semibold text-[#e6edf3] truncate">{issue.keyword}</p>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d] shrink-0">
                                        {FIX_LABELS[issue.suggestedFix]}
                                    </span>
                                </div>
                                {issue.urls.slice(0, 2).map((u, j) => (
                                    <div key={j} className="flex items-center gap-2 text-[10px] text-[#6e7681] mt-0.5">
                                        <span className="px-1 py-0.5 rounded text-[9px] font-bold border" style={{ color: pc.text, background: pc.bg, borderColor: pc.border }}>#{u.position}</span>
                                        <span className="truncate max-w-[200px]">{u.url.replace(/^https?:\/\//, "")}</span>
                                        <span className="ml-auto shrink-0">{fmt(u.impressions)} impr</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Traffic table ─────────────────────────────────────────────────────────────

function TrafficTable({ keywords, siteId, domain }: { keywords: KeywordRow[]; siteId: string; domain: string }) {
    const [showAll, setShowAll] = useState(false);
    const [sortBy, setSortBy] = useState<"impressions" | "clicks" | "position" | "ctr">("impressions");
    const [sortAsc, setSortAsc] = useState(false);
    const [openQuery, setOpenQuery] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    const filtered = keywords.filter(k =>
        !search || k.keyword.toLowerCase().includes(search.toLowerCase())
    );
    const sorted = [...filtered].sort((a, b) => {
        const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0;
        return sortAsc ? av - bv : bv - av;
    });
    const displayed = showAll ? sorted : sorted.slice(0, 12);

    function toggleSort(col: typeof sortBy) {
        if (col === sortBy) setSortAsc(p => !p);
        else { setSortBy(col); setSortAsc(false); }
    }

    const cols: { key: typeof sortBy; label: string }[] = [
        { key: "impressions", label: "Impressions" },
        { key: "clicks", label: "Clicks" },
        { key: "ctr", label: "CTR" },
        { key: "position", label: "Pos" },
    ];

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden flex flex-col">
            {/* Table header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#21262d]">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681]" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter keywords…"
                        className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-[#c9d1d9] placeholder:text-[#6e7681] focus:outline-none focus:border-[#388bfd] transition-all"
                    />
                </div>
                <span className="text-[11px] text-[#6e7681] shrink-0">{filtered.length} keywords · GSC 90d</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-[#21262d] bg-[#0a0d11]">
                            <th className="px-4 py-2.5 text-left text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.06em]">Keyword</th>
                            {cols.map(c => (
                                <th
                                    key={c.key}
                                    onClick={() => toggleSort(c.key)}
                                    className={`px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.06em] cursor-pointer select-none whitespace-nowrap transition-colors ${sortBy === c.key ? "text-[#388bfd]" : "text-[#6e7681] hover:text-[#8b949e]"}`}
                                >
                                    {c.label} {sortBy === c.key ? (sortAsc ? "↑" : "↓") : <span className="opacity-25">↕</span>}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#161b22]">
                        {displayed.map((kw, i) => {
                            const pc = posColor(kw.position);
                            const isOpen = openQuery === kw.keyword;
                            return (
                                <>
                                    <tr
                                        key={`row-${i}`}
                                        onClick={() => setOpenQuery(isOpen ? null : kw.keyword)}
                                        className={`cursor-pointer transition-colors ${isOpen ? "bg-[#161b22]" : "hover:bg-[#0f1318]"}`}
                                    >
                                        <td className="px-4 py-2.5 max-w-[200px]">
                                            <p className="font-medium text-[13px] text-[#e6edf3] truncate">{kw.keyword}</p>
                                            <a
                                                href={kw.url.startsWith("http") ? kw.url : `https://${kw.url}`}
                                                target="_blank" rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                className="text-[10px] text-[#6e7681] hover:text-[#388bfd] truncate block max-w-[190px] transition-colors"
                                            >
                                                {kw.url.replace(/^https?:\/\//, "")}
                                            </a>
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-[12px] text-[#8b949e] tabular-nums">{fmt(kw.impressions)}</td>
                                        <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#2ea043] tabular-nums">{fmt(kw.clicks)}</td>
                                        <td className="px-3 py-2.5 text-right text-[12px] text-[#8b949e] tabular-nums">{kw.ctr}%</td>
                                        <td className="px-3 py-2.5 text-right">
                                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border" style={{ color: pc.text, background: pc.bg, borderColor: pc.border }}>
                                                #{kw.position}
                                            </span>
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr key={`dive-${i}`}>
                                            <td colSpan={5} className="p-0">
                                                <QueryDeepDive
                                                    keyword={kw.keyword}
                                                    userUrl={kw.url.startsWith("http") ? kw.url : `https://${kw.url}`}
                                                    userPosition={kw.position}
                                                    userClicks={kw.clicks}
                                                    userImpressions={kw.impressions}
                                                    userCtr={kw.ctr}
                                                    siteId={siteId}
                                                    domain={domain}
                                                    onClose={() => setOpenQuery(null)}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Show more */}
            {filtered.length > 12 && (
                <button
                    onClick={() => setShowAll(p => !p)}
                    className="flex items-center justify-center gap-2 p-3 text-[12px] font-semibold text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#161b22] border-t border-[#21262d] transition-colors"
                >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
                    {showAll ? "Show less" : `Show all ${filtered.length} keywords`}
                </button>
            )}
        </div>
    );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function KeywordInsightsSection({ siteId, domain }: { siteId: string; domain: string }) {
    const [data, setData] = useState<KeywordData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await getKeywordRankingsFast(siteId);
            if (!res.success || !res.data) setError(res.error ?? "Failed to load keyword data");
            else setData({
                keywords: res.data.keywords as any,
                summary: res.data.summary,
                opportunities: res.data.opportunities as any,
                cannibalization: res.data.cannibalization as any,
            });
        } catch { setError("Failed to load keyword data"); }
        finally { setLoading(false); }
    }, [siteId]);

    useEffect(() => { load(); }, [load]);

    return (
        <section className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.1em] whitespace-nowrap">
                    Keyword Intelligence
                </span>
                <div className="flex-1 h-px bg-[#21262d]" />
                <a
                    href="/dashboard/keywords"
                    className="flex items-center gap-1 text-[11px] text-[#6e7681] hover:text-[#388bfd] transition-colors"
                >
                    Full report <ExternalLink className="w-3 h-3" />
                </a>
            </div>

            {/* Loading */}
            {loading && (
                <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] p-8 flex items-center justify-center gap-3 text-[13px] text-[#6e7681]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#388bfd] border-t-transparent animate-spin" />
                    Loading keyword data from Google Search Console…
                </div>
            )}

            {/* Error */}
            {!loading && error && (
                <div className="rounded-2xl border border-[#d29922]/30 bg-[#2d2208] px-5 py-4 flex items-start gap-3">
                    <TrendingUp className="w-4 h-4 text-[#d29922] shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[13px] font-semibold text-[#d29922]">Keyword data unavailable</p>
                        <p className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">{error}</p>
                        <a href="/dashboard/settings" className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-[#388bfd] hover:underline">
                            Connect Google Search Console <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                </div>
            )}

            {/* Data */}
            {!loading && data && (
                <>
                    {/* Overview strip */}
                    <OverviewStrip summary={data.summary} />

                    {/* Cannibalization alert — only if present */}
                    {data.cannibalization.length > 0 && (
                        <CannibalizationAlert issues={data.cannibalization} />
                    )}

                    {/* Two-column: traffic table + opportunities */}
                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
                        {/* Left: traffic table */}
                        <TrafficTable keywords={data.keywords} siteId={siteId} domain={domain} />

                        {/* Right: opportunity cards */}
                        {data.opportunities.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 px-1">
                                    <Zap className="w-3.5 h-3.5 text-[#d29922]" />
                                    <span className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">
                                        Top Opportunities
                                    </span>
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#d29922]/10 text-[#d29922] border border-[#d29922]/20 ml-auto">
                                        {data.opportunities.length}
                                    </span>
                                </div>
                                {data.opportunities.slice(0, 6).map((opp, i) => (
                                    <OpportunityCard key={i} opp={opp} />
                                ))}
                                {data.opportunities.length > 6 && (
                                    <a
                                        href="/dashboard/keywords"
                                        className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl border border-[#21262d] text-[11px] font-semibold text-[#6e7681] hover:text-[#388bfd] hover:border-[#388bfd]/30 transition-colors"
                                    >
                                        +{data.opportunities.length - 6} more <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}