"use client";

import { useEffect, useState } from "react";
import { getKeywordClusters } from "@/app/actions/keywords";
import type { KeywordCluster } from "@/lib/keywords";

interface Props {
    siteId: string;
}

function ClusterSkeleton() {
    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl opacity-30">💰</span>
                    <div className="h-5 w-40 shimmer rounded" />
                </div>
                <div className="h-4 w-72 shimmer rounded" />
            </div>
            <div className="divide-y divide-border">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-6 px-6 py-4">
                        <div className="h-4 w-32 shimmer rounded" />
                        <div className="h-4 w-48 shimmer rounded" />
                        <div className="h-4 w-20 shimmer rounded ml-auto" />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Expandable keyword chip list ─────────────────────────────────────────────
function KeywordChips({ keywords }: { keywords: { keyword: string }[] }) {
    const [expanded, setExpanded] = useState(false);
    const PREVIEW = 3;
    const visible = expanded ? keywords : keywords.slice(0, PREVIEW);
    const remaining = keywords.length - PREVIEW;

    return (
        <div className="flex flex-wrap gap-1 max-w-[260px]">
            {visible.map((kw, ki) => (
                <span
                    key={ki}
                    title={kw.keyword}
                    className="px-2 py-0.5 rounded-full bg-muted text-[11px] text-zinc-300 border border-border"
                >
                    {kw.keyword}
                </span>
            ))}
            {!expanded && remaining > 0 && (
                <button
                    onClick={() => setExpanded(true)}
                    className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-[11px] text-emerald-400 border border-emerald-500/20 font-bold hover:bg-emerald-500/20 transition-all cursor-pointer"
                >
                    +{remaining} more
                </button>
            )}
            {expanded && keywords.length > PREVIEW && (
                <button
                    onClick={() => setExpanded(false)}
                    className="px-2 py-0.5 rounded-full bg-zinc-500/10 text-[11px] text-zinc-400 border border-zinc-500/20 font-bold hover:bg-zinc-500/20 transition-all cursor-pointer"
                >
                    Show less ↑
                </button>
            )}
        </div>
    );
}

export function KeywordClustersPanel({ siteId }: Props) {
    const [clusters, setClusters] = useState<KeywordCluster[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const res = await getKeywordClusters(siteId);
                if (cancelled) return;
                if (res.success && res.clusters) {
                    setClusters(res.clusters);
                } else {
                    setError(res.error ?? "Failed to load clusters");
                }
            } catch {
                if (!cancelled) setError("Failed to load clusters");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [siteId]);

    if (loading) return <ClusterSkeleton />;

    if (error || !clusters || clusters.length === 0) {
        return (
            <div className="card-surface p-6 text-center text-sm text-muted-foreground">
                {error ?? "No clusters found. Add more keywords to enable clustering."}
            </div>
        );
    }

    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">💰</span>
                    <h2 className="text-lg font-semibold text-emerald-400">Revenue Clusters</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                    Semantic topic clusters prioritized by projected monthly revenue potential.
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                        <tr>
                            <th scope="col" className="px-6 py-3">Topic / Cluster</th>
                            <th scope="col" className="px-6 py-3">Keywords</th>
                            <th scope="col" className="px-6 py-3">Total Volume</th>
                            <th scope="col" className="px-6 py-3">Avg Difficulty</th>
                            <th scope="col" className="px-6 py-3">Authority Score</th>
                            <th scope="col" className="px-6 py-3">Opportunity</th>
                            <th scope="col" className="px-6 py-3 text-right">Projected Revenue</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {clusters.map((cluster, i) => (
                            <tr key={i} className="hover:bg-emerald-500/[0.02] transition-colors align-top">
                                <td className="px-6 py-4 font-bold text-foreground whitespace-nowrap">
                                    {cluster.topic}
                                </td>
                                <td className="px-6 py-4">
                                    <KeywordChips keywords={cluster.keywords} />
                                </td>
                                <td className="px-6 py-4 text-zinc-300 font-medium whitespace-nowrap">
                                    {cluster.totalVolume.toLocaleString()} search/mo
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${cluster.avgDifficulty < 30 ? 'bg-emerald-500' : cluster.avgDifficulty < 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                style={{ width: `${cluster.avgDifficulty}%` }}
                                            />
                                        </div>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">{Math.round(cluster.avgDifficulty)} / 100</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${cluster.topicalAuthorityScore >= 70 ? 'bg-emerald-500' : cluster.topicalAuthorityScore >= 30 ? 'bg-blue-500' : 'bg-muted-foreground'}`}
                                                style={{ width: `${Math.min(100, cluster.topicalAuthorityScore)}%` }}
                                            />
                                        </div>
                                        <span className={`text-xs font-bold whitespace-nowrap ${cluster.topicalAuthorityScore >= 70 ? 'text-emerald-400' : cluster.topicalAuthorityScore >= 30 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                                            {cluster.topicalAuthorityScore}/100
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold border border-blue-500/20 whitespace-nowrap">
                                        Score: {cluster.opportunityScore}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="text-emerald-400 text-lg font-bold">
                                        ${Math.round(cluster.projectedMonthlyRevenue).toLocaleString()}
                                        <span className="text-[10px] text-muted-foreground block font-normal">per month</span>
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
