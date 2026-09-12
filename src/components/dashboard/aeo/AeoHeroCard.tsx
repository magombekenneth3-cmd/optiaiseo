"use client";
import React from "react";
import { Zap, Sparkles, Search, Target, Users, Loader2 } from "lucide-react";
import { CreditGate } from "@/components/ui/CreditGate";

// ── Score utilities ───────────────────────────────────────────────────────────

function scoreColor(s: number) {
    return s >= 65 ? "text-emerald-400" : s >= 40 ? "text-amber-400" : "text-rose-400";
}

function scoreGlow(s: number) {
    return s >= 65
        ? "drop-shadow-[0_0_24px_rgba(16,185,129,0.35)]"
        : s >= 40
        ? "drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]"
        : "drop-shadow-[0_0_24px_rgba(239,68,68,0.35)]";
}

const GRADE_STATUS: Record<string, string> = {
    A: "Strong",
    B: "Good",
    C: "Moderate",
    D: "Weak",
    F: "Critical",
};

const GRADE_COLORS: Record<string, string> = {
    A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    F: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ rate, size = 100, strokeWidth = 8 }: { rate: number; size?: number; strokeWidth?: number }) {
    const r = size / 2 - strokeWidth;
    const circ = 2 * Math.PI * r;
    const dash = Math.min(rate / 100, 1) * circ;
    const color = rate >= 65 ? "#10b981" : rate >= 40 ? "#f59e0b" : "#ef4444";
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke={color} strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: "stroke-dasharray 1.4s cubic-bezier(0.4,0,0.2,1)" }}
                />
            </svg>
            <span
                className={`absolute inset-0 flex flex-col items-center justify-center rotate-90 tabular-nums ${scoreColor(rate)}`}
            >
                <span style={{ fontSize: size > 80 ? 26 : 14 }} className="font-black leading-none">{rate}</span>
                <span className="text-[9px] text-muted-foreground/60 font-medium">/100</span>
            </span>
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AeoHeroCardProps {
    domain: string;
    rate: number | null;
    scoreDelta?: number;
    grade: string | null;
    layerScores?: { aeo?: number; geo?: number; aio?: number } | null;
    lastScanAt?: string | null;
    insight?: string | null;
    scanning: boolean;
    deepScanning: boolean;
    isPolling: boolean;
    pollingStatus: "idle" | "polling" | "done" | "timeout";
    onScan: () => void;
    onDeepScan: () => void;
}

function getRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor(diff / 3_600_000);
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins} min ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "yesterday";
    return `${days} days ago`;
}

