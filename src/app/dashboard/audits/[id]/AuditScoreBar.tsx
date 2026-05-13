"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";

interface Props {
    overallScore: number;
    issues: NormalisedIssue[];
    categoryCount: number;
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
}

function scoreHex(s: number) {
    if (s >= 80) return "#2ea043";
    if (s >= 60) return "#d29922";
    if (s >= 40) return "#e08429";
    return "#f85149";
}

function scoreGrade(s: number) {
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 40) return "D";
    return "F";
}

function vitalInfo(metric: "lcp" | "cls" | "inp", value: number) {
    if (metric === "lcp") {
        const label = `${value.toFixed(1)}s`;
        if (value <= 2.5) return { label, color: "#2ea043", status: "Good" };
        if (value <= 4.0) return { label, color: "#d29922", status: "Needs work" };
        return { label, color: "#f85149", status: "Poor" };
    }
    if (metric === "cls") {
        const label = value.toFixed(3);
        if (value <= 0.1) return { label, color: "#2ea043", status: "Good" };
        if (value <= 0.25) return { label, color: "#d29922", status: "Needs work" };
        return { label, color: "#f85149", status: "Poor" };
    }
    const label = `${Math.round(value)}ms`;
    if (value <= 200) return { label, color: "#2ea043", status: "Good" };
    if (value <= 500) return { label, color: "#d29922", status: "Needs work" };
    return { label, color: "#f85149", status: "Poor" };
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; color: string }[]; label?: string }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 shadow-xl">
                <p className="text-[11px] font-semibold text-[#e6edf3]">{label}</p>
                <p className="text-[13px] font-bold" style={{ color: payload[0].color }}>{payload[0].value} issues</p>
            </div>
        );
    }
    return null;
};

