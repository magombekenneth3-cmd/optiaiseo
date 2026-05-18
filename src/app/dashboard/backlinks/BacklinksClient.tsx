"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { PanelErrorBoundary } from "@/components/dashboard/PanelErrorBoundary";
import type { BacklinkSummary, StoredBacklink, BacklinkAlert, QualitySummary, BacklinkGapReport } from "@/types/backlinks";
import {
    Link2, TrendingUp, TrendingDown, AlertTriangle,
    ShieldAlert, Globe, RefreshCw, ChevronDown,
    ChevronUp, ArrowUpRight, Loader2, Search,
    CheckCircle2, XCircle, Minus, Download, Plus, X,
    ExternalLink, BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
  BarChart, Bar, Cell,
} from "recharts";
import { addBacklinkTargetFromGap, getPlannerItemsForSite } from "@/app/actions/backlinks";

type GapReport = BacklinkGapReport;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function drColor(dr: number | null): string {
    if (dr == null) return "#6e7681";
    if (dr >= 60) return "#2ea043";
    if (dr >= 30) return "#d29922";
    return "#f85149";
}

function toxicLabel(reason: string | null): string {
    switch (reason) {
        case "exact_match_anchor": return "Exact-match anchor";
        case "low_dr_spam": return "Low-DR spam";
        case "toxic_keyword": return "Toxic keyword";
        default: return reason ?? "Unknown";
    }
}

function spamScore(b: StoredBacklink): number {
    if (!b.isToxic) return 0;
    switch (b.toxicReason) {
        case "toxic_keyword":       return 85;
        case "exact_match_anchor":  return 65;
        case "low_dr_spam":         return 45;
        default: return 30;
    }
}

function spamBadgeCls(score: number) {
    if (score >= 51) return "bg-red-500/10 text-red-400 border-red-500/20";
    if (score >= 21) return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    return "bg-zinc-500/10 text-[#6e7681] border-zinc-500/20";
}

function getWeekLabel(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function groupAlertsByWeek(alerts: BacklinkAlert[]) {
    const weeks: Record<string, { gained: number; lost: number }> = {};
    for (const a of alerts) {
        const week = getWeekLabel(a.detectedAt);
        weeks[week] = weeks[week] ?? { gained: 0, lost: 0 };
        weeks[week][a.type]++;
    }
    return Object.entries(weeks).map(([week, counts]) => ({ week, ...counts })).reverse().slice(0, 12).reverse();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3 mb-3">
            <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.1em] whitespace-nowrap">
                {children}
            </span>
            <div className="flex-1 h-px bg-[#21262d]" />
        </div>
    );
}

function DRBar({ dr }: { dr: number | null }) {
    const color = drColor(dr);
    return (
        <div className="flex items-center gap-1.5">
            <div className="w-12 h-[5px] bg-[#21262d] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dr ?? 0}%`, background: color }} />
            </div>
            <span className="text-[12px] font-bold tabular-nums font-mono min-w-[20px]" style={{ color }}>{dr ?? "—"}</span>
        </div>
    );
}

function EmptyState({ icon: Icon, title, sub, onAction, actionLabel }: {
    icon: React.ElementType; title: string; sub: string; onAction?: () => void; actionLabel?: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#161b22] border border-[#30363d] flex items-center justify-center">
                <Icon size={18} className="text-[#6e7681]" />
            </div>
            <p className="text-[13px] font-semibold text-[#8b949e]">{title}</p>
            <p className="text-[11px] text-[#6e7681] max-w-[280px] text-center">{sub}</p>
            {onAction && actionLabel && (
                <button onClick={onAction} className="mt-1 px-4 py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-[12px] font-semibold text-[#e6edf3] hover:bg-[#30363d] transition-colors">
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey?: string; color?: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 shadow-xl">
            <p className="text-[11px] font-semibold text-[#e6edf3]">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="text-[12px] font-bold" style={{ color: p.color }}>{p.value} {p.dataKey}</p>
            ))}
        </div>
    );
};
// ─── Main Component ───────────────────────────────────────────────────────────

interface BacklinksClientProps {
    siteId: string;
    domain: string;
    initialSummary: BacklinkSummary | null;
    initialStored: StoredBacklink[];
}

