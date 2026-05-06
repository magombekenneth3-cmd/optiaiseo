/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback } from "react";
import { getKeywordRankingsFast } from "@/app/actions/keywords";
import QueryDeepDive from "@/components/dashboard/QueryDeepDive";
import {
    TrendingUp,
    Minus,
    Search,
    Zap,
    BarChart3,
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KeywordRow {
    keyword: string;
    url: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

interface Opportunity {
    keyword: string;
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    opportunityScore: number;
    opportunityType: string;
    reason: string;
}

interface Summary {
    total: number;
    avgPosition: number;
    totalClicks: number;
    totalImpressions: number;
    page1Count: number;
    page1Pct: number;
    top3Count: number;
    criticalCount: number;
    weakCount: number;
    improvingCount: number;
    strongCount: number;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function positionColor(pos: number) {
    if (pos <= 3) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (pos <= 10) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    if (pos <= 20) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    return "text-red-400 bg-red-500/10 border-red-500/20";
}

function opportunityTypeLabel(type: string): { label: string; cls: string } {
    switch (type) {
        case "quick-win":
            return { label: "Quick Win", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
        case "ctr-optimize":
            return { label: "CTR Fix", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
        case "ranking-optimize":
            return { label: "Rank Up", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" };
        case "new-content":
            return { label: "New Page", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
        default:
            return { label: type, cls: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20" };
    }
}

function severityBadge(sev: string) {
    if (sev === "high") return "bg-red-500/10 text-red-400 border-red-500/20";
    if (sev === "medium") return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    return "bg-zinc-500/10 text-muted-foreground border-zinc-500/20";
}

function fmt(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: Summary }) {
    const cards = [
        { label: "Total Keywords", value: fmt(summary.total), sub: `${summary.page1Count} on page 1`, color: "text-white" },
        { label: "Total Clicks", value: fmt(summary.totalClicks), sub: "last 90 days", color: "text-emerald-400" },
        { label: "Impressions", value: fmt(summary.totalImpressions), sub: "last 90 days", color: "text-blue-400" },
        {
            label: "Avg Position",
            value: summary.avgPosition.toFixed(1),
            sub: `${summary.top3Count} in top 3`,
            color:
                summary.avgPosition <= 10
                    ? "text-emerald-400"
                    : summary.avgPosition <= 20
                        ? "text-yellow-400"
                        : "text-red-400",
        },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {cards.map((c) => (
                <div key={c.label} className="card-surface p-4">
                    <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{c.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>
                </div>
            ))}
        </div>
    );
}

function HealthBuckets({ summary }: { summary: Summary }) {
    const buckets = [
        { label: "Strong", count: summary.strongCount, desc: "Top 3", color: "bg-emerald-500", textColor: "text-emerald-400" },
        { label: "Improving", count: summary.improvingCount, desc: "Pos 4–10", color: "bg-blue-500", textColor: "text-blue-400" },
        { label: "Weak", count: summary.weakCount, desc: "Pos 11–20", color: "bg-yellow-500", textColor: "text-yellow-400" },
        { label: "Critical", count: summary.criticalCount, desc: "Pos 20+", color: "bg-red-500", textColor: "text-red-400" },
    ];
    const total = buckets.reduce((s, b) => s + b.count, 0) || 1;

    return (
        <div className="card-surface p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Keyword Health Distribution
            </p>
            <div className="flex h-2 rounded-full overflow-hidden gap-0.5 mb-3">
                {buckets.map((b) => (
                    <div
                        key={b.label}
                        className={`${b.color} transition-all`}
                        style={{ width: `${(b.count / total) * 100}%` }}
                    />
                ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
                {buckets.map((b) => (
                    <div key={b.label} className="text-center">
                        <p className={`text-lg font-bold ${b.textColor}`}>{b.count}</p>
                        <p className="text-[10px] font-medium text-foreground">{b.label}</p>
                        <p className="text-[10px] text-muted-foreground">{b.desc}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TopKeywordsTable({
    keywords,
    siteId,
    domain,
}: {
    keywords: KeywordRow[];
    siteId: string;
    domain: string;
}) {
    const [showAll, setShowAll] = useState(false);
    const [sortBy, setSortBy] = useState<"impressions" | "clicks" | "position" | "ctr">("impressions");
    const [sortAsc, setSortAsc] = useState(false);
    const [openQuery, setOpenQuery] = useState<string | null>(null);

    const sorted = [...keywords].sort((a, b) => {
        const av = a[sortBy] ?? 0;
        const bv = b[sortBy] ?? 0;
        return sortAsc ? av - bv : bv - av;
    });
    const displayed = showAll ? sorted : sorted.slice(0, 10);

    function toggleSort(col: typeof sortBy) {
        if (col === sortBy) setSortAsc((p) => !p);
        else {
            setSortBy(col);
            setSortAsc(false);
        }
    }

    function SortIcon({ col }: { col: typeof sortBy }) {
        if (col !== sortBy) return <span className="opacity-20 ml-1">↕</span>;
        return <span className="opacity-70 ml-1">{sortAsc ? "↑" : "↓"}</span>;
    }

    const cols: { key: typeof sortBy; label: string }[] = [
        { key: "impressions", label: "Impressions" },
        { key: "clicks", label: "Clicks" },
        { key: "ctr", label: "CTR" },
        { key: "position", label: "Position" },
    ];

    return (
        <div className="card-surface overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                    <h3 className="font-semibold text-sm">Keyword Traffic</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {keywords.length} keywords · last 90 days via GSC
                    </p>
                </div>
                <Search className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-card/50">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                                Keyword
                            </th>
                            {cols.map((c) => (
                                <th
                                    key={c.key}
                                    className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                                    onClick={() => toggleSort(c.key)}
                                >
                                    {c.label} <SortIcon col={c.key} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {displayed.map((kw, i) => (
                            <>
                                <tr
                                    key={`row-${i}`}
                                    className={`hover:bg-card/40 transition-colors cursor-pointer ${openQuery === kw.keyword ? "bg-card/60" : ""}`}
                                    onClick={() => setOpenQuery(openQuery === kw.keyword ? null : kw.keyword)}
                                >
                                    <td className="px-4 py-2.5 max-w-[220px]">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <p className="font-medium text-sm truncate">{kw.keyword}</p>
                                            {openQuery === kw.keyword && (
                                                <span className="shrink-0 text-[9px] text-muted-foreground">▼</span>
                                            )}
                                        </div>
                                        <a
                                            href={kw.url.startsWith("http") ? kw.url : `https://${kw.url}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] text-muted-foreground hover:text-blue-400 truncate block max-w-[200px]"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {kw.url.replace(/^https?:\/\//, "")}
                                        </a>
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-xs font-medium">{fmt(kw.impressions)}</td>
                                    <td className="px-3 py-2.5 text-right text-xs font-medium text-emerald-400">{fmt(kw.clicks)}</td>
                                    <td className="px-3 py-2.5 text-right text-xs font-medium">{kw.ctr}%</td>
                                    <td className="px-3 py-2.5 text-right">
                                        <span
                                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${positionColor(kw.position)}`}
                                        >
                                            #{kw.position}
                                        </span>
                                    </td>
                                </tr>
                                {openQuery === kw.keyword && (
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
                        ))}
                    </tbody>
                </table>
            </div>
            {keywords.length > 10 && (
                <button
                    onClick={() => setShowAll((p) => !p)}
                    className="w-full flex items-center justify-center gap-2 p-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-card transition-colors border-t border-border"
                >
                    {showAll ? (
                        <>
                            <ChevronDown className="w-3.5 h-3.5 rotate-180" /> Show less
                        </>
                    ) : (
                        <>
                            <ChevronDown className="w-3.5 h-3.5" /> Show all {keywords.length} keywords
                        </>
                    )}
                </button>
            )}
        </div>
    );
}

function OpportunitiesPanel({ opportunities }: { opportunities: Opportunity[] }) {
    const [expanded, setExpanded] = useState<number | null>(null);
    if (opportunities.length === 0) return null;

    return (
        <div className="card-surface overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        Traffic Opportunities
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Keywords with the highest potential click gain
                    </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    {opportunities.length} found
                </span>
            </div>
            <div className="divide-y divide-border">
                {opportunities.slice(0, 8).map((opp, i) => {
                    const typeInfo = opportunityTypeLabel(opp.opportunityType);
                    const isOpen = expanded === i;
                    return (
                        <div key={i} className="hover:bg-card/40 transition-colors">
                            <div
                                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                                onClick={() => setExpanded(isOpen ? null : i)}
                            >
                                <div className="flex flex-col items-center gap-0.5 shrink-0 w-10 text-center">
                                    <span className="text-[10px] text-muted-foreground">score</span>
                                    <span
                                        className={`text-sm font-bold px-1.5 py-0.5 rounded border ${opp.opportunityScore >= 50
                                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                                : "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
                                            }`}
                                    >
                                        {opp.opportunityScore}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold truncate">{opp.keyword}</p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <span className="text-[10px] text-muted-foreground">
                                            {fmt(opp.impressions)} impressions
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">·</span>
                                        <span
                                            className={`text-[10px] font-bold border px-1.5 py-0.5 rounded-full ${positionColor(opp.avgPosition)}`}
                                        >
                                            #{opp.avgPosition}
                                        </span>
                                        <span
                                            className={`text-[10px] font-semibold border px-1.5 py-0.5 rounded-full ${typeInfo.cls}`}
                                        >
                                            {typeInfo.label}
                                        </span>
                                    </div>
                                </div>
                                {isOpen ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                )}
                            </div>
                            {isOpen && (
                                <div className="px-4 pb-3 pt-1 bg-card/20 border-t border-border/50">
                                    <p className="text-xs text-muted-foreground leading-relaxed">{opp.reason}</p>
                                    <div className="flex gap-4 mt-2">
                                        <div className="text-[10px] text-muted-foreground">
                                            <span className="font-semibold text-foreground">{fmt(opp.clicks)}</span> clicks
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                            <span className="font-semibold text-foreground">{opp.ctr}%</span> CTR
                                        </div>
                                        <div className="text-[10px] text-muted-foreground">
                                            <span className="font-semibold text-foreground">{fmt(opp.impressions)}</span> impressions
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="p-3 border-t border-border">
                <a
                    href="/dashboard/keywords"
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-emerald-400 transition-colors"
                >
                    View all keyword opportunities <ExternalLink className="w-3 h-3" />
                </a>
            </div>
        </div>
    );
}

function CannibalizationPanel({ issues }: { issues: CannibalizationIssue[] }) {
    const high = issues.filter((i) => i.severity === "high");
    if (issues.length === 0) return null;

    return (
        <div className="card-surface overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
                <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        Keyword Cannibalization
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Multiple pages competing for the same keyword
                    </p>
                </div>
                {high.length > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                        {high.length} high severity
                    </span>
                )}
            </div>
            <div className="divide-y divide-border">
                {issues.slice(0, 5).map((issue, i) => {
                    const fixLabels: Record<string, string> = {
                        merge: "Merge pages",
                        canonicalize: "Add canonical",
                        "internal-link": "Add internal links",
                    };
                    return (
                        <div key={i} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-semibold">{issue.keyword}</p>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityBadge(issue.severity)} capitalize`}
                                    >
                                        {issue.severity}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-500/10 text-muted-foreground border-zinc-500/20">
                                        {fixLabels[issue.suggestedFix]}
                                    </span>
                                </div>
                            </div>
                            <div className="mt-1.5 space-y-1">
                                {issue.urls.slice(0, 3).map((u, j) => (
                                    <div key={j} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                        <span
                                            className={`px-1 py-0.5 rounded text-[9px] font-bold border ${positionColor(u.position)}`}
                                        >
                                            #{u.position}
                                        </span>
                                        <span className="truncate max-w-[240px]">{u.url.replace(/^https?:\/\//, "")}</span>
                                        <span className="ml-auto shrink-0">{fmt(u.impressions)} impr.</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="p-3 border-t border-border">
                <a
                    href="/dashboard/keywords"
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-emerald-400 transition-colors"
                >
                    View full keyword report <ExternalLink className="w-3 h-3" />
                </a>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function KeywordInsightsSection({ siteId, domain }: { siteId: string; domain: string }) {
    const [data, setData] = useState<KeywordData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"traffic" | "opportunities" | "cannibalization">("traffic");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getKeywordRankingsFast(siteId);
            if (!res.success || !res.data) {
                setError(res.error ?? "Failed to load keyword data");
            } else {
                setData({
                    keywords: res.data.keywords as any,
                    summary: res.data.summary,
                    opportunities: res.data.opportunities as any,
                    cannibalization: res.data.cannibalization as any,
                });
            }
        } catch {
            setError("Failed to load keyword data");
        } finally {
            setLoading(false);
        }
    }, [siteId]);

    useEffect(() => {
        load();
    }, [load]);

    const tabs = [
        { id: "traffic" as const, label: "Traffic", icon: BarChart3, count: data?.keywords.length },
        { id: "opportunities" as const, label: "Opportunities", icon: TrendingUp, count: data?.opportunities.length },
        { id: "cannibalization" as const, label: "Cannibalization", icon: AlertTriangle, count: data?.cannibalization.length },
    ];

    return (
        <section className="flex flex-col gap-4">
            {/* Section header */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <Search className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                    <h2 className="font-semibold text-lg">Keyword Insights</h2>
                    <p className="text-xs text-muted-foreground">
                        Live GSC data — clicks, impressions &amp; traffic opportunities
                    </p>
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="card-surface p-8 flex items-center justify-center gap-3 text-sm text-muted-foreground">
                    <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                    Loading keyword data from Google Search Console…
                </div>
            )}

            {/* Error / no GSC */}
            {!loading && error && (
                <div className="card-surface p-5 border-l-4 border-l-yellow-500/60">
                    <p className="text-sm font-semibold text-yellow-400 mb-1">Keyword data unavailable</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{error}</p>
                    <a
                        href="/dashboard/settings"
                        className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-blue-400 hover:underline"
                    >
                        Connect Google Search Console <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
            )}

            {/* Data */}
            {!loading && data && (
                <>
                    <SummaryCards summary={data.summary} />
                    <HealthBuckets summary={data.summary} />

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-border">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${activeTab === tab.id
                                        ? "border-emerald-400 text-emerald-400"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                <tab.icon className="w-3.5 h-3.5" />
                                {tab.label}
                                {tab.count != null && tab.count > 0 && (
                                    <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === tab.id
                                                ? "bg-emerald-500/10 text-emerald-400"
                                                : "bg-zinc-500/10 text-muted-foreground"
                                            }`}
                                    >
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {activeTab === "traffic" && <TopKeywordsTable keywords={data.keywords} siteId={siteId} domain={domain} />}

                    {activeTab === "opportunities" &&
                        (data.opportunities.length === 0 ? (
                            <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                                No opportunities detected yet.
                                <br />
                                <span className="text-xs">
                                    Keywords need 30+ impressions and position 5+ to qualify.
                                </span>
                            </div>
                        ) : (
                            <OpportunitiesPanel opportunities={data.opportunities} />
                        ))}

                    {activeTab === "cannibalization" &&
                        (data.cannibalization.length === 0 ? (
                            <div className="card-surface p-8 text-center">
                                <Minus className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                                <p className="text-sm font-medium">No cannibalization detected</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    No pages competing for the same keywords.
                                </p>
                            </div>
                        ) : (
                            <CannibalizationPanel issues={data.cannibalization} />
                        ))}
                </>
            )}
        </section>
    );
}