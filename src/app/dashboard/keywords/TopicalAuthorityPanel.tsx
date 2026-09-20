"use client";

import { useState, useEffect } from "react";
import { getTopicalAuthorityMatrix } from "@/app/actions/topicalMatrixAction";
import type { TopicalAuthorityReport } from "@/lib/blog/topical-matrix";
import { ClusterCard } from "./ClusterCard";
import { AlertTriangle, Globe, Loader2, BookOpen, ArrowRight } from "lucide-react";

interface Props {
    siteId: string;
}

// Correct SVG arc circumference: 2π × r = 2π × 15.9 ≈ 99.9
const DIAL_R = 15.9;
const CIRC = 2 * Math.PI * DIAL_R; // ≈ 99.9

function ScoreDial({ score }: { score: number }) {
    const color = score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f85149";
    const fill = Math.min(score, 100) / 100 * CIRC;
    const gap = CIRC - fill;
    return (
        <div
            className="rounded-xl px-4 py-3.5 flex items-center gap-4"
            style={{ border: "1px solid #21262d", background: "rgb(13,17,23)" }}
        >
            <svg viewBox="0 0 36 36" width={54} height={54} className="shrink-0" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="18" cy="18" r={DIAL_R} fill="none" stroke="#21262d" strokeWidth="3" />
                <circle
                    cx="18" cy="18" r={DIAL_R}
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${fill.toFixed(2)} ${gap.toFixed(2)}`}
                    style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
                />
            </svg>
            <div>
                <p className="text-[11px] text-[#484f58] leading-tight">Authority score</p>
                <p className="text-[28px] font-black tabular-nums leading-none mt-0.5" style={{ color }}>
                    {score}
                </p>
                <p className="text-[10px] text-[#30363d] mt-0.5">benchmark-relative</p>
            </div>
        </div>
    );
}

function KpiStat({ label, value }: { label: string; value: number }) {
    return (
        <div
            className="rounded-xl px-4 py-3.5"
            style={{ border: "1px solid #21262d", background: "rgb(13,17,23)" }}
        >
            <p className="text-[11px] text-[#484f58] leading-tight">{label}</p>
            <p className="text-[28px] font-black tabular-nums leading-none text-[#e6edf3] mt-0.5">{value}</p>
        </div>
    );
}

export function TopicalAuthorityPanel({ siteId }: Props) {
    const [data, setData] = useState<TopicalAuthorityReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        getTopicalAuthorityMatrix(siteId)
            .then(res => {
                if (!res || typeof res !== "object" || !("success" in res)) {
                    setError("Unexpected response from server.");
                    return;
                }
                if (!res.success) {
                    setError((res as { error?: string }).error ?? "Failed to load authority data.");
                    return;
                }
                setData((res as { success: true; data: TopicalAuthorityReport }).data);
            })
            .catch(() => setError("Failed to load authority data."))
            .finally(() => setLoading(false));
    }, [siteId]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
                <div className="relative">
                    <div className="h-10 w-10 rounded-full border-2 border-[#21262d]" />
                    <Loader2 className="absolute inset-0 h-10 w-10 animate-spin text-emerald-400 opacity-60" />
                </div>
                <p className="text-sm text-[#484f58]">Building topical authority map…</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
            </div>
        );
    }

    if (!data || data.clusters.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                <div className="rounded-full border border-[#21262d] bg-[#0d1117] p-5">
                    <Globe className="h-8 w-8 text-[#30363d]" />
                </div>
                <div>
                    <p className="text-sm font-semibold text-[#8b949e]">No published content clusters</p>
                    <p className="text-xs text-[#484f58] mt-1 max-w-xs">
                        Publish at least one blog to see your topical authority map.
                    </p>
                </div>
            </div>
        );
    }

    const topGap = data.topRecommendedMissingSpoke;
    const totalOrphans = data.clusters.reduce(
        (n, c) => n + c.spokeNodes.filter(s => s.inboundClusterMentionCount === 0).length,
        0
    );

    return (
        <div className="space-y-5">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ScoreDial score={data.overallAuthorityScore} />
                <KpiStat label="Topic clusters" value={data.totalClustersCount} />
                <KpiStat label="Pillar pages" value={data.publishedPillarsCount} />
                <KpiStat label="Spoke pages" value={data.publishedSpokesCount} />
            </div>

            {/* Orphan alert — only if present */}
            {totalOrphans > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-300/80">
                        <span className="font-semibold text-amber-400">{totalOrphans} orphan spoke{totalOrphans !== 1 ? "s" : ""}</span>
                        {" "}detected across {data.clusters.length} cluster{data.clusters.length !== 1 ? "s" : ""} — no inbound mentions found in cluster content.
                    </p>
                </div>
            )}

            {/* Top recommendation */}
            {topGap && (
                <div
                    className="rounded-xl px-5 py-4"
                    style={{
                        border: "1px solid rgba(52,211,153,0.2)",
                        background: "linear-gradient(135deg, rgba(52,211,153,0.05) 0%, rgba(13,17,23,0) 60%)",
                    }}
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                                Recommended next coverage
                            </p>
                            <p className="text-sm font-semibold text-[#e6edf3]">{topGap.suggestedTitle}</p>
                            <p className="text-[11px] text-[#484f58]">
                                Cluster: <span className="text-[#8b949e]">{topGap.topicClusterKey}</span>
                                <span className="mx-1.5 text-[#30363d]">·</span>
                                Keyword: <span className="font-mono text-[#8b949e]">{topGap.suggestedKeyword}</span>
                                {!topGap.hasGscEvidence && (
                                    <span className="ml-1.5 text-[#30363d]">· heuristic, no GSC signal</span>
                                )}
                            </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-emerald-600 shrink-0 mt-1" />
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#484f58] border-t border-[#161b22] pt-4">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: "#34d399" }} />
                    Detected internal mention
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-5 border-t border-dashed border-[#64748b]" />
                    Undetected (opportunity)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                    Orphan spoke
                </span>
                <span className="ml-auto text-[#30363d]">
                    Coverage = spokes vs 4-spoke benchmark
                </span>
            </div>

            {/* Clusters */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 pb-1">
                    <BookOpen className="h-3.5 w-3.5 text-[#484f58]" />
                    <h2 className="text-[12px] font-semibold text-[#8b949e]">
                        Clusters
                        <span className="text-[#30363d] font-normal ml-1">({data.clusters.length})</span>
                    </h2>
                </div>
                {data.clusters.map(cluster => (
                    <ClusterCard key={cluster.clusterKey} cluster={cluster} siteId={siteId} />
                ))}
            </div>
        </div>
    );
}