export function AuditScoreBar({ overallScore, issues, categoryCount, lcp, cls, inp }: Props) {
    const criticals = issues.filter((i) => i.severity === "critical").length;
    const highs = issues.filter((i) => i.severity === "high").length;
    const mediums = issues.filter((i) => i.severity === "medium").length;
    const lows = issues.filter((i) => i.severity === "low").length;
    const total = issues.length;

    const hex = scoreHex(overallScore);
    const grade = scoreGrade(overallScore);

    const R = 48;
    const CIRC = 2 * Math.PI * R;
    const dashOffset = CIRC - (overallScore / 100) * CIRC;

    const barData = [
        { label: "Critical", count: criticals, color: "#f85149" },
        { label: "High", count: highs, color: "#d29922" },
        { label: "Medium", count: mediums, color: "#388bfd" },
        { label: "Low", count: lows, color: "#6e7681" },
    ];

    const hasVitals = lcp != null || cls != null || inp != null;

    return (
        <div className="mb-6 rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden shadow-xl shadow-black/20">
            {/* Top label bar */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[#21262d]">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.1em]">
                    Site Health Overview
                </span>
                <div className="flex-1 h-px bg-[#21262d]" />
                <span className="text-[11px] text-[#6e7681]">{total} total issues across {categoryCount} categories</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-0 divide-y lg:divide-y-0 lg:divide-x divide-[#21262d]">

                {/* ── Left: Score Gauge ── */}
                <div className="flex flex-col items-center justify-center px-8 py-7 gap-3">
                    <div className="relative w-[116px] h-[116px]">
                        {/* Background track */}
                        <svg width="116" height="116" viewBox="0 0 116 116" className="-rotate-90">
                            <circle cx="58" cy="58" r={R} fill="none" stroke="#21262d" strokeWidth="8" />
                            <circle
                                cx="58" cy="58" r={R} fill="none"
                                stroke={hex} strokeWidth="8" strokeLinecap="round"
                                strokeDasharray={CIRC}
                                strokeDashoffset={dashOffset}
                                style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)" }}
                            />
                        </svg>
                        {/* Glow ring */}
                        <div
                            className="absolute inset-0 rounded-full"
                            style={{ boxShadow: `0 0 28px ${hex}30, inset 0 0 12px ${hex}10` }}
                        />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-[32px] font-black leading-none tabular-nums" style={{ color: hex }}>
                                {overallScore}
                            </span>
                            <span className="text-[11px] text-[#6e7681] font-semibold mt-0.5 uppercase tracking-wider">/100</span>
                        </div>
                    </div>
                    <div className="text-center">
                        <div
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-bold"
                            style={{ color: hex, borderColor: `${hex}40`, background: `${hex}12` }}
                        >
                            Grade {grade}
                        </div>
                        <p className="text-[11px] text-[#6e7681] mt-1.5">Health score</p>
                    </div>
                </div>

                {/* ── Centre: Severity Bar Chart ── */}
                <div className="px-6 py-6 flex flex-col">
                    <p className="text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] mb-4">
                        Issues by severity
                    </p>
                    <div className="flex-1 min-h-[120px]">
                        <ResponsiveContainer width="100%" height={140}>
                            <BarChart
                                data={barData}
                                layout="vertical"
                                margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
                                barCategoryGap="28%"
                            >
                                <XAxis type="number" hide domain={[0, "dataMax + 2"]} />
                                <YAxis
                                    type="category"
                                    dataKey="label"
                                    width={58}
                                    tick={{ fontSize: 12, fill: "#6e7681", fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: "#ffffff06" }} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} minPointSize={2}>
                                    {barData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend counts */}
                    <div className="flex items-center gap-4 mt-2">
                        {barData.map((b) => (
                            <div key={b.label} className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />
                                <span className="text-[11px] font-semibold" style={{ color: b.color }}>{b.count}</span>
                                <span className="text-[11px] text-[#6e7681]">{b.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Right: Metric Tiles ── */}
                <div className="flex flex-row lg:flex-col justify-around lg:justify-center divide-x lg:divide-x-0 lg:divide-y divide-[#21262d]">
                    <div className="flex-1 flex flex-col items-center justify-center px-6 py-5 gap-1">
                        <span className="text-[28px] font-black tabular-nums text-[#e6edf3] leading-none">{total}</span>
                        <span className="text-[11px] text-[#6e7681] font-medium">Total Issues</span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center px-6 py-5 gap-1">
                        <span className="text-[28px] font-black tabular-nums text-[#388bfd] leading-none">{categoryCount}</span>
                        <span className="text-[11px] text-[#6e7681] font-medium">Categories</span>
                    </div>
                    {hasVitals && (
                        <div className="flex-1 flex flex-col items-center justify-center px-5 py-4 gap-2.5">
                            <span className="text-[10px] font-bold text-[#6e7681] uppercase tracking-[0.1em]">Core Web Vitals</span>
                            <div className="flex flex-col gap-1.5 w-full">
                                {lcp != null && (() => {
                                    const v = vitalInfo("lcp", lcp);
                                    return (
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-[10px] font-bold text-[#6e7681] uppercase w-8">LCP</span>
                                            <span className="text-[12px] font-bold tabular-nums font-mono" style={{ color: v.color }}>{v.label}</span>
                                            <span className="text-[10px] text-[#6e7681] flex-1 text-right">{v.status}</span>
                                        </div>
                                    );
                                })()}
                                {cls != null && (() => {
                                    const v = vitalInfo("cls", cls);
                                    return (
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-[10px] font-bold text-[#6e7681] uppercase w-8">CLS</span>
                                            <span className="text-[12px] font-bold tabular-nums font-mono" style={{ color: v.color }}>{v.label}</span>
                                            <span className="text-[10px] text-[#6e7681] flex-1 text-right">{v.status}</span>
                                        </div>
                                    );
                                })()}
                                {inp != null && (() => {
                                    const v = vitalInfo("inp", inp);
                                    return (
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-[10px] font-bold text-[#6e7681] uppercase w-8">INP</span>
                                            <span className="text-[12px] font-bold tabular-nums font-mono" style={{ color: v.color }}>{v.label}</span>
                                            <span className="text-[10px] text-[#6e7681] flex-1 text-right">{v.status}</span>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
