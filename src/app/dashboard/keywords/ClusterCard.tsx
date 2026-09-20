"use client";

import { useState, useTransition } from "react";
import { generateBlogForKeyword } from "@/app/actions/keywords";
import { LinkGraphSvg } from "./LinkGraphSvg";
import type { TopicClusterTree } from "@/lib/blog/topical-matrix";
import {
    ChevronDown,
    ChevronRight,
    ExternalLink,
    FileText,
    AlertTriangle,
    Loader2,
    CheckCircle2,
} from "lucide-react";

interface Props {
    cluster: TopicClusterTree;
    siteId: string;
}

function ScoreBar({ label, value, detail }: { label: string; value: number; detail: string }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#8b949e]">{label}</span>
                <span className="text-[11px] font-mono text-[#e6edf3]">{detail}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#21262d] overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                        width: `${value}%`,
                        background: value >= 75
                            ? "rgb(52,211,153)"
                            : value >= 40
                                ? "rgb(251,191,36)"
                                : "rgb(248,81,73)",
                    }}
                />
            </div>
        </div>
    );
}

export function ClusterCard({ cluster, siteId }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [generating, startGenerate] = useTransition();
    const [genResult, setGenResult] = useState<{ ok: boolean; message: string } | null>(null);

    const { pillarNode, spokeNodes, coverageScore, internalLinkScore, missingSpokes } = cluster;
    const orphans = spokeNodes.filter(s => s.inboundClusterMentionCount === 0);
    const linkedCount = spokeNodes.filter(s => s.inboundClusterMentionCount > 0).length;
    const allNodes = pillarNode ? [pillarNode, ...spokeNodes] : spokeNodes;

    function handleGenerateDraft(gap: typeof missingSpokes[number]) {
        startGenerate(async () => {
            setGenResult(null);
            const result = await generateBlogForKeyword(
                gap.suggestedKeyword,
                /* position */ 0,
                /* impressions */ 0,
                siteId
            );
            if (result.success) {
                setGenResult({ ok: true, message: "Draft created. Check Content tab." });
            } else if (result.requiresConfirmation) {
                setGenResult({ ok: false, message: result.error ?? "SERP mismatch — review in Content tab." });
            } else {
                setGenResult({ ok: false, message: result.error ?? "Failed to create draft." });
            }
        });
    }

    return (
        <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
            {/* Header */}
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#161b22] transition-colors"
                aria-expanded={expanded}
            >
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#e6edf3] text-sm truncate">{cluster.clusterName}</p>
                    <p className="text-[11px] text-[#8b949e] mt-0.5">
                        {pillarNode ? "1 pillar" : "No pillar"} · {spokeNodes.length} spoke{spokeNodes.length !== 1 ? "s" : ""}
                        {orphans.length > 0 && (
                            <span className="ml-2 text-amber-400">· {orphans.length} orphan{orphans.length !== 1 ? "s" : ""}</span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                        <p className="text-[11px] text-[#8b949e]">Coverage</p>
                        <p className="text-xs font-mono font-bold text-[#e6edf3]">
                            {spokeNodes.length}/4 benchmark
                        </p>
                    </div>
                    {expanded ? (
                        <ChevronDown className="h-4 w-4 text-[#8b949e]" />
                    ) : (
                        <ChevronRight className="h-4 w-4 text-[#8b949e]" />
                    )}
                </div>
            </button>

            {/* Expanded body */}
            {expanded && (
                <div className="border-t border-[#21262d] px-5 py-4 space-y-5">

                    {/* Pillar */}
                    {pillarNode && (
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-2">Pillar</p>
                            <a
                                href={pillarNode.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors truncate"
                            >
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{pillarNode.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                            </a>
                            {pillarNode.position !== undefined && (
                                <p className="text-[11px] text-[#8b949e] mt-1">
                                    GSC pos {pillarNode.position.toFixed(1)} · {(pillarNode.impressions ?? 0).toLocaleString()} impressions
                                </p>
                            )}
                        </div>
                    )}

                    {/* Spoke list */}
                    {spokeNodes.length > 0 && (
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-2">Spokes</p>
                            <ul className="space-y-2">
                                {spokeNodes.map(spoke => (
                                    <li key={spoke.id} className="flex items-start gap-2">
                                        <span className="mt-0.5 shrink-0 text-[#8b949e]">
                                            {spoke.inboundClusterMentionCount > 0
                                                ? <span className="text-emerald-500">├─</span>
                                                : <span className="text-amber-400">├─</span>}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <a
                                                href={spoke.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-xs text-[#c9d1d9] hover:text-white transition-colors truncate block"
                                            >
                                                {spoke.title}
                                            </a>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {spoke.position !== undefined ? (
                                                    <span className="text-[10px] text-[#8b949e]">
                                                        pos {spoke.position.toFixed(1)} · {(spoke.impressions ?? 0).toLocaleString()} imp
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-[#8b949e]">No GSC data</span>
                                                )}
                                                {spoke.inboundClusterMentionCount === 0 && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                                                        <AlertTriangle className="h-2.5 w-2.5" />
                                                        ORPHAN
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Scores */}
                    <div className="space-y-2.5">
                        <ScoreBar
                            label="Coverage"
                            value={coverageScore}
                            detail={`${spokeNodes.length}/4 benchmark`}
                        />
                        <ScoreBar
                            label="Internal mentions detected"
                            value={internalLinkScore}
                            detail={`${linkedCount}/${spokeNodes.length} spokes`}
                        />
                    </div>

                    {/* Link graph */}
                    {allNodes.length > 1 && (
                        <div className="rounded-lg border border-[#21262d] bg-[#080c10] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-2">
                                Cluster link graph
                                <span className="ml-2 font-normal normal-case text-[#484f58]">
                                    — solid = detected mention · dashed = opportunity
                                </span>
                            </p>
                            <LinkGraphSvg pillar={pillarNode} spokes={spokeNodes} />
                        </div>
                    )}

                    {/* Missing spokes */}
                    {missingSpokes.length > 0 && (
                        <div className="rounded-lg border border-dashed border-[#30363d] bg-[#161b22] p-4 space-y-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e]">
                                Missing coverage
                            </p>
                            {missingSpokes.map(gap => (
                                <div key={gap.topicClusterKey} className="space-y-2">
                                    <p className="text-xs text-[#c9d1d9]">{gap.suggestedTitle}</p>
                                    <p className="text-[11px] text-[#8b949e]">
                                        Keyword: <span className="font-mono text-[#c9d1d9]">{gap.suggestedKeyword}</span>
                                        {!gap.hasGscEvidence && (
                                            <span className="ml-2 text-[#484f58]">(no GSC signal — heuristic suggestion)</span>
                                        )}
                                    </p>
                                    {genResult ? (
                                        <div className={`flex items-center gap-2 text-xs ${genResult.ok ? "text-emerald-400" : "text-rose-400"}`}>
                                            {genResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                                            {genResult.message}
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={generating}
                                            onClick={() => handleGenerateDraft(gap)}
                                            className="flex items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-xs font-medium text-[#e6edf3] hover:border-emerald-500/40 hover:text-emerald-400 transition-all disabled:opacity-50"
                                        >
                                            {generating ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <FileText className="h-3 w-3" />
                                            )}
                                            Generate Draft
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
