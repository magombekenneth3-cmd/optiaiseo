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

type MetricKey = "overallScore" | "aeoScore" | "coreWebVitals" | "schemaScore" | "organicTraffic";

const METRICS: { key: MetricKey; label: string; color: string; unit?: string }[] = [
    { key: "overallScore",   label: "SEO Score",       color: "#10b981" },
    { key: "aeoScore",       label: "AEO Score",       color: "#6366f1" },
    { key: "coreWebVitals",  label: "Core Web Vitals", color: "#f59e0b" },
    { key: "schemaScore",    label: "Schema Score",    color: "#8b5cf6" },
    { key: "organicTraffic", label: "Organic Traffic", color: "#06b6d4", unit: "clicks" },
];

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    className?: string;
}

export function MetricTrendChart({ data, className = "" }: MetricTrendChartProps) {
    const [activeMetric, setActiveMetric] = useState<MetricKey>("overallScore");

    if (data.length === 0) {
        return (
            <div className={`card-elevated p-6 ${className}`}>
                <p className="text-sm text-muted-foreground text-center py-8">
                    No trend data yet — run your first audit to start tracking.
                </p>
            </div>
        );
    }

    const metric = METRICS.find(m => m.key === activeMetric)!;
    const first = data[0]?.[activeMetric] ?? null;
    const last  = data[data.length - 1]?.[activeMetric] ?? null;

    const chartData = data.map(d => ({
        date: formatDate(d.capturedAt),
        value: d[activeMetric] ?? null,
    }));

    const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
        if (!active || !payload?.[0]) return null;
        return (
            <div className="card-elevated px-3 py-2 text-xs">
                <p className="text-muted-foreground mb-0.5">{label}</p>
                <p className="font-semibold text-foreground">
                    {payload[0].value?.toFixed(1)}{metric.unit ? ` ${metric.unit}` : ""}
                </p>
            </div>
        );
    };

    return (
        <div className={`card-elevated p-5 ${className}`}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 min-w-0">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">6-Month Trend</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{data.length} data points</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {last != null && (
                        <span className="text-lg font-bold" style={{ color: metric.color }}>
                            {last.toFixed(0)}{metric.unit ? " " + metric.unit : ""}
                        </span>
                    )}
                    <TrendBadge current={last} prev={first} />
                </div>
            </div>

            {/* Metric selector tabs */}
            <div className="flex gap-1.5 flex-wrap mb-4">
                {METRICS.map(m => (
                    <button
                        key={m.key}
                        onClick={() => setActiveMetric(m.key)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            activeMetric === m.key
                                ? "text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground bg-accent/40 hover:bg-accent"
                        }`}
                        style={activeMetric === m.key ? { background: m.color } : {}}
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
                            <linearGradient id={`gradient-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={metric.color} stopOpacity={0.2} />
                                <stop offset="95%" stopColor={metric.color} stopOpacity={0}   />
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
                            stroke={metric.color}
                            strokeWidth={2}
                            fill={`url(#gradient-${activeMetric})`}
                            dot={false}
                            activeDot={{ r: 4, fill: metric.color, strokeWidth: 0 }}
                            connectNulls
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
