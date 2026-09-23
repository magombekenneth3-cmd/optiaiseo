"use client";

import { useMemo, useState } from "react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";

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
type TabKey = MetricKey | "auditIssues";

const TABS: { key: TabKey; label: string; color: string; unit?: string; metricKey?: MetricKey; score?: boolean }[] = [
    { key: "overallScore", label: "SEO score", color: "#10b981", metricKey: "overallScore", score: true },
    { key: "aeoScore", label: "AEO visibility", color: "#a78bfa", metricKey: "aeoScore", score: true },
    { key: "organicTraffic", label: "Organic traffic", color: "#06b6d4", unit: "visits", metricKey: "organicTraffic" },
    { key: "auditIssues", label: "Audit issues", color: "#f59e0b", unit: "issues" },
];

function formatDate(iso: string) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function deduplicateDates(dates: string[]): string[] {
    const counts = new Map<string, number>();
    return dates.map((date) => {
        const count = (counts.get(date) ?? 0) + 1;
        counts.set(date, count);
        return count > 1 ? `${date} (${count})` : date;
    });
}

function TrendBadge({ current, previous, lowerIsBetter = false }: { current: number | null; previous: number | null; lowerIsBetter?: boolean }) {
    if (current == null || previous == null) return <span className="text-xs text-muted-foreground">Not enough data to compare</span>;
    const delta = current - previous;
    if (Math.abs(delta) < 0.0001) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" /> No change</span>;
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    const Icon = delta > 0 ? TrendingUp : TrendingDown;
    const percent = previous !== 0 ? Math.round((delta / Math.abs(previous)) * 100) : null;
    return (
        <span className={`inline-flex items-center gap-1 text-xs ${improved ? "text-emerald-400" : "text-rose-400"}`}>
            <Icon className="h-3 w-3" />
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}{percent !== null ? ` (${percent > 0 ? "+" : ""}${percent}%)` : ""}
        </span>
    );
}

interface MetricTrendChartProps {
    data: DataPoint[];
    auditData?: AuditDataPoint[];
    className?: string;
}

export function MetricTrendChart({ data, auditData = [], className = "" }: MetricTrendChartProps) {
    const availableTabs = useMemo(() => TABS.filter((tab) => tab.key === "auditIssues"
        ? auditData.some((point) => point.issues != null)
        : data.some((point) => point[tab.metricKey!] != null)), [data, auditData]);
    const [activeTab, setActiveTab] = useState<TabKey>("overallScore");
    const resolvedTab = availableTabs.some((tab) => tab.key === activeTab) ? activeTab : availableTabs[0]?.key;

    if (availableTabs.length === 0) {
        return (
            <div className={`rounded-2xl border border-border bg-card p-5 sm:p-6 ${className}`}>
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"><BarChart3 className="h-5 w-5 text-muted-foreground" /></div>
                    <div>
                        <p className="text-sm font-semibold text-foreground">No performance trends yet</p>
                        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Complete an audit or collect metric data to start building your performance history.</p>
                    </div>
                </div>
            </div>
        );
    }

    const activeMetric = availableTabs.find((tab) => tab.key === resolvedTab)!;
    const isAuditIssues = resolvedTab === "auditIssues";
    const rawPoints = isAuditIssues
        ? auditData.filter((point) => point.issues != null).map((point) => ({ date: point.name, value: point.issues! }))
        : data.filter((point) => point[activeMetric.metricKey!] != null).map((point) => ({ date: formatDate(point.capturedAt), value: point[activeMetric.metricKey!]! }));
    const dates = deduplicateDates(rawPoints.map((point) => point.date));
    const chartData = rawPoints.map((point, index) => ({ ...point, date: dates[index] }));
    const first = chartData[0]?.value ?? null;
    const last = chartData[chartData.length - 1]?.value ?? null;
    const valueFormat = (value: number) => activeMetric.score ? `${Math.round(value)}/100` : `${value.toLocaleString()}${activeMetric.unit ? ` ${activeMetric.unit}` : ""}`;
    const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
        if (!active || !payload?.[0]) return null;
        return (
            <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs shadow-xl">
                <p className="mb-0.5 text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold text-foreground">{valueFormat(payload[0].value)}</p>
            </div>
        );
    };

    return (
        <section aria-label="Performance trends" className={`min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5 ${className}`}>
            <div className="mb-4 flex min-w-0 flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                    <h2 className="text-sm font-semibold text-foreground">Performance trends</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Compare recorded values across available snapshots.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {last != null && <span className="text-lg font-bold tabular-nums" style={{ color: activeMetric.color }}>{valueFormat(last)}</span>}
                    <TrendBadge current={last} previous={first} lowerIsBetter={isAuditIssues} />
                </div>
            </div>

            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Performance metric">
                {availableTabs.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={`metric-tab-${tab.key}`}
                        aria-selected={resolvedTab === tab.key}
                        aria-controls="metric-trend-panel"
                        onClick={() => setActiveTab(tab.key)}
                        className={`relative shrink-0 px-2.5 pb-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${resolvedTab === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        {tab.label}
                        {resolvedTab === tab.key && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full" style={{ background: tab.color }} />}
                    </button>
                ))}
            </div>

            <div id="metric-trend-panel" role="tabpanel" aria-labelledby={`metric-tab-${resolvedTab}`}>
                {chartData.length < 2 ? (
                    <div className="flex min-h-44 items-center justify-center rounded-lg bg-muted/20 px-4 text-center">
                        <p className="max-w-sm text-xs leading-5 text-muted-foreground">One data point is available. Add another snapshot to see a trend.</p>
                    </div>
                ) : (
                    <div className="h-[220px] min-w-0 sm:h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                                <defs>
                                    <linearGradient id={`metric-gradient-${resolvedTab}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.18} />
                                        <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                                <XAxis dataKey="date" tick={{ fill: "#9296a3", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
                                <YAxis tick={{ fill: "#9296a3", fontSize: 11 }} axisLine={false} tickLine={false} domain={activeMetric.score ? [0, 100] : [0, "auto"]} allowDecimals={!activeMetric.score && !isAuditIssues} width={42} />
                                <Tooltip content={<CustomTooltip />} />
                                <Area type="monotone" dataKey="value" stroke={activeMetric.color} strokeWidth={2} fill={`url(#metric-gradient-${resolvedTab})`} dot={chartData.length <= 8 ? { r: 2, fill: activeMetric.color, strokeWidth: 0 } : false} activeDot={{ r: 4, fill: activeMetric.color, strokeWidth: 0 }} connectNulls={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </section>
    );
}
