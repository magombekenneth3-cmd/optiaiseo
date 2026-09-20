"use client";

import { useState, useEffect } from "react";
import { getTopicalAuthorityMatrix } from "@/app/actions/topicalMatrixAction";
import type { TopicalAuthorityReport } from "@/lib/blog/topical-matrix";
import { ClusterCard } from "./ClusterCard";
import { AlertTriangle, Globe, Loader2, BookOpen, Link2 } from "lucide-react";

interface Props {
    siteId: string;
}

function KpiStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="rounded-xl border border-[#21262d] bg-[#0d1117] px-4 py-3.5">
            <p className="text-[11px] font-medium text-[#8b949e] mb-1">{label}</p>
            <p className="text-[26px] font-black tabular-nums leading-none text-[#e6edf3]">{value}</p>
            {sub && <p className="text-[11px] text-[#8b949e] mt-1">{sub}</p>}
        </div>
    );
}

function ScoreDial({ score }: { score: number }) {
    const color = score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f85149";
    return (
        <div className="rounded-xl border border-[#21262d] bg-[#0d1117] px-4 py-3.5 flex items-center gap-4">
            <svg viewBox="0 0 36 36" width={52} height={52} className="shrink-0 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#21262d" strokeWidth="3.5" />
                <circle
                    cx="18" cy="18" r="15.9"
                    fill="none"
                    stroke={color}
                    strokeWidth="3.5"
                    strokeDasharray={`${score} ${100 - score}`}
                    strokeLinecap="round"
                />
            </svg>
            <div>
                <p className="text-[11px] font-medium text-[#8b949e]">Authority score</p>
                <p className="text-[26px] font-black tabular-nums leading-none" style={{ color }}>{score}</p>
                <p className="text-[11px] text-[#8b949e]">benchmark-relative</p>
            </div>
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
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-[#8b949e]">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Building topical authority map…</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
            </div>
        );
    }

    if (!data || data.clusters.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <Globe className="h-10 w-10 text-[#30363d]" />
                <p className="text-sm font-medium text-[#8b949e]">No published content clusters yet</p>
                <p className="text-xs text-[#484f58] max-w-xs">
                    Publish at least one blog to see your topical authority map.
                </p>
            </div>
        );
    }

    const topGap = data.topRecommendedMissingSpoke;

    return (
        <div className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ScoreDial score={data.overallAuthorityScore} />
                <KpiStat label="Topic clusters" value={data.totalClustersCount} />
                <KpiStat label="Pillar pages" value={data.publishedPillarsCount} />
                <KpiStat label="Spoke pages" value={data.publishedSpokesCount} />
            </div>

            {/* Top recommendation */}
            {topGap && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">
                        Recommended next coverage
                    </p>
                    <p className="text-sm font-semibold text-[#e6edf3]">{topGap.suggestedTitle}</p>
                    <p className="text-xs text-[#8b949e] mt-0.5">
                        Cluster: <span className="text-[#c9d1d9]">{topGap.topicClusterKey}</span>
                        {" · "}Keyword: <span className="font-mono text-[#c9d1d9]">{topGap.suggestedKeyword}</span>
                        {!topGap.hasGscEvidence && (
                            <span className="ml-2 text-[#484f58]">(heuristic — no GSC signal)</span>
                        )}
                    </p>
                </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-5 text-[11px] text-[#8b949e]">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 bg-emerald-400 rounded" />
                    Detected internal mention
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 border-t border-dashed border-[#64748b]" />
                    Undetected (opportunity)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                    Orphan spoke
                </span>
            </div>

            {/* Cluster cards */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-[#8b949e]" />
                    <h2 className="text-sm font-semibold text-[#e6edf3]">
                        Clusters <span className="text-[#8b949e] font-normal">({data.clusters.length})</span>
                    </h2>
                    <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[#484f58]">
                        <Link2 className="h-3 w-3" />
                        Coverage = spokes vs 4-spoke benchmark
                    </div>
                </div>
                {data.clusters.map(cluster => (
                    <ClusterCard key={cluster.clusterKey} cluster={cluster} siteId={siteId} />
                ))}
            </div>
        </div>
    );
}
