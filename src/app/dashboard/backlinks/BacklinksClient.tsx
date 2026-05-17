"use client";

/**
 * /dashboard/backlinks – Backlink Monitoring Dashboard
 *
 * Connects every piece of the existing backlink infrastructure to the UI:
 *   • Live summary (DataForSEO via /api/backlinks?mode=summary)
 *   • Stored referring domains from DB (?mode=stored)
 *   • Toxic link quality breakdown (?mode=quality)
 *   • Gained/lost alerts from DB (?mode=alerts)
 *   • Competitor gap analysis (?mode=gap&competitor=...)
 */

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { PanelErrorBoundary } from "@/components/dashboard/PanelErrorBoundary";
import type { BacklinkSummary, StoredBacklink, BacklinkAlert, QualitySummary, BacklinkGapReport } from "@/types/backlinks";
import {
    Link2, TrendingUp, TrendingDown, AlertTriangle,
    ShieldAlert, Globe, RefreshCw, ChevronDown,
    ChevronUp, ArrowUpRight, Loader2, Search,
    CheckCircle2, XCircle, Minus,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// Types are imported from @/types/backlinks above
// GapReport is the BacklinkGapReport shape
type GapReport = BacklinkGapReport;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function drColor(dr: number | null): string {
    if (dr == null) return "rgba(255,255,255,.25)";
    if (dr >= 60) return "#34d399";
    if (dr >= 30) return "#fbbf24";
    return "#f87171";
}

function toxicLabel(reason: string | null): string {
    switch (reason) {
        case "exact_match_anchor": return "Exact-match anchor";
        case "low_dr_spam": return "Low-DR spam";
        case "toxic_keyword": return "Toxic keyword";
        default: return reason ?? "Unknown";
    }
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
    label, value, sub, icon: Icon, accent = "rgba(255,255,255,.06)",
    iconColor = "rgba(255,255,255,.35)",
}: {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ElementType;
    accent?: string;
    iconColor?: string;
}) {
    return (
        <div style={{
            padding: "18px 20px",
            borderRadius: 14,
            background: "rgba(255,255,255,.02)",
            border: "1px solid rgba(255,255,255,.07)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
        }}>
            <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: accent, border: `1px solid ${iconColor}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
            }}>
                <Icon size={15} style={{ color: iconColor }} />
            </div>
            <div>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "rgba(255,255,255,.9)", fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em" }}>
                    {value}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,.35)" }}>
                    {label}
                </p>
                {sub && (
                    <p style={{ margin: "4px 0 0", fontSize: 10, color: "rgba(255,255,255,.2)" }}>{sub}</p>
                )}
            </div>
        </div>
    );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children, action }: {
    title: string;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,.07)",
            background: "rgba(255,255,255,.015)",
            overflow: "hidden",
        }}>
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 18px",
                borderBottom: "1px solid rgba(255,255,255,.06)",
            }}>
                <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(255,255,255,.45)" }}>
                    {title}
                </h3>
                {action}
            </div>
            <div style={{ padding: "16px 18px" }}>
                {children}
            </div>
        </div>
    );
}

// ─── DR badge ─────────────────────────────────────────────────────────────────

function DRBadge({ dr }: { dr: number | null }) {
    const color = drColor(dr);
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
            background: `${color}18`, color, border: `1px solid ${color}30`,
            fontVariantNumeric: "tabular-nums",
        }}>
            DR {dr ?? "—"}
        </span>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
    // siteId comes from props when server-rendered; fall back to searchParams for direct navigation
    const searchParams = useSearchParams();
    const effectiveSiteId = siteId || searchParams.get("siteId");

    const [summary, setSummary] = useState<BacklinkSummary | null>(initialSummary);
    const [stored, setStored] = useState<StoredBacklink[]>(initialStored);
    const [alerts, setAlerts] = useState<BacklinkAlert[]>([]);
    const [quality, setQuality] = useState<QualitySummary | null>(null);
    const [gap, setGap] = useState<GapReport | null>(null);
    const [drTrend, setDrTrend] = useState<{ date: string; dr: number }[]>([]);

    const [loadingLive, setLoadingLive] = useState(false);
    const [loadingStored, setLoadingStored] = useState(false);
    const [loadingGap, setLoadingGap] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [competitorInput, setCompetitorInput] = useState("");
    const [filterToxic, setFilterToxic] = useState(false);
    const [sortCol, setSortCol] = useState<"dr" | "firstSeen">("dr");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [domainSearch, setDomainSearch] = useState("");


    const fetchLive = useCallback(async (bust = false) => {
        if (!effectiveSiteId) return;
        setLoadingLive(true);
        setError(null);
        try {
            const refresh = bust ? "&refresh=true" : "";
            const [sumRes, alertRes, qualRes] = await Promise.all([
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=summary${refresh}`),
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=alerts`),
                fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=quality`),
            ]);
            if (!sumRes.ok) {
                const e = await sumRes.json();
                setError(e.error ?? "Failed to fetch summary");
            } else {
                const { summary: s } = await sumRes.json();
                setSummary(s);
            }
            if (alertRes.ok) { const { alerts: a } = await alertRes.json(); setAlerts(a ?? []); }
            if (qualRes.ok)  { const { quality: q } = await qualRes.json(); setQuality(q); }
        } catch {
            setError("Network error. Please try again.");
        } finally {
            setLoadingLive(false);
        }
    }, [effectiveSiteId]);

    const fetchStored = useCallback(async () => {
        if (!effectiveSiteId) return;
        setLoadingStored(true);
        try {
            const res = await fetch(`/api/backlinks?siteId=${effectiveSiteId}&mode=stored`);
            if (res.ok) { const { stored: s } = await res.json(); setStored(s ?? []); }
        } finally {
            setLoadingStored(false);
        }
    }, [effectiveSiteId]);

    const fetchGap = useCallback(async () => {
        if (!effectiveSiteId || !competitorInput.trim()) return;
        setLoadingGap(true);
        try {
            const res = await fetch(
                `/api/backlinks?siteId=${effectiveSiteId}&mode=gap&competitor=${encodeURIComponent(competitorInput.trim())}`
            );
            if (res.ok) { const { report } = await res.json(); setGap(report); }
        } finally {
            setLoadingGap(false);
        }
    }, [effectiveSiteId, competitorInput]);

    // Fetch alerts + quality on mount (summary + stored already seeded from server)
    useEffect(() => {
        if (effectiveSiteId) {
            fetchLive();
            fetch(`/api/backlinks/dr-trend?siteId=${effectiveSiteId}`)
              .then((r) => r.ok ? r.json() : null)
              .then((data) => { if (data?.trend?.length) setDrTrend(data.trend); })
              .catch(() => {});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveSiteId]);


    const filteredStored = stored
        .filter(b => !filterToxic || b.isToxic)
        .filter(b => !domainSearch || b.srcDomain.toLowerCase().includes(domainSearch.toLowerCase()))
        .sort((a, b) => {
            let av: number, bv: number;
            if (sortCol === "dr") {
                av = a.domainRating ?? -1;
                bv = b.domainRating ?? -1;
            } else {
                av = new Date(a.firstSeen).getTime();
                bv = new Date(b.firstSeen).getTime();
            }
            return sortDir === "desc" ? bv - av : av - bv;
        });

    const toggleSort = (col: "dr" | "firstSeen") => {
        if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
        else { setSortCol(col); setSortDir("desc"); }
    };


    if (!effectiveSiteId) return (
        <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "50vh",
            color: "rgba(255,255,255,.25)", fontSize: 13,
        }}>
            Select a site from the sidebar to view backlinks.
        </div>
    );


    return (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 80px" }}>

            {/* ── Page header ── */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "28px 0 24px",
                borderBottom: "1px solid rgba(255,255,255,.05)",
                marginBottom: 28, flexWrap: "wrap", gap: 12,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 9,
                        background: "rgba(59,130,246,.1)",
                        border: "1px solid rgba(59,130,246,.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Link2 size={15} style={{ color: "#60a5fa" }} />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,.9)", letterSpacing: "-.02em" }}>
                            Backlinks
                        </h1>
                        <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,.3)" }}>
                            Live monitoring · quality analysis · competitor gap
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => fetchLive(true)}
                    disabled={loadingLive}
                    style={{
                        display: "inline-flex", alignItems: "center", gap: 7,
                        padding: "8px 14px", borderRadius: 10,
                        background: "rgba(255,255,255,.04)",
                        border: "1px solid rgba(255,255,255,.1)",
                        color: "rgba(255,255,255,.6)", fontSize: 12, fontWeight: 600,
                        cursor: loadingLive ? "not-allowed" : "pointer",
                        opacity: loadingLive ? .5 : 1,
                        transition: "all .15s",
                    }}
                >
                    <RefreshCw size={12} style={{ animation: loadingLive ? "spin 1s linear infinite" : "none" }} />
                    Refresh
                </button>
            </div>

            {/* ── Error banner ── */}
            {error && (
                <div style={{
                    marginBottom: 20, padding: "12px 16px", borderRadius: 10,
                    background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)",
                    color: "#f87171", fontSize: 12, display: "flex", alignItems: "center", gap: 8,
                }}>
                    <AlertTriangle size={13} />
                    {error}
                </div>
            )}

            {/* ── Summary stats ── */}
            <PanelErrorBoundary label="Backlink summary">
            {loadingLive && !summary ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "rgba(255,255,255,.25)", fontSize: 13, marginBottom: 28 }}>
                    <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                    Loading live data…
                </div>
            ) : summary && (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: 12, marginBottom: 28,
                }}>
                    <StatCard label="Total Backlinks" value={fmt(summary.totalBacklinks)} icon={Link2} accent="rgba(59,130,246,.1)" iconColor="#60a5fa" />
                    <StatCard label="Referring Domains" value={fmt(summary.referringDomains)} icon={Globe} accent="rgba(16,185,129,.1)" iconColor="#34d399" />
                    <StatCard label="Domain Rating" value={summary.domainRating} icon={TrendingUp} accent="rgba(139,92,246,.1)" iconColor="#a78bfa" />
                    <StatCard label="Gained (7d)" value={`+${summary.newLastWeek}`} icon={TrendingUp} accent="rgba(16,185,129,.08)" iconColor="#34d399"
                        sub="new referring domains" />
                    <StatCard label="Lost (7d)" value={`-${summary.lostLastWeek}`} icon={TrendingDown} accent="rgba(239,68,68,.08)" iconColor="#f87171"
                        sub="lost referring domains" />
                    <StatCard label="Broken / Toxic" value={summary.brokenBacklinks} icon={ShieldAlert} accent="rgba(251,191,36,.08)" iconColor="#fbbf24" />
                </div>
            )}

            {drTrend.length > 1 && (
              <div style={{
                padding: "18px 20px",
                borderRadius: 14,
                background: "rgba(255,255,255,.02)",
                border: "1px solid rgba(255,255,255,.07)",
                marginBottom: 28,
              }}>
                <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,.35)" }}>
                  Domain rating — 90 days
                </p>
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={drTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis domain={["dataMin - 2", "dataMax + 2"]} hide />
                    <Tooltip
                      contentStyle={{
                        background: "#1a1a2e",
                        border: "1px solid rgba(255,255,255,.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number | undefined) => [`DR ${v ?? "N/A"}`, ""]}
                      labelFormatter={(l: string) => l}
                    />
                    <Line
                      type="monotone"
                      dataKey="dr"
                      stroke="#34d399"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#34d399" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            </PanelErrorBoundary>

            {/* ── Two-column layout: alerts + quality ── */}
            <PanelErrorBoundary label="Alerts and quality">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>

                {/* Recent alerts */}
                <Section title="Recent Alerts">
                    {alerts.length === 0 ? (
                        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.25)", textAlign: "center", padding: "12px 0" }}>
                            No alerts yet. Alerts appear after the first cron sync.
                        </p>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {alerts.slice(0, 10).map(a => (
                                <div key={a.id} style={{
                                    display: "flex", alignItems: "center", gap: 10,
                                    padding: "8px 10px", borderRadius: 9,
                                    background: a.type === "gained" ? "rgba(16,185,129,.04)" : "rgba(239,68,68,.04)",
                                    border: `1px solid ${a.type === "gained" ? "rgba(16,185,129,.12)" : "rgba(239,68,68,.12)"}`,
                                }}>
                                    {a.type === "gained"
                                        ? <CheckCircle2 size={13} style={{ color: "#34d399", flexShrink: 0 }} />
                                        : <XCircle size={13} style={{ color: "#f87171", flexShrink: 0 }} />
                                    }
                                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,.7)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {a.domain}
                                    </span>
                                    {a.dr != null && <DRBadge dr={a.dr} />}
                                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.2)", flexShrink: 0 }}>
                                        {new Date(a.detectedAt).toLocaleDateString()}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </Section>

                {/* Toxic quality breakdown */}
                <Section title="Link Quality">
                    {!quality ? (
                        <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.25)", textAlign: "center", padding: "12px 0" }}>
                            Quality data syncs automatically during cron.
                        </p>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {/* DoFollow / NoFollow bar — only shown when nofollow data exists;
                                if every stored backlink is dofollow the bar would always read
                                100% which is misleading before the first full cron sync. */}
                            {quality.nofollow > 0 && (
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>DoFollow</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#34d399" }}>
                                        {quality.total > 0 ? Math.round((quality.doFollow / quality.total) * 100) : 0}%
                                    </span>
                                </div>
                                <div style={{ height: 4, background: "rgba(255,255,255,.06)", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%",
                                        width: `${quality.total > 0 ? (quality.doFollow / quality.total) * 100 : 0}%`,
                                        background: "linear-gradient(90deg, #059669, #34d399)",
                                        borderRadius: 3,
                                        transition: "width .5s ease",
                                    }} />
                                </div>
                            </div>
                            )}

                            {/* Toxic bar */}
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Toxic</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: "#f87171" }}>
                                        {quality.total > 0 ? Math.round((quality.toxic / quality.total) * 100) : 0}%
                                        <span style={{ fontWeight: 400, color: "rgba(255,255,255,.25)", marginLeft: 4 }}>({quality.toxic})</span>
                                    </span>
                                </div>
                                <div style={{ height: 4, background: "rgba(255,255,255,.06)", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%",
                                        width: `${quality.total > 0 ? (quality.toxic / quality.total) * 100 : 0}%`,
                                        background: "linear-gradient(90deg, #b91c1c, #f87171)",
                                        borderRadius: 3,
                                        transition: "width .5s ease",
                                    }} />
                                </div>
                            </div>

                            {/* Toxic breakdown */}
                            {quality.toxicReasons.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
                                    {quality.toxicReasons.map(r => (
                                        <div key={r.reason} style={{
                                            display: "flex", justifyContent: "space-between", alignItems: "center",
                                            padding: "5px 8px", borderRadius: 7,
                                            background: "rgba(239,68,68,.04)",
                                        }}>
                                            <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>{toxicLabel(r.reason)}</span>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "#f87171" }}>{r.count}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </Section>
            </div>
            </PanelErrorBoundary>

            {/* ── Top Anchors ── */}
            {summary && summary.topAnchors.length > 0 && (
                <Section title="Top Anchor Texts">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {summary.topAnchors.map(a => (
                            <div key={a.anchor} style={{
                                display: "inline-flex", alignItems: "center", gap: 8,
                                padding: "5px 10px", borderRadius: 8,
                                background: "rgba(255,255,255,.03)",
                                border: "1px solid rgba(255,255,255,.07)",
                            }}>
                                <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>{a.anchor || "(no anchor)"}</span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.25)", background: "rgba(255,255,255,.06)", padding: "1px 5px", borderRadius: 4 }}>
                                    {fmt(a.count)}
                                </span>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* spacer */}
            <div style={{ height: 20 }} />

            {/* ── Referring domains table ── */}
            <PanelErrorBoundary label="Referring domains">
            <Section
                title={`Referring Domains${stored.length > 0 ? ` (${stored.length})` : ""}`}
                action={
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {/* Domain search */}
                        <div style={{ position: "relative" }}>
                            <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,.3)", pointerEvents: "none" }} />
                            <input
                                value={domainSearch}
                                onChange={e => setDomainSearch(e.target.value)}
                                placeholder="Filter domain…"
                                style={{
                                    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
                                    borderRadius: 8, padding: "5px 10px 5px 24px",
                                    color: "rgba(255,255,255,.7)", fontSize: 11, outline: "none", width: 140,
                                }}
                            />
                        </div>
                        {/* Toxic filter */}
                        <button
                            onClick={() => setFilterToxic(f => !f)}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                                background: filterToxic ? "rgba(239,68,68,.12)" : "rgba(255,255,255,.04)",
                                border: filterToxic ? "1px solid rgba(239,68,68,.25)" : "1px solid rgba(255,255,255,.1)",
                                color: filterToxic ? "#f87171" : "rgba(255,255,255,.4)",
                                cursor: "pointer", transition: "all .15s",
                            }}
                        >
                            <ShieldAlert size={11} />
                            Toxic only
                        </button>
                    </div>
                }
            >
                {loadingStored ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,.25)", fontSize: 12, padding: "12px 0" }}>
                        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                        Loading stored domains…
                    </div>
                ) : filteredStored.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.25)", textAlign: "center", padding: "20px 0" }}>
                        {stored.length === 0 ? "No data yet — cron hasn't synced for this site." : "No domains match your filter."}
                    </p>
                ) : (
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                                    {[
                                        { key: "srcDomain", label: "Domain", sortable: false },
                                        { key: "anchorText", label: "Anchor", sortable: false },
                                        { key: "dr", label: "DR", sortable: true },
                                        { key: null, label: "Type", sortable: false },
                                        { key: null, label: "Status", sortable: false },
                                        { key: "firstSeen", label: "First Seen", sortable: true },
                                    ].map(col => (
                                        <th key={col.label}
                                            onClick={() => col.sortable && col.key && toggleSort(col.key as "dr" | "firstSeen")}
                                            style={{
                                                padding: "8px 10px", textAlign: "left",
                                                fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
                                                color: col.sortable && sortCol === col.key ? "#60a5fa" : "rgba(255,255,255,.25)",
                                                cursor: col.sortable ? "pointer" : "default",
                                                userSelect: "none",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                                {col.label}
                                                {col.sortable && col.key && sortCol === col.key && (
                                                    sortDir === "desc"
                                                        ? <ChevronDown size={10} />
                                                        : <ChevronUp size={10} />
                                                )}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStored.slice(0, 100).map((b, idx) => (
                                    <tr key={b.srcDomain} style={{
                                        borderBottom: idx < filteredStored.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none",
                                        background: b.isToxic ? "rgba(239,68,68,.03)" : "transparent",
                                        transition: "background .1s",
                                    }}
                                        onMouseEnter={e => (e.currentTarget.style.background = b.isToxic ? "rgba(239,68,68,.06)" : "rgba(255,255,255,.025)")}
                                        onMouseLeave={e => (e.currentTarget.style.background = b.isToxic ? "rgba(239,68,68,.03)" : "transparent")}
                                    >
                                        {/* Domain */}
                                        <td style={{ padding: "9px 10px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                                <a
                                                    href={`https://${b.srcDomain}`}
                                                    target="_blank" rel="noopener noreferrer"
                                                    style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,.75)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                                                >
                                                    {b.srcDomain}
                                                    <ArrowUpRight size={10} style={{ opacity: .4 }} />
                                                </a>
                                            </div>
                                        </td>
                                        {/* Anchor */}
                                        <td style={{ padding: "9px 10px" }}>
                                            <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", fontStyle: b.anchorText ? "normal" : "italic" }}>
                                                {b.anchorText || "no anchor"}
                                            </span>
                                        </td>
                                        {/* DR */}
                                        <td style={{ padding: "9px 10px" }}>
                                            <DRBadge dr={b.domainRating} />
                                        </td>
                                        {/* Type */}
                                        <td style={{ padding: "9px 10px" }}>
                                            <span style={{
                                                fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5,
                                                background: b.isDoFollow ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.05)",
                                                color: b.isDoFollow ? "#34d399" : "rgba(255,255,255,.3)",
                                            }}>
                                                {b.isDoFollow ? "dofollow" : "nofollow"}
                                            </span>
                                        </td>
                                        {/* Status */}
                                        <td style={{ padding: "9px 10px" }}>
                                            {b.isToxic ? (
                                                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                                    <ShieldAlert size={11} style={{ color: "#f87171" }} />
                                                    <span style={{ fontSize: 10, fontWeight: 600, color: "#f87171" }}>
                                                        {toxicLabel(b.toxicReason)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <Minus size={11} style={{ color: "rgba(255,255,255,.15)" }} />
                                            )}
                                        </td>
                                        {/* First seen */}
                                        <td style={{ padding: "9px 10px" }}>
                                            <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>
                                                {new Date(b.firstSeen).toLocaleDateString()}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filteredStored.length > 100 && (
                            <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,.2)", textAlign: "center" }}>
                                Showing top 100 of {filteredStored.length} — use the filter to narrow results.
                            </p>
                        )}
                    </div>
                )}
            </Section>
            </PanelErrorBoundary>

            <div style={{ height: 20 }} />

            {/* ── Competitor Gap ── */}
            <PanelErrorBoundary label="Competitor gap">
            <Section title="Competitor Gap Analysis">
                <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
                    <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                        <Globe size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,.3)", pointerEvents: "none" }} />
                        <input
                            value={competitorInput}
                            onChange={e => setCompetitorInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && fetchGap()}
                            placeholder="competitor.com"
                            style={{
                                width: "100%", boxSizing: "border-box",
                                background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
                                borderRadius: 9, padding: "8px 12px 8px 30px",
                                color: "rgba(255,255,255,.8)", fontSize: 12, outline: "none",
                            }}
                        />
                    </div>
                    <button
                        onClick={fetchGap}
                        disabled={loadingGap || !competitorInput.trim()}
                        style={{
                            padding: "8px 16px", borderRadius: 9,
                            background: "rgba(59,130,246,.15)", border: "1px solid rgba(59,130,246,.3)",
                            color: "#60a5fa", fontSize: 12, fontWeight: 700,
                            cursor: loadingGap || !competitorInput.trim() ? "not-allowed" : "pointer",
                            opacity: loadingGap || !competitorInput.trim() ? .5 : 1,
                            display: "flex", alignItems: "center", gap: 7,
                            transition: "all .15s",
                        }}
                    >
                        {loadingGap ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={12} />}
                        Analyse
                    </button>
                </div>

                {gap && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {/* Metric comparison */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                            {[
                                { label: "Total Backlinks", you: gap.you.totalBacklinks, them: gap.competitor.totalBacklinks, diff: gap.gap.totalBacklinks },
                                { label: "Referring Domains", you: gap.you.referringDomains, them: gap.competitor.referringDomains, diff: gap.gap.referringDomains },
                                { label: "Domain Rating", you: gap.you.domainRating, them: gap.competitor.domainRating, diff: gap.gap.domainRating },
                            ].map(m => (
                                <div key={m.label} style={{
                                    padding: "14px 16px", borderRadius: 12,
                                    background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
                                }}>
                                    <p style={{ margin: "0 0 10px", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(255,255,255,.3)" }}>
                                        {m.label}
                                    </p>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <div>
                                            <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,.25)" }}>You</p>
                                            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>{fmt(m.you)}</p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,.25)" }}>Competitor</p>
                                            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#60a5fa", fontVariantNumeric: "tabular-nums" }}>{fmt(m.them)}</p>
                                        </div>
                                    </div>
                                    <div style={{
                                        display: "inline-flex", alignItems: "center", gap: 4,
                                        padding: "2px 8px", borderRadius: 6,
                                        background: m.diff > 0 ? "rgba(239,68,68,.1)" : m.diff < 0 ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.05)",
                                        color: m.diff > 0 ? "#f87171" : m.diff < 0 ? "#34d399" : "rgba(255,255,255,.3)",
                                        fontSize: 11, fontWeight: 700,
                                    }}>
                                        {m.diff > 0 ? <TrendingDown size={11} /> : m.diff < 0 ? <TrendingUp size={11} /> : <Minus size={11} />}
                                        {m.diff > 0 ? "+" : ""}{fmt(Math.abs(m.diff))} gap
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Opportunity domains */}
                        {gap.gap.opportunityDomains.length > 0 && (
                            <div>
                                <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "rgba(255,255,255,.35)" }}>
                                    Outreach Opportunities — {gap.gap.opportunityDomains.length} domains linking to {gap.competitorDomain} not you
                                </h4>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {gap.gap.opportunityDomains.map(({ domain, dr }) => (
                                        <a key={domain}
                                            href={`https://${domain}`} target="_blank" rel="noopener noreferrer"
                                            style={{
                                                display: "inline-flex", alignItems: "center", gap: 5,
                                                padding: "5px 10px", borderRadius: 7,
                                                background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.15)",
                                                color: "#60a5fa", fontSize: 11, fontWeight: 500, textDecoration: "none",
                                                transition: "all .12s",
                                            }}
                                        >
                                            {domain}
                                            <span style={{ fontSize: 9, opacity: .55, marginLeft: 2, fontVariantNumeric: "tabular-nums" }}>DR {dr}</span>
                                            <ArrowUpRight size={9} style={{ opacity: .6 }} />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {!gap && !loadingGap && (
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,.2)", textAlign: "center", padding: "12px 0" }}>
                        Enter a competitor domain to compare referring domains and find outreach opportunities.
                    </p>
                )}
            </Section>
            </PanelErrorBoundary>

            {/* Keyframe for spinner */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
