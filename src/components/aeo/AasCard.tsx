"use client";

import React, { useState, useEffect } from "react";
import { Bot, Sparkles, Loader2, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface AasData {
    latest: {
        score: number;
        gemini: number;
        openai: number;
        anthropic: number;
        capturedAt: string | null;
    };
    trend: Array<{
        date: string;
        score: number;
        gemini: number;
        openai: number;
        anthropic: number;
    }>;
}

interface Props {
    siteId: string;
}

const W = 360;
const H = 70;
const PAD = 6;

export function AasCard({ siteId }: Props) {
    const [data, setData] = useState<AasData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showInfo, setShowInfo] = useState(false);

    useEffect(() => {
        if (!siteId) return;
        setLoading(true);
        setError(null);
        fetch(`/api/aas/${siteId}`)
            .then(res => {
                if (!res.ok) throw new Error("AAS data not available yet.");
                return res.json();
            })
            .then(resData => {
                setData(resData);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [siteId]);

    if (loading) {
        return (
            <div className="card-surface p-6 flex flex-col justify-center items-center h-[200px] border border-border bg-card/50 rounded-2xl">
                <Loader2 className="w-6 h-6 animate-spin text-brand mb-2" />
                <span className="text-xs text-muted-foreground">Calculating AI Authority Score...</span>
            </div>
        );
    }

    if (error || !data || !data.latest.capturedAt) {
        return (
            <div className="card-surface p-6 flex flex-col justify-center items-center h-[200px] border border-border/60 bg-[#0d1117] rounded-2xl">
                <Bot className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs font-semibold text-muted-foreground">AI Authority Score (AAS) Pending</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[240px] text-center">
                    AAS will be calculated automatically once your first site scan is finished.
                </p>
            </div>
        );
    }

    const { score, gemini, openai, anthropic, capturedAt } = data.latest;
    const trend = data.trend || [];

    // Calculate delta if trend exists
    const hasTrend = trend.length >= 2;
    const delta = hasTrend ? score - trend[0].score : 0;

    // Map points to SVG coordinate space
    const toPlotPoints = () => {
        if (trend.length === 0) return [];
        const values = trend.map(t => t.score);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        return trend.map((t, i) => ({
            x: PAD + (i / Math.max(trend.length - 1, 1)) * (W - 2 * PAD),
            y: (H - PAD) - ((t.score - min) / range) * (H - 2 * PAD),
        }));
    };

    const points = toPlotPoints();
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaD = points.length > 0 ? [
        ...points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
        `L ${points[points.length - 1].x.toFixed(1)} ${H - PAD}`,
        `L ${points[0].x.toFixed(1)} ${H - PAD}`,
        "Z"
    ].join(" ") : "";

    return (
        <div className="card-surface p-6 border border-[#30363d] bg-[#0d1117] hover:border-[#484f58] rounded-2xl flex flex-col gap-5 transition-all duration-200">
            {/* Header info */}
            <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                        <span className="p-1 rounded bg-brand/10 text-brand shrink-0">
                            <Sparkles className="w-3.5 h-3.5" />
                        </span>
                        <h3 className="text-sm font-bold text-foreground">AI Authority Score (AAS)</h3>
                        <button
                            onClick={() => setShowInfo(!showInfo)}
                            className="text-muted-foreground/60 hover:text-foreground p-0.5 transition-colors"
                            title="AAS calculation details"
                        >
                            <Info className="w-3 h-3" />
                        </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        Proprietary brand visibility across major AI Search Platforms.
                    </p>
                </div>

                {hasTrend && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        delta > 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                        delta < 0 ? "bg-rose-500/10 text-rose-400 border-rose-500/25" :
                        "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"
                    }`}>
                        {delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : delta < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
                        {delta > 0 ? `+${delta}` : delta}
                    </span>
                )}
            </div>

            {/* Info Overlay */}
            {showInfo && (
                <div className="p-3 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-xl leading-relaxed animate-in fade-in slide-in-from-top-1">
                    AI Authority Score is a proprietary model evaluating your search footprint in AI query citations.
                    It computes a weighted average: <strong className="text-foreground">Gemini (40%)</strong>, <strong className="text-foreground">OpenAI (40%)</strong>, and <strong className="text-foreground">Anthropic/Claude (20%)</strong>.
                </div>
            )}

            <div className="flex flex-col md:flex-row gap-6 items-center">
                {/* Score Circle Gauge */}
                <div className="flex items-center gap-4 shrink-0">
                    <div className="relative w-20 h-20 flex items-center justify-center">
                        <svg className="-rotate-90 w-20 h-20" viewBox="0 0 80 80">
                            <circle
                                cx="40" cy="40" r="32"
                                fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"
                            />
                            <circle
                                cx="40" cy="40" r="32"
                                fill="none" stroke="#10b981" strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray={`${Math.min(score / 100, 1) * 201} 201`}
                                className="transition-all duration-1000 ease-out"
                            />
                        </svg>
                        <div className="absolute flex flex-col items-center justify-center">
                            <span className="text-xl font-black text-foreground tabular-nums leading-none">
                                {score}
                            </span>
                            <span className="text-[8px] text-muted-foreground uppercase tracking-widest mt-0.5">
                                AAS
                            </span>
                        </div>
                    </div>
                </div>

                {/* Weighted breakdowns */}
                <div className="flex-1 w-full flex flex-col gap-3">
                    {/* Gemini */}
                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                Google Gemini <span className="text-[9px] text-muted-foreground/50">(40%)</span>
                            </span>
                            <span className="font-bold text-foreground">{gemini}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${gemini}%` }} />
                        </div>
                    </div>

                    {/* OpenAI */}
                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                OpenAI ChatGPT <span className="text-[9px] text-muted-foreground/50">(40%)</span>
                            </span>
                            <span className="font-bold text-foreground">{openai}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${openai}%` }} />
                        </div>
                    </div>

                    {/* Anthropic */}
                    <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                Anthropic Claude <span className="text-[9px] text-muted-foreground/50">(20%)</span>
                            </span>
                            <span className="font-bold text-foreground">{anthropic}%</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${anthropic}%` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Sparkline trend representation if data has trend points */}
            {hasTrend && points.length > 0 && (
                <div className="border-t border-[#21262d] pt-4 flex flex-col gap-2">
                    <span className="text-[10px] text-muted-foreground font-semibold">AI Authority Trend (30 days)</span>
                    <div className="h-[70px] relative overflow-hidden bg-muted/10 border border-border/40 rounded-xl p-2">
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
                            <path d={areaD} fill="url(#grad-aas)" />
                            <linearGradient id="grad-aas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                            </linearGradient>
                            <path d={pathD} fill="none" stroke="#10b981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                            {points.map((p, i) => (
                                <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#10b981" opacity={i === points.length - 1 ? 1 : 0.3} />
                            ))}
                        </svg>
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground/40 font-mono">
                        <span>{new Date(trend[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        <span>{new Date(capturedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
