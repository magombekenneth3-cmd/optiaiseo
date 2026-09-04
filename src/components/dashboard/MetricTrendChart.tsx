"use client";

import { useState } from "react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface DataPoint {
    capturedAt: string;
    overallScore: number | null;
    aeoScore: number | null;
    coreWebVitals: number | null;
    schemaScore: number | null;
    organicTraffic: number | null;
}

interface AuditDataPoint {
    name: string;
    score: number;
    issues?: number;
}

type MetricKey = "overallScore" | "aeoScore" | "coreWebVitals" | "schemaScore" | "organicTraffic";
type TabKey = MetricKey | "auditTrend";

const METRICS: { key: MetricKey; label: string; color: string; unit?: string }[] = [
    { key: "overallScore",   label: "SEO Score",       color: "#10b981" },
    { key: "aeoScore",       label: "AEO Score",       color: "#6366f1" },
    { key: "coreWebVitals",  label: "Core Web Vitals", color: "#f59e0b" },
    { key: "schemaScore",    label: "Schema Score",    color: "#8b5cf6" },
    { key: "organicTraffic", label: "Organic Traffic", color: "#06b6d4", unit: "clicks" },
];

const AUDIT_TAB = { key: "auditTrend" as const, label: "Last 14 Audits", color: "#10b981" };

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Deduplicate date labels: if "Aug 24" appears twice, the second becomes "Aug 24 (2)".
 */
function deduplicateDates(dates: string[]): string[] {
    const counts = new Map<string, number>();
    return dates.map((d) => {
        const n = (counts.get(d) ?? 0) + 1;
        counts.set(d, n);
        return n > 1 ? `${d} (${n})` : d;
    });
}

function TrendBadge({ current, prev }: { current: number | null; prev: number | null }) {
    if (current == null || prev == null) return null;
    const delta = current - prev;
    const pct = prev > 0 ? Math.round((delta / prev) * 100) : 0;
    if (Math.abs(pct) < 1) return <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="w-3 h-3" /> No change</span>;
    if (pct > 0) return <span className="flex items-center gap-0.5 text-xs text-emerald-400"><TrendingUp className="w-3 h-3" /> +{pct}%</span>;
    return <span className="flex items-center gap-0.5 text-xs text-rose-400"><TrendingDown className="w-3 h-3" /> {pct}%</span>;
}

interface MetricTrendChartProps {
    data: DataPoint[];
    auditData?: AuditDataPoint[];
    className?: string;
}

export function MetricTrendChart({ data, auditData, className = "" }: MetricTrendChartProps) {
    const hasAuditData = auditData && auditData.length > 0;
    const [activeTab, setActiveTab] = useState<TabKey>(data.length > 0 ? "overallScore" : "auditTrend");

    if (data.length === 0 && !hasAuditData) {
        return (
            <div className={`card-elevated p-6 ${className}`}>
                <p className="text-sm text-muted-foreground text-center py-8">
                    No trend data yet — run your first audit to start tracking.
                </p>
            </div>
        );
    }

    const isAuditTab = activeTab === "auditTrend";

    // Build chart data for the active tab
    let chartData: { date: string; value: number | null }[];
    let activeColor: string;
    let activeUnit: string | undefined;
    let first: number | null;
    let last: number | null;
    let headerLabel: string;
    let pointCount: number;

    if (isAuditTab && hasAuditData) {
        const rawDates = auditData!.map(d => d.name);
        const dedupedDates = deduplicateDates(rawDates);
        chartData = auditData!.map((d, i) => ({
            date: dedupedDates[i],
            value: d.score,
        }));
        activeColor = AUDIT_TAB.color;
        activeUnit = undefined;
        first = auditData![0]?.score ?? null;
        last = auditData![auditData!.length - 1]?.score ?? null;
        headerLabel = "Last 14 Audits";
        pointCount = auditData!.length;
    } else {
        const metric = METRICS.find(m => m.key === activeTab)!;
        const rawDates = data.map(d => formatDate(d.capturedAt));
        const dedupedDates = deduplicateDates(rawDates);
        chartData = data.map((d, i) => ({
            date: dedupedDates[i],
            value: d[activeTab as MetricKey] ?? null,
        }));
        activeColor = metric.color;
        activeUnit = metric.unit;
        first = data[0]?.[activeTab as MetricKey] ?? null;
        last = data[data.length - 1]?.[activeTab as MetricKey] ?? null;
        headerLabel = "6-Month Trend";
        pointCount = data.length;
    }

    const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
        if (!active || !payload?.[0]) return null;
        return (
            <div className="card-elevated px-3 py-2 text-xs">
                <p className="text-muted-foreground mb-0.5">{label}</p>
                <p className="font-semibold text-foreground">
                    {payload[0].value?.toFixed(1)}{activeUnit ? ` ${activeUnit}` : ""}
                </p>
            </div>
        );
    };

    // Build tabs list: metrics + optional audit tab
    const allTabs: { key: TabKey; label: string; color: string }[] = [
        ...METRICS,
        ...(hasAuditData ? [AUDIT_TAB] : []),
    ];

    return (
        <div className={`card-elevated p-5 ${className}`}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 min-w-0">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">{headerLabel}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{pointCount} data points</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {last != null && (
                        <span className="text-lg font-bold" style={{ color: activeColor }}>
                            {last.toFixed(0)}{activeUnit ? " " + activeUnit : ""}
                        </span>
                    )}
                    <TrendBadge current={last} prev={first} />
                </div>
            </div>

            {/* Metric selector tabs */}
            <div className="flex gap-1.5 flex-wrap mb-4">
                {allTabs.map(m => (
                    <button
                        key={m.key}
                        onClick={() => setActiveTab(m.key)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            activeTab === m.key
                                ? "text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground bg-accent/40 hover:bg-accent"
                        }`}
                        style={activeTab === m.key ? { background: m.color } : {}}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* Chart */}
            <div style={{ height: 'clamp(200px, 40vw, 320px)' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`gradient-${activeTab}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={activeColor} stopOpacity={0.2} />
                                <stop offset="95%" stopColor={activeColor} stopOpacity={0}   />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis
                            dataKey="date"
                            tick={{ fill: "#6b7280", fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tick={{ fill: "#6b7280", fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            domain={["auto", "auto"]}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={activeColor}
                            strokeWidth={2}
                            fill={`url(#gradient-${activeTab})`}
                            dot={false}
                            activeDot={{ r: 4, fill: activeColor, strokeWidth: 0 }}
                            connectNulls
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