export function AeoHeroCard({
    domain, rate, scoreDelta = 0, grade, layerScores,
    lastScanAt, insight, scanning, deepScanning, isPolling,
    pollingStatus, onScan, onDeepScan,
}: AeoHeroCardProps) {
    const isActive = scanning || isPolling || deepScanning;
    const statusLabel = GRADE_STATUS[grade ?? ""] ?? null;
    const gradeCls = GRADE_COLORS[grade ?? ""] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10";

    const LAYERS = [
        { key: "aeo" as const, label: "AEO", sublabel: "Cited", icon: Search, color: "text-blue-400", bg: "bg-blue-500/10" },
        { key: "geo" as const, label: "GEO", sublabel: "Recommended", icon: Target, color: "text-purple-400", bg: "bg-purple-500/10" },
        { key: "aio" as const, label: "AIO", sublabel: "Understood", icon: Users, color: "text-amber-400", bg: "bg-amber-500/10" },
    ];

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Top-right: timestamp */}
            {lastScanAt && (
                <div className="px-6 pt-4 text-[10px] text-muted-foreground/50 text-right">
                    Last scan:{" "}
                    {new Date(lastScanAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{" "}
                    · {getRelativeTime(lastScanAt)}
                </div>
            )}

            {/* Main row: ring + score meta + layer scores */}
            <div className="px-6 py-5 flex flex-wrap items-center gap-6">
                {/* Score ring */}
                <div className={`shrink-0 ${rate !== null ? scoreGlow(rate) : ""}`}>
                    {rate !== null ? (
                        <ScoreRing rate={rate} size={108} strokeWidth={9} />
                    ) : (
                        <div className="w-[108px] h-[108px] rounded-full border-[9px] border-border flex items-center justify-center">
                            <span className="text-2xl font-black text-muted-foreground">–</span>
                        </div>
                    )}
                </div>

                {/* Score label */}
                <div className="flex flex-col gap-1.5 min-w-[140px]">
                    <p className="text-sm font-semibold text-muted-foreground">AI Visibility Score</p>
                    {scoreDelta !== 0 && (
                        <div className={`flex items-center gap-1 text-sm font-bold ${scoreDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {scoreDelta > 0 ? "↑" : "↓"} {Math.abs(scoreDelta)}%{" "}
                            <span className="text-[11px] font-normal text-muted-foreground">vs previous scan</span>
                        </div>
                    )}
                    {statusLabel && (
                        <span className={`self-start text-xs font-bold px-2.5 py-1 rounded-lg border ${gradeCls}`}>
                            {statusLabel}
                        </span>
                    )}
                    {rate === null && !isActive && (
                        <span className="text-xs text-muted-foreground italic">Not measured yet</span>
                    )}
                    {isPolling && (
                        <span className="text-xs text-blue-400 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Scanning…
                        </span>
                    )}
                </div>

                {/* Layer score columns */}
                {layerScores && (
                    <div className="flex gap-0 ml-auto border border-border/60 rounded-xl overflow-hidden divide-x divide-border/60">
                        {LAYERS.map(({ key, label, sublabel, icon: Icon, color, bg }) => {
                            const score = layerScores[key];
                            return (
                                <div key={key} className="flex flex-col items-center gap-1 px-6 py-4 bg-muted/10 hover:bg-muted/20 transition-colors">
                                    <div className={`flex items-center gap-1.5 ${color} mb-1`}>
                                        <span className={`w-5 h-5 rounded-md ${bg} flex items-center justify-center`}>
                                            <Icon className="w-3 h-3" />
                                        </span>
                                        <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
                                    </div>
                                    <span
                                        className={`text-2xl font-black tabular-nums leading-none ${
                                            score !== undefined
                                                ? scoreColor(score)
                                                : "text-muted-foreground"
                                        }`}
                                    >
                                        {score !== undefined ? `${score}%` : "–"}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">{sublabel}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Insight banner */}
            {rate !== null && insight && (
                <div className="mx-6 mb-5 flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/6 border border-emerald-500/20">
                    <span className="text-emerald-400 text-base select-none">◉</span>
                    <p className="text-sm text-emerald-300/90 leading-relaxed flex-1 min-w-[200px]">{insight}</p>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={isActive ? undefined : onScan}
                            disabled={isActive}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[.97] text-black text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPolling ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning…</>
                            ) : pollingStatus === "done" ? (
                                "✅ Done"
                            ) : (
                                <><Zap className="w-3.5 h-3.5" /> Run AI Visibility Scan</>
                            )}
                        </button>
                        <CreditGate action="aeo_check">
                            <button
                                onClick={isActive ? undefined : onDeepScan}
                                disabled={isActive}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/70 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Full GSI deep audit — uses more credits"
                            >
                                <Sparkles className="w-3 h-3" /> Deep Audit
                            </button>
                        </CreditGate>
                    </div>
                </div>
            )}

            {/* No-data empty CTA */}
            {rate === null && !isActive && (
                <div className="mx-6 mb-5 flex flex-wrap items-center justify-between gap-4 px-5 py-4 rounded-xl border border-dashed border-border bg-muted/10">
                    <p className="text-sm text-muted-foreground">
                        Run an AI Visibility Scan to see how ChatGPT, Gemini, Perplexity and Claude cite your brand.
                    </p>
                    <button
                        onClick={onScan}
                        disabled={scanning}
                        className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all"
                    >
                        {scanning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</> : <><Zap className="w-3.5 h-3.5" /> Run AI Visibility Scan</>}
                    </button>
                </div>
            )}
        </div>
    );
}