export default function BacklinksClient({
    siteId,
    domain: _domain,
    initialSummary,
    initialStored,
}: BacklinksClientProps) {
    const searchParams = useSearchParams();
    const effectiveSiteId = siteId || searchParams.get("siteId");

    const [summary, setSummary] = useState<BacklinkSummary | null>(initialSummary);
    const [stored, setStored] = useState<StoredBacklink[]>(initialStored);
    const [alerts, setAlerts] = useState<BacklinkAlert[]>([]);
    const [quality, setQuality] = useState<QualitySummary | null>(null);
    const [gap, setGap] = useState<GapReport | null>(null);
    const [drTrend, setDrTrend] = useState<{ date: string; dr: number }[]>([]);
    const [cbState, setCbState] = useState<"CLOSED" | "OPEN" | "HALF">("CLOSED");
    const [drRange, setDrRange] = useState<"30d" | "90d" | "1y">("90d");

    const [plannerItems, setPlannerItems] = useState<{ id: string; keyword: string; title: string | null }[]>([]);
    const [gapModal, setGapModal] = useState<{ domain: string; dr: number | null } | null>(null);
    const [addedDomains, setAddedDomains] = useState<Set<string>>(new Set());
    const [plannerPending, startPlannerTransition] = useTransition();
    const [alertFilter, setAlertFilter] = useState<"all" | "gained" | "lost">("all");
    const [gapSort, setGapSort] = useState<"dr" | "domain">("dr");
    const [gapDrFilter, setGapDrFilter] = useState<number>(0);

    const [loadingLive, setLoadingLive] = useState(false);
    const [loadingStored, setLoadingStored] = useState(false);
    const [loadingGap, setLoadingGap] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [competitorInput, setCompetitorInput] = useState("");
    const [filterToxic, setFilterToxic] = useState(false);
    const [sortCol, setSortCol] = useState<"dr" | "firstSeen" | "lastSeen" | "spamScore">("dr");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [domainSearch, setDomainSearch] = useState("");

    // ── Fetch helpers ──
    const fetchLive = useCallback(async (bust = false) => {
        if (!effectiveSiteId) return;
        setLoadingLive(true); setError(null);
        try {
            const refresh = bust ? "&refresh=true" : "";
            const [sumRes, alertRes, qualRes] = await Promise.all([
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=summary${refresh}`),
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=alerts`),
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=quality`),
            ]);
            if (!sumRes.ok) { const e = await sumRes.json(); setError(e.error ?? "Failed to fetch summary"); }
            else { const { summary: s } = await sumRes.json(); setSummary(s); }
            if (alertRes.ok) { const { alerts: a } = await alertRes.json(); setAlerts(a ?? []); }
            if (qualRes.ok)  { const { quality: q } = await qualRes.json(); setQuality(q); }
        } catch { setError("Network error. Please try again."); }
        finally { setLoadingLive(false); }
    }, [effectiveSiteId]);

    const fetchStored = useCallback(async () => {
        if (!effectiveSiteId) return;
        setLoadingStored(true);
        try {
            const res = await fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=stored`);
            if (res.ok) { const { stored: s } = await res.json(); setStored(s ?? []); }
        } finally { setLoadingStored(false); }
    }, [effectiveSiteId]);

    const fetchGap = useCallback(async () => {
        if (!effectiveSiteId || !competitorInput.trim()) return;
        setLoadingGap(true);
        try {
            const res = await fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=gap&competitor=${encodeURIComponent(competitorInput.trim())}`);
            if (res.ok) { const { report } = await res.json(); setGap(report); }
        } finally { setLoadingGap(false); }
    }, [effectiveSiteId, competitorInput]);

    useEffect(() => {
        if (effectiveSiteId) {
            fetchLive();
            fetch(`/api/backlinks/dr-trend?siteId=${effectiveSiteId}`)
              .then((r) => r.ok ? r.json() : null)
              .then((data) => { if (data?.trend?.length) setDrTrend(data.trend); })
              .catch(() => {});
            fetch(`/api/backlinks/health?siteId=${effectiveSiteId}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data?.state) setCbState(data.state); })
              .catch(() => {});
            getPlannerItemsForSite(effectiveSiteId)
              .then(res => { if (res.success && res.items) setPlannerItems(res.items); })
              .catch(() => {});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveSiteId]);

    const handleAddToPlanner = (domain: string, dr: number | null) => { setGapModal({ domain, dr }); };
    const confirmAddToPlanner = (itemId: string) => {
        if (!effectiveSiteId || !gapModal) return;
        startPlannerTransition(async () => {
            const res = await addBacklinkTargetFromGap(effectiveSiteId, itemId, gapModal.domain, gapModal.dr);
            if (res.success) { setAddedDomains(prev => new Set([...prev, gapModal.domain])); setGapModal(null); }
        });
    };

    // ── Computed data ──
    const filteredStored = stored
        .filter(b => !filterToxic || b.isToxic)
        .filter(b => !domainSearch || b.srcDomain.toLowerCase().includes(domainSearch.toLowerCase()))
        .sort((a, b) => {
            let av: number, bv: number;
            if (sortCol === "dr") { av = a.domainRating ?? -1; bv = b.domainRating ?? -1; }
            else if (sortCol === "lastSeen") { av = new Date(a.lastSeen).getTime(); bv = new Date(b.lastSeen).getTime(); }
            else if (sortCol === "spamScore") { av = spamScore(a); bv = spamScore(b); }
            else { av = new Date(a.firstSeen).getTime(); bv = new Date(b.firstSeen).getTime(); }
            return sortDir === "desc" ? bv - av : av - bv;
        });

    const toggleSort = (col: typeof sortCol) => {
        if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortCol(col); setSortDir("desc"); }
    };

    const visibleTrend = drRange === "30d" ? drTrend.slice(-30) : drRange === "90d" ? drTrend.slice(-90) : drTrend;
    const drDelta = drTrend.length >= 2 ? drTrend[drTrend.length - 1].dr - drTrend[0].dr : null;
    const avgRefDR = stored.length > 0 ? Math.round(stored.filter(s => s.domainRating != null).reduce((a, b) => a + (b.domainRating ?? 0), 0) / stored.filter(s => s.domainRating != null).length) : null;
    const filteredAlerts = alerts.filter(a => alertFilter === "all" || a.type === alertFilter);
    const alertChartData = groupAlertsByWeek(alerts);

    // DR histogram
    const drBuckets = [
        { label: "0–10", min: 0, max: 10 }, { label: "11–20", min: 11, max: 20 },
        { label: "21–30", min: 21, max: 30 }, { label: "31–50", min: 31, max: 50 },
        { label: "51–70", min: 51, max: 70 }, { label: "71–100", min: 71, max: 100 },
    ];
    const drHistogram = drBuckets.map(b => ({
        label: b.label,
        count: stored.filter(s => s.domainRating != null && s.domainRating >= b.min && s.domainRating <= b.max).length,
    }));

    // Anchor distribution
    const totalAnchors = summary?.topAnchors.reduce((s, a) => s + a.count, 0) ?? 0;
    const overOptAnchor = summary?.topAnchors.find(a => a.anchor && totalAnchors > 0 && (a.count / totalAnchors) > 0.25);

    // Gap table
    const sortedGapDomains = gap?.gap.opportunityDomains
        .filter(d => d.dr >= gapDrFilter)
        .sort((a, b) => gapSort === "dr" ? b.dr - a.dr : a.domain.localeCompare(b.domain)) ?? [];

    if (!effectiveSiteId) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <p className="text-[13px] text-[#6e7681]">Select a site from the sidebar to view backlinks.</p>
        </div>
    );
    // ── JSX Return ──
    return (
        <div className="flex flex-col gap-0 max-w-6xl mx-auto pb-20">

            {/* ── Page Header ── */}
            <div className="mb-6">
                <div className="text-[12px] text-[#6e7681] mb-2 flex items-center gap-[6px]">
                    <span>Dashboard</span><span>/</span>
                    <span className="text-[#8b949e]">Backlinks</span>
                </div>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[#e6edf3]">
                            Backlink Monitor
                            <span className="text-[#6e7681] font-normal ml-2 text-[18px]">— Link Intelligence</span>
                        </h1>
                        <p className="text-[13px] text-[#8b949e] mt-1 flex flex-wrap items-center gap-1.5">
                            <span>{stored.length} referring domains</span>
                            {quality && quality.toxic > 0 && (
                                <><span className="text-[#30363d]">·</span>
                                <span className="text-[#f85149] font-semibold">{quality.toxic} toxic</span></>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {(cbState === "OPEN" || cbState === "HALF") && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium bg-amber-500/10 text-amber-400 border-amber-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                DataForSEO circuit {cbState === "OPEN" ? "open" : "half-open"}
                            </span>
                        )}
                        {quality && quality.toxic > 0 && effectiveSiteId && (
                            <a href={`/api/backlinks/disavow?siteId=${effectiveSiteId}`} download
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/15 transition-colors no-underline">
                                <Download size={11} /> Disavow ({quality.toxic})
                            </a>
                        )}
                        <button onClick={() => fetchLive(true)} disabled={loadingLive}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold bg-[#21262d] text-[#e6edf3] border-[#30363d] hover:bg-[#30363d] transition-colors disabled:opacity-50">
                            <RefreshCw size={12} className={loadingLive ? "animate-spin" : ""} /> Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Error ── */}
            {error && (
                <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] flex items-center gap-2">
                    <AlertTriangle size={13} /> {error}
                </div>
            )}

            {/* ── Score Overview Bar (like AuditScoreBar) ── */}
            <PanelErrorBoundary label="Backlink summary">
            {loadingLive && !summary ? (
                <div className="flex items-center gap-2 text-[#6e7681] text-[13px] mb-6">
                    <Loader2 size={16} className="animate-spin" /> Loading live data…
                </div>
            ) : summary && (
                <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden shadow-xl shadow-black/20">
                    <div className="flex items-center gap-3 px-5 py-3 border-b border-[#21262d]">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.1em]">Backlink Overview</span>
                        <div className="flex-1 h-px bg-[#21262d]" />
                        <span className="text-[11px] text-[#6e7681]">{fmt(summary.totalBacklinks)} total backlinks</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-[#21262d]">
                        {[
                            { label: "Domain Rating", value: summary.domainRating, sub: drDelta != null ? `${drDelta > 0 ? "+" : ""}${drDelta} this period` : undefined, color: drColor(summary.domainRating) },
                            { label: "Referring Domains", value: fmt(summary.referringDomains), sub: `avg DR ${avgRefDR ?? summary.avgReferringDR ?? "—"}` },
                            { label: "Total Backlinks", value: fmt(summary.totalBacklinks), sub: `${summary.doFollowRatio}% DoFollow` },
                            { label: "DoFollow %", value: `${summary.doFollowRatio}%`, color: "#2ea043" },
                        ].map(m => (
                            <div key={m.label} className="flex flex-col items-center justify-center px-4 py-5 gap-1">
                                <span className="text-[28px] font-black tabular-nums text-[#e6edf3] leading-none" style={m.color ? { color: m.color } : undefined}>{m.value}</span>
                                <span className="text-[11px] text-[#6e7681] font-medium">{m.label}</span>
                                {m.sub && <span className={`text-[10px] font-semibold ${m.sub.startsWith("+") ? "text-emerald-400" : m.sub.startsWith("-") ? "text-red-400" : "text-[#6e7681]"}`}>{m.sub}</span>}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-[#21262d] border-t border-[#21262d]">
                        {[
                            { label: "Gained (7d)", value: `+${summary.newLastWeek}`, color: "#2ea043" },
                            { label: "Lost (7d)", value: `-${summary.lostLastWeek}`, color: "#f85149" },
                            { label: "Avg Ref DR", value: avgRefDR ?? summary.avgReferringDR ?? "—" },
                            { label: "Toxic Links", value: summary.toxicCount, color: summary.toxicCount > 0 ? "#f85149" : undefined },
                        ].map(m => (
                            <div key={m.label} className="flex flex-col items-center justify-center px-4 py-4 gap-1">
                                <span className="text-[22px] font-black tabular-nums leading-none" style={m.color ? { color: m.color } : { color: "#e6edf3" }}>{m.value}</span>
                                <span className="text-[11px] text-[#6e7681] font-medium">{m.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── DR Trend Chart ── */}
            {drTrend.length > 1 && (
                <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d]">
                        <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] m-0">Domain Rating Trend</p>
                        <div className="flex items-center gap-1">
                            {(["30d", "90d", "1y"] as const).map(r => (
                                <button key={r} onClick={() => setDrRange(r)}
                                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${drRange === r ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "text-[#6e7681] hover:text-[#8b949e]"}`}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="px-5 py-4">
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={visibleTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6e7681" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 10, fill: "#6e7681" }} axisLine={false} tickLine={false} width={30} />
                                <Tooltip content={<ChartTooltip />} />
                                <Line type="monotone" dataKey="dr" stroke="#2ea043" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#2ea043" }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
            </PanelErrorBoundary>

            {/* ── Two-column: Gained/Lost Timeline + Link Quality ── */}
            <PanelErrorBoundary label="Alerts and quality">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

                {/* Gained/Lost Timeline */}
                <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d]">
                        <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] m-0">New / Lost Backlinks</p>
                        <div className="flex items-center gap-1">
                            {(["all", "gained", "lost"] as const).map(f => (
                                <button key={f} onClick={() => setAlertFilter(f)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize transition-colors ${alertFilter === f ? (f === "lost" ? "bg-red-500/15 text-red-400" : f === "gained" ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400") : "text-[#6e7681]"}`}>
                                    {f === "all" ? "All" : f === "gained" ? "Gained ↑" : "Lost ↓"}
                                </button>
                            ))}
                        </div>
                    </div>
                    {alertChartData.length > 0 && (
                        <div className="px-4 py-3">
                            <ResponsiveContainer width="100%" height={120}>
                                <BarChart data={alertChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#6e7681" }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Bar dataKey="gained" stackId="a" fill="#2ea043" radius={[2, 2, 0, 0]} />
                                    <Bar dataKey="lost" stackId="a" fill="#f85149" radius={[2, 2, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                    <div className="divide-y divide-[#161b22] max-h-[240px] overflow-y-auto">
                        {filteredAlerts.length === 0 ? (
                            <EmptyState icon={BarChart3} title="No alerts yet" sub="Click Refresh to fetch your current backlink profile." onAction={() => fetchLive(true)} actionLabel="Refresh now" />
                        ) : filteredAlerts.slice(0, 20).map(a => (
                            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#161b22] transition-colors">
                                {a.type === "gained" ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" /> : <XCircle size={13} className="text-red-400 shrink-0" />}
                                <span className="flex-1 text-[12px] font-medium text-[#e6edf3] truncate">{a.domain}</span>
                                {a.dr != null && <DRBar dr={a.dr} />}
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${a.type === "gained" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                                    {a.type === "gained" ? "Gained" : "Lost"}
                                </span>
                                <span className="text-[10px] text-[#6e7681] shrink-0 tabular-nums">{new Date(a.detectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                                {(a as any).url && (
                                    <a href={(a as any).url} target="_blank" rel="noopener noreferrer" className="text-[#388bfd] hover:text-[#58a6ff]"><ExternalLink size={11} /></a>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Link Quality Panel */}
                <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#21262d]">
                        <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] m-0">Link Quality</p>
                    </div>
                    <div className="p-4 space-y-4">
                        {!quality ? (
                            <EmptyState icon={ShieldAlert} title="Quality data not synced" sub="Click Refresh to analyse your backlink profile quality." onAction={() => fetchLive(true)} actionLabel="Refresh now" />
                        ) : (<>
                            {/* DoFollow / NoFollow stacked bar */}
                            <div>
                                <p className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] mb-2">Link Type Distribution</p>
                                <div className="flex h-3 rounded-full overflow-hidden bg-[#21262d]">
                                    <div className="transition-all duration-700" style={{ width: `${quality.total > 0 ? (quality.doFollow / quality.total) * 100 : 0}%`, background: "#2ea043" }} />
                                    <div className="transition-all duration-700" style={{ width: `${quality.total > 0 ? (quality.nofollow / quality.total) * 100 : 0}%`, background: "#6e7681" }} />
                                </div>
                                <div className="flex items-center gap-4 mt-2">
                                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-[#2ea043]" /><span className="text-[11px] font-semibold text-[#2ea043]">{quality.total > 0 ? Math.round((quality.doFollow / quality.total) * 100) : 0}%</span><span className="text-[11px] text-[#6e7681]">DoFollow</span></div>
                                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-[#6e7681]" /><span className="text-[11px] font-semibold text-[#6e7681]">{quality.total > 0 ? Math.round((quality.nofollow / quality.total) * 100) : 0}%</span><span className="text-[11px] text-[#6e7681]">NoFollow</span></div>
                                </div>
                            </div>

                            {/* DR Distribution Histogram */}
                            {stored.length > 0 && (
                                <div>
                                    <p className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] mb-2">DR Distribution</p>
                                    <ResponsiveContainer width="100%" height={100}>
                                        <BarChart data={drHistogram} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                                            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6e7681" }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                                                {drHistogram.map((b, i) => <Cell key={i} fill={i >= 4 ? "#2ea043" : i >= 2 ? "#d29922" : "#f85149"} />)}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* Toxic breakdown */}
                            {quality.toxicReasons.length > 0 && (
                                <div>
                                    <p className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] mb-2">Toxic Breakdown</p>
                                    <div className="space-y-1.5">
                                        {quality.toxicReasons.map(r => (
                                            <div key={r.reason} className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10">
                                                <span className="text-[11px] text-[#8b949e]">{toxicLabel(r.reason)}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[11px] font-bold text-red-400">{r.count}</span>
                                                    <span className="text-[10px] text-[#6e7681]">({quality.toxic > 0 ? Math.round((r.count / quality.toxic) * 100) : 0}%)</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>)}
                    </div>
                </div>
            </div>
            </PanelErrorBoundary>
            {/* ── Anchor Text Distribution ── */}
            {summary && summary.topAnchors.length > 0 && (
                <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                    <div className="px-5 py-3 border-b border-[#21262d]">
                        <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] m-0">Anchor Text Distribution</p>
                    </div>
                    <div className="p-4">
                        {overOptAnchor && (
                            <div className="mb-4 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex items-start gap-3">
                                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[12px] font-semibold text-amber-400 m-0">Over-optimisation detected</p>
                                    <p className="text-[11px] text-[#8b949e] mt-1 m-0">
                                        Exact-match anchor &ldquo;{overOptAnchor.anchor}&rdquo; represents {Math.round((overOptAnchor.count / totalAnchors) * 100)}% of your backlinks.
                                        This pattern triggers Google&rsquo;s Penguin filter. Diversify with branded and generic anchors.
                                    </p>
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            {summary.topAnchors.map(a => {
                                const pct = totalAnchors > 0 ? (a.count / totalAnchors) * 100 : 0;
                                return (
                                    <div key={a.anchor} className="flex items-center gap-3">
                                        <span className="text-[12px] text-[#e6edf3] w-[180px] truncate shrink-0">{a.anchor || "(no anchor)"}</span>
                                        <div className="flex-1 h-[5px] bg-[#21262d] rounded-full overflow-hidden">
                                            <div className="h-full rounded-full bg-[#388bfd] transition-all duration-700" style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="text-[11px] font-bold tabular-nums text-[#388bfd] w-10 text-right">{Math.round(pct)}%</span>
                                        <span className="text-[10px] text-[#6e7681] tabular-nums w-10 text-right">{fmt(a.count)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Referring Domains Table ── */}
            <PanelErrorBoundary label="Referring domains">
            <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden shadow-xl shadow-black/20">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d] flex-wrap gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-[#e6edf3] m-0">Referring Domains</h2>
                        <p className="text-[11px] text-[#6e7681] mt-0.5 m-0">{stored.length} domains tracked</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="relative">
                            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#6e7681] pointer-events-none" />
                            <input value={domainSearch} onChange={e => setDomainSearch(e.target.value)} placeholder="Filter domain…"
                                className="bg-[#0d1117] border border-[#30363d] rounded-lg pl-6 pr-3 py-1.5 text-[11px] text-[#e6edf3] w-[140px] outline-none focus:border-[#388bfd] transition-colors" />
                        </div>
                        <button onClick={() => setFilterToxic(f => !f)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${filterToxic ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-[#21262d] text-[#6e7681] border-[#30363d] hover:text-[#8b949e]"}`}>
                            <ShieldAlert size={11} /> Toxic only
                        </button>
                    </div>
                </div>

                {loadingStored ? (
                    <div className="flex items-center gap-2 text-[#6e7681] text-[12px] p-5"><Loader2 size={14} className="animate-spin" /> Loading…</div>
                ) : filteredStored.length === 0 ? (
                    <EmptyState icon={Link2} title={stored.length === 0 ? "No backlinks synced yet" : "No domains match your filter"}
                        sub={stored.length === 0 ? "Click Refresh to fetch your current backlink profile from DataForSEO." : "Try adjusting your filter criteria."}
                        onAction={stored.length === 0 ? () => fetchLive(true) : undefined} actionLabel={stored.length === 0 ? "Refresh now" : undefined} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-[#21262d]">
                                    {[
                                        { key: null, label: "Domain" },
                                        { key: null, label: "Anchor" },
                                        { key: "dr" as const, label: "DR" },
                                        { key: null, label: "Type" },
                                        { key: null, label: "Status" },
                                        { key: "spamScore" as const, label: "Spam" },
                                        { key: "firstSeen" as const, label: "First Seen" },
                                        { key: "lastSeen" as const, label: "Last Seen" },
                                    ].map(col => (
                                        <th key={col.label} onClick={() => col.key && toggleSort(col.key)}
                                            className={`px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.05em] select-none whitespace-nowrap ${col.key ? "cursor-pointer" : ""} ${col.key && sortCol === col.key ? "text-[#388bfd]" : "text-[#6e7681]"}`}>
                                            <span className="inline-flex items-center gap-1">
                                                {col.label}
                                                {col.key && sortCol === col.key && (sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStored.slice(0, 100).map((b, idx) => {
                                    const ss = spamScore(b);
                                    return (
                                    <tr key={b.id || b.srcDomain + idx} className={`border-b border-[#161b22] hover:bg-[#161b22] transition-colors ${b.isToxic ? "bg-red-500/[0.02]" : ""}`}>
                                        <td className="px-3 py-2.5">
                                            <a href={`https://${b.srcDomain}`} target="_blank" rel="noopener noreferrer"
                                                className="text-[12px] font-medium text-[#e6edf3] no-underline hover:text-[#388bfd] inline-flex items-center gap-1 transition-colors">
                                                {b.srcDomain} <ArrowUpRight size={10} className="opacity-40" />
                                            </a>
                                        </td>
                                        <td className="px-3 py-2.5"><span className={`text-[11px] ${b.anchorText ? "text-[#8b949e]" : "text-[#6e7681] italic"}`}>{b.anchorText || "no anchor"}</span></td>
                                        <td className="px-3 py-2.5"><DRBar dr={b.domainRating} /></td>
                                        <td className="px-3 py-2.5">
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${b.isDoFollow ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/10 text-[#6e7681] border-zinc-500/20"}`}>
                                                {b.isDoFollow ? "dofollow" : "nofollow"}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {b.isToxic ? (
                                                <div className="flex items-center gap-1.5"><ShieldAlert size={11} className="text-red-400" /><span className="text-[10px] font-semibold text-red-400">{toxicLabel(b.toxicReason)}</span></div>
                                            ) : <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Active</span>}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {ss > 0 ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded border tabular-nums ${spamBadgeCls(ss)}`}>{ss}</span> : <Minus size={11} className="text-[#30363d]" />}
                                        </td>
                                        <td className="px-3 py-2.5"><span className="text-[11px] text-[#6e7681] tabular-nums">{new Date(b.firstSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</span></td>
                                        <td className="px-3 py-2.5"><span className="text-[11px] text-[#6e7681] tabular-nums">{new Date(b.lastSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}</span></td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filteredStored.length > 100 && (
                            <p className="text-center text-[11px] text-[#6e7681] py-3">Showing top 100 of {filteredStored.length} — use the filter to narrow results.</p>
                        )}
                    </div>
                )}
            </div>
            </PanelErrorBoundary>
            {/* ── Competitor Gap Analysis ── */}
            <PanelErrorBoundary label="Competitor gap">
            <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#21262d]">
                    <h2 className="text-sm font-semibold text-[#e6edf3] m-0">Competitor Gap Analysis</h2>
                    <p className="text-[11px] text-[#6e7681] mt-0.5 m-0">Find domains linking to competitors but not to you</p>
                </div>
                <div className="p-4">
                    <div className="flex gap-2 mb-4 items-center">
                        <div className="relative flex-1 max-w-[320px]">
                            <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6e7681] pointer-events-none" />
                            <input value={competitorInput} onChange={e => setCompetitorInput(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchGap()}
                                placeholder="competitor.com"
                                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-7 pr-3 py-2 text-[12px] text-[#e6edf3] outline-none focus:border-[#388bfd] transition-colors" />
                        </div>
                        <button onClick={fetchGap} disabled={loadingGap || !competitorInput.trim()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#388bfd]/15 border border-[#388bfd]/30 text-[#388bfd] text-[12px] font-bold hover:bg-[#388bfd]/25 transition-colors disabled:opacity-50">
                            {loadingGap ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Analyse
                        </button>
                    </div>

                    {gap && (
                        <div className="space-y-4">
                            {/* Metric comparison */}
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: "Total Backlinks", you: gap.you.totalBacklinks, them: gap.competitor.totalBacklinks, diff: gap.gap.totalBacklinks },
                                    { label: "Referring Domains", you: gap.you.referringDomains, them: gap.competitor.referringDomains, diff: gap.gap.referringDomains },
                                    { label: "Domain Rating", you: gap.you.domainRating, them: gap.competitor.domainRating, diff: gap.gap.domainRating },
                                ].map(m => (
                                    <div key={m.label} className="rounded-xl border border-[#21262d] bg-[#161b22] p-3">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#6e7681] mb-2 m-0">{m.label}</p>
                                        <div className="flex justify-between mb-2">
                                            <div><p className="text-[9px] text-[#6e7681] m-0">You</p><p className="text-[16px] font-bold text-emerald-400 tabular-nums m-0">{fmt(m.you)}</p></div>
                                            <div className="text-right"><p className="text-[9px] text-[#6e7681] m-0">Competitor</p><p className="text-[16px] font-bold text-[#388bfd] tabular-nums m-0">{fmt(m.them)}</p></div>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${m.diff > 0 ? "bg-red-500/10 text-red-400 border-red-500/20" : m.diff < 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/10 text-[#6e7681] border-zinc-500/20"}`}>
                                            {m.diff > 0 ? <TrendingDown size={10} /> : m.diff < 0 ? <TrendingUp size={10} /> : <Minus size={10} />}
                                            {m.diff > 0 ? "+" : ""}{fmt(Math.abs(m.diff))} gap
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Opportunity domains TABLE (not chips) */}
                            {sortedGapDomains.length > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <SectionLabel>Outreach Opportunities — {gap.gap.opportunityDomains.length} domains</SectionLabel>
                                    </div>
                                    <div className="flex gap-2 mb-3">
                                        {[0, 30, 60].map(threshold => (
                                            <button key={threshold} onClick={() => setGapDrFilter(threshold)}
                                                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${gapDrFilter === threshold ? "bg-[#388bfd]/15 text-[#388bfd] border border-[#388bfd]/30" : "text-[#6e7681] hover:text-[#8b949e]"}`}>
                                                {threshold === 0 ? "All" : `DR ${threshold}+`}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="overflow-x-auto rounded-lg border border-[#21262d]">
                                        <table className="w-full border-collapse">
                                            <thead>
                                                <tr className="border-b border-[#21262d] bg-[#161b22]">
                                                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.05em] text-[#6e7681]">Domain</th>
                                                    <th onClick={() => setGapSort(gapSort === "dr" ? "domain" : "dr")} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.05em] text-[#388bfd] cursor-pointer">
                                                        DR {gapSort === "dr" && <ChevronDown size={9} className="inline" />}
                                                    </th>
                                                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.05em] text-[#6e7681]">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedGapDomains.slice(0, 50).map(({ domain, dr }) => (
                                                    <tr key={domain} className="border-b border-[#161b22] hover:bg-[#161b22] transition-colors">
                                                        <td className="px-3 py-2.5">
                                                            <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer"
                                                                className="text-[12px] font-medium text-[#388bfd] no-underline hover:underline inline-flex items-center gap-1">
                                                                {domain} <ArrowUpRight size={9} className="opacity-50" />
                                                            </a>
                                                        </td>
                                                        <td className="px-3 py-2.5"><DRBar dr={dr} /></td>
                                                        <td className="px-3 py-2.5">
                                                            {addedDomains.has(domain) ? (
                                                                <span className="text-[10px] font-bold text-emerald-400">✓ Added</span>
                                                            ) : (
                                                                <button onClick={() => handleAddToPlanner(domain, dr ?? null)}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/20 transition-colors">
                                                                    <Plus size={9} /> Planner
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {!gap && !loadingGap && (
                        <EmptyState icon={Globe} title="Compare your backlink profile" sub="Enter a competitor domain to find outreach opportunities and close the gap." />
                    )}
                </div>
            </div>
            </PanelErrorBoundary>

            {/* ── Gap → Planner modal ── */}
            {gapModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setGapModal(null)}>
                    <div className="bg-[#0d1117] border border-[#30363d] rounded-2xl p-6 w-[380px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-[14px] font-bold text-[#e6edf3] m-0">Add to Planner</p>
                                <p className="text-[11px] text-[#6e7681] mt-1 m-0">{gapModal.domain}{gapModal.dr != null ? ` · DR ${gapModal.dr}` : ""}</p>
                            </div>
                            <button onClick={() => setGapModal(null)} className="text-[#6e7681] hover:text-[#8b949e] transition-colors bg-transparent border-none cursor-pointer p-1"><X size={16} /></button>
                        </div>
                        <p className="text-[11px] text-[#6e7681] mb-3 m-0">Select a planner item to attach this outreach target to:</p>
                        {plannerItems.length === 0 ? (
                            <p className="text-[12px] text-[#6e7681] text-center py-4">No planner items yet. Create one first in the Content Planner.</p>
                        ) : (
                            <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
                                {plannerItems.map(pi => (
                                    <button key={pi.id} onClick={() => confirmAddToPlanner(pi.id)} disabled={plannerPending}
                                        className="text-left px-3 py-2.5 rounded-lg bg-[#161b22] border border-[#21262d] text-[#e6edf3] text-[12px] font-medium hover:bg-[#21262d] hover:border-[#30363d] transition-colors disabled:opacity-50 w-full cursor-pointer">
                                        {pi.title ?? pi.keyword}
                                        <span className="block text-[10px] text-[#6e7681] mt-0.5">{pi.keyword}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
}
