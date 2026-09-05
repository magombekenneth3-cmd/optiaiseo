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

const TABS: { key: TabKey; label: string; color: string; unit?: string; metricKey?: MetricKey }[] = [
    { key: "overallScore",   label: "SEO Score",       color: "#10b981", metricKey: "overallScore" },
    { key: "aeoScore",       label: "AEO Visibility",  color: "#6366f1", metricKey: "aeoScore" },
    { key: "organicTraffic", label: "Organic Traffic",  color: "#06b6d4", unit: "clicks", metricKey: "organicTraffic" },
    { key: "auditTrend",     label: "Rankings",         color: "#f59e0b" },
];

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

    let chartData: { date: string; value: number | null }[];
    let activeColor: string;
    let activeUnit: string | undefined;
    let first: number | null;
    let last: number | null;
    let headerLabel: string;

    if (isAuditTab && hasAuditData) {
        const rawDates = auditData!.map(d => d.name);
        const dedupedDates = deduplicateDates(rawDates);
        chartData = auditData!.map((d, i) => ({
            date: dedupedDates[i],
            value: d.score,
        }));
        activeColor = TABS.find(t => t.key === "auditTrend")!.color;
        activeUnit = undefined;
        first = auditData![0]?.score ?? null;
        last = auditData![auditData!.length - 1]?.score ?? null;
        headerLabel = "SEO Performance";
    } else {
        const tab = TABS.find(t => t.key === activeTab)!;
        const metricKey = tab.metricKey ?? "overallScore";
        const rawDates = data.map(d => formatDate(d.capturedAt));
        const dedupedDates = deduplicateDates(rawDates);
        chartData = data.map((d, i) => ({
            date: dedupedDates[i],
            value: d[metricKey] ?? null,
        }));
        activeColor = tab.color;
        activeUnit = tab.unit;
        first = data[0]?.[metricKey] ?? null;
        last = data[data.length - 1]?.[metricKey] ?? null;
        headerLabel = "SEO Performance";
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

    return (
        <div className={`border border-border rounded-[10px] bg-card p-5 ${className}`}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground">{headerLabel}</h3>
                <div className="flex items-center gap-1.5">
                    {last != null && (
                        <span className="text-lg font-bold tabular-nums" style={{ color: activeColor }}>
                            {last.toFixed(0)}{activeUnit ? " " + activeUnit : ""}
                        </span>
                    )}
                    <TrendBadge current={last} prev={first} />
                </div>
            </div>

            {/* Tab selector — underline style */}
            <div className="flex gap-4 mb-4 border-b border-border">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={`pb-2 text-xs font-medium transition-colors relative ${
                            activeTab === t.key
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                        {activeTab === t.key && (
                            <span
                                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                                style={{ background: t.color }}
                            />
                        )}
                    </button>
                ))}
            </div>

            {/* Chart */}
            <div style={{ height: 'clamp(180px, 35vw, 280px)' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`gradient-${activeTab}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={activeColor} stopOpacity={0.15} />
                                <stop offset="95%" stopColor={activeColor} stopOpacity={0}   />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
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
