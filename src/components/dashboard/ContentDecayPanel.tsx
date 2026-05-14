"use client";

import React, { useEffect, useState } from "react";

interface DecayItem {
    category: string;
    currentScore: number;
    previousScore: number;
    drop: number;
    urgency: "critical" | "high" | "medium" | "low";
    detectedAt: string;
    recommendation: string;
}

interface DecayResponse {
    decayItems: DecayItem[];
    auditCount?: number;
    latestAuditAt?: string;
    site?: string;
    message?: string;
}

const URGENCY_CONFIG = {
    critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Critical", emoji: "🔴" },
    high:     { color: "#f97316", bg: "rgba(249,115,22,0.12)", label: "High",     emoji: "🟠" },
    medium:   { color: "#eab308", bg: "rgba(234,179,8,0.12)",  label: "Medium",   emoji: "🟡" },
    low:      { color: "#22c55e", bg: "rgba(34,197,94,0.12)",  label: "Low",      emoji: "🟢" },
};

function ScoreBar({ score, prev }: { score: number; prev: number }) {
    const isDecay = score < prev;
    const color = isDecay ? "#ef4444" : "#22c55e";
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
            <div style={{
                flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)",
                overflow: "hidden", position: "relative"
            }}>
                <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${score}%`, background: color, borderRadius: 3,
                    transition: "width 0.6s ease",
                }} />
            </div>
            <span style={{ color, fontWeight: 700, fontSize: 13, minWidth: 26 }}>{score}</span>
            <span style={{ color: "#6b7280", fontSize: 11 }}>
                {isDecay ? `▼ ${prev - score}` : `▲ ${score - prev}`}
            </span>
        </div>
    );
}

export function ContentDecayPanel({ siteId }: { siteId: string }) {
    const [data, setData] = useState<DecayResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        fetch(`/api/content-score/decay?siteId=${siteId}`)
            .then(r => r.json())
            .then(d => { setData(d); setLoading(false); })
            .catch(() => { setError("Failed to load decay data"); setLoading(false); });
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
                Loading decay analysis…
            </div>
        </div>
    );

    if (error) return (
        <div style={containerStyle}>
            <div style={{ color: "#ef4444", textAlign: "center", padding: 40 }}>{error}</div>
        </div>
    );

    const items = data?.decayItems ?? [];

    return (
        <div style={containerStyle}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f9fafb" }}>
                        📉 Content Decay
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
                        {items.length > 0
                            ? `${items.length} categor${items.length === 1 ? "y" : "ies"} declining — based on ${data?.auditCount ?? 0} audits`
                            : "No significant score drops detected"}
                    </p>
                </div>
                {data?.latestAuditAt && (
                    <span style={{
                        fontSize: 11, color: "#6b7280", background: "rgba(255,255,255,0.06)",
                        padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)"
                    }}>
                        Last audit: {new Date(data.latestAuditAt).toLocaleDateString()}
                    </span>
                )}
            </div>

            {items.length === 0 ? (
                <div style={{
                    textAlign: "center", padding: "40px 20px",
                    background: "rgba(34,197,94,0.06)", borderRadius: 12,
                    border: "1px solid rgba(34,197,94,0.2)"
                }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                    <div style={{ color: "#22c55e", fontWeight: 600 }}>All categories stable</div>
                    <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
                        {data?.message || "No score drops ≥ 5 points detected in recent audits."}
                    </div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {items.map((item) => {
                        const cfg = URGENCY_CONFIG[item.urgency];
                        return (
                            <div key={item.category} style={{
                                background: cfg.bg,
                                border: `1px solid ${cfg.color}33`,
                                borderLeft: `4px solid ${cfg.color}`,
                                borderRadius: 10,
                                padding: "14px 16px",
                            }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                                    {/* Urgency badge */}
                                    <span style={{
                                        background: cfg.bg, color: cfg.color,
                                        border: `1px solid ${cfg.color}55`, borderRadius: 20,
                                        padding: "2px 10px", fontSize: 11, fontWeight: 700,
                                        whiteSpace: "nowrap", flexShrink: 0,
                                    }}>
                                        {cfg.emoji} {cfg.label}
                                    </span>

                                    {/* Category name */}
                                    <span style={{ fontWeight: 600, fontSize: 14, color: "#f3f4f6", flex: 1 }}>
                                        {item.category}
                                    </span>

                                    {/* Score bar */}
                                    <ScoreBar score={item.currentScore} prev={item.previousScore} />
                                </div>

                                {/* Recommendation */}
                                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>
                                    💡 {item.recommendation}
                                </p>

                                {/* Re-optimise action */}
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                                    {/* When detected */}
                                    <span style={{ fontSize: 11, color: "#6b7280" }}>
                                        Detected: {new Date(item.detectedAt).toLocaleDateString()}
                                    </span>
                                    <button
                                        onClick={() => {
                                            const prompt = encodeURIComponent(
                                                `Refresh and improve the "${item.category}" aspects of my website. ` +
                                                `The ${item.category} score dropped ${item.drop} points (from ${item.previousScore} to ${item.currentScore}). ` +
                                                `Recommendation: ${item.recommendation}. ` +
                                                `Generate content that specifically addresses this gap and recovers the lost performance.`
                                            );
                                            window.location.href = `/dashboard/blog/new?prompt=${prompt}&keyword=${encodeURIComponent(item.category)}`;
                                        }}
                                        style={{
                                            flexShrink: 0,
                                            fontSize: 12,
                                            fontWeight: 600,
                                            padding: "5px 14px",
                                            borderRadius: 8,
                                            background: "rgba(16,185,129,0.12)",
                                            color: "#34d399",
                                            border: "1px solid rgba(16,185,129,0.25)",
                                            cursor: "pointer",
                                            transition: "background 0.15s",
                                        }}
                                        onMouseOver={(e) => (e.currentTarget.style.background = "rgba(16,185,129,0.22)")}
                                        onMouseOut={(e) => (e.currentTarget.style.background = "rgba(16,185,129,0.12)")}
                                    >
                                        Re-optimise →
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
