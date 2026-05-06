"use client";

import React, { useEffect, useState } from "react";

interface _SovRecord {
    keyword: string;
    modelName: string;
    brandMentioned: boolean;
    recordedAt: string;
}

interface ModelStat {
    model: string;
    mentionRate: number; // 0–100
    total: number;
    mentions: number;
}

interface TrendPoint {
    date: string;
    rate: number;
}

const MODEL_COLORS: Record<string, string> = {
    "gemini-2.5-flash":   "#6366f1",
    "gemini-2.0-flash":   "#8b5cf6",
    "gpt-4o":             "#22d3ee",
    "claude-3-5-sonnet":  "#f59e0b",
    "sonar":              "#34d399",
    default:              "#94a3b8",
};

function getColor(model: string) {
    return MODEL_COLORS[model] ?? MODEL_COLORS.default;
}

function MentionBar({ stat }: { stat: ModelStat }) {
    const color = getColor(stat.model);
    const label = stat.model.replace(/gemini-|preview-\d+-\d+/g, "").replace(/-/g, " ").trim() || stat.model;
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#d1d5db", fontWeight: 500, textTransform: "capitalize" }}>
                    {label}
                </span>
                <span style={{ fontWeight: 700, color, fontSize: 14 }}>
                    {stat.mentionRate}%
                    <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                        ({stat.mentions}/{stat.total})
                    </span>
                </span>
            </div>
            <div style={{
                height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden"
            }}>
                <div style={{
                    height: "100%", borderRadius: 4, width: `${stat.mentionRate}%`,
                    background: `linear-gradient(90deg, ${color}99, ${color})`,
                    transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                }} />
            </div>
        </div>
    );
}

function SparkLine({ points, color }: { points: TrendPoint[]; color: string }) {
    if (points.length < 2) return null;
    const w = 120, h = 36;
    const rates = points.map(p => p.rate);
    const max = Math.max(...rates, 1);
    const xs = points.map((_, i) => (i / (points.length - 1)) * w);
    const ys = rates.map(r => h - (r / max) * (h - 4) - 2);
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={color} />
        </svg>
    );
}

export function GenerativeSOVPanel({ siteId }: { siteId: string }) {
    const [stats, setStats] = useState<ModelStat[]>([]);
    const [trend, setTrend] = useState<TrendPoint[]>([]);
    const [overall, setOverall] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        fetch(`/api/aeo/sov?siteId=${siteId}`)
            .then(r => r.json())
            .then(d => {
                setStats(d.byModel ?? []);
                setTrend(d.trend ?? []);
                setOverall(d.overallRate ?? 0);
                setLoading(false);
            })
            .catch(() => { setError("Failed to load data"); setLoading(false); });
    }, [siteId]);

    const containerStyle: React.CSSProperties = {
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        padding: 24,
        fontFamily: "'Inter', sans-serif",
        color: "#e5e7eb",
    };

    if (loading) return (
        <div style={containerStyle}>
            <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>
                Analysing generative share of voice…
            </div>
        </div>
    );

    if (error) return (
        <div style={containerStyle}>
            <div style={{ color: "#ef4444", textAlign: "center", padding: 40 }}>{error}</div>
        </div>
    );

    const scoreColor = overall >= 60 ? "#22c55e" : overall >= 30 ? "#f59e0b" : "#ef4444";

    return (
        <div style={containerStyle}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f9fafb" }}>
                        🤖 Generative Share of Voice
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
                        Brand mention rate across AI search engines
                    </p>
                </div>
                {/* Overall score circle */}
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: "50%",
                        border: `3px solid ${scoreColor}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexDirection: "column",
                    }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{overall}</span>
                        <span style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.05em" }}>% SOV</span>
                    </div>
                </div>
            </div>

            {stats.length === 0 ? (
                <div style={{
                    textAlign: "center", padding: "40px 20px",
                    background: "rgba(99,102,241,0.06)", borderRadius: 12,
                    border: "1px solid rgba(99,102,241,0.2)"
                }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
                    <div style={{ color: "#818cf8", fontWeight: 600 }}>No AEO data yet</div>
                    <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
                        Run an AEO scan to start tracking AI brand mentions.
                    </div>
                </div>
            ) : (
                <>
                    {/* Per-model bars */}
                    <div style={{ marginBottom: 24 }}>
                        {stats.map(stat => <MentionBar key={stat.model} stat={stat} />)}
                    </div>

                    {/* Trend sparklines */}
                    {trend.length >= 2 && (
                        <div style={{
                            borderTop: "1px solid rgba(255,255,255,0.08)",
                            paddingTop: 16,
                            display: "flex", alignItems: "center", gap: 16
                        }}>
                            <div>
                                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>30-day trend</div>
                                <SparkLine points={trend} color={scoreColor} />
                            </div>
                            <div style={{ fontSize: 12, color: "#9ca3af" }}>
                                {trend.length} data points
                                <br />
                                <span style={{
                                    color: trend[trend.length - 1].rate > trend[0].rate ? "#22c55e" : "#ef4444",
                                    fontWeight: 600
                                }}>
                                    {trend[trend.length - 1].rate > trend[0].rate ? "▲" : "▼"}
                                    {" "}
                                    {Math.abs(trend[trend.length - 1].rate - trend[0].rate).toFixed(0)}%
                                    {" "}vs 30d ago
                                </span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
