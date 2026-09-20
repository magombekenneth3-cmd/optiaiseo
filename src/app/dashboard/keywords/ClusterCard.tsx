"use client";

import { useState, useTransition } from "react";
import { generateBlogForKeyword } from "@/app/actions/keywords";
import { LinkGraphSvg } from "./LinkGraphSvg";
import type { TopicClusterTree } from "@/lib/blog/topical-matrix";
import {
    ChevronDown,
    ExternalLink,
    FileText,
    AlertTriangle,
    Loader2,
    CheckCircle2,
    Sparkles,
    TrendingUp,
} from "lucide-react";

interface Props {
    cluster: TopicClusterTree;
    siteId: string;
}

/** Maps a 0-100 score to a colour and label */
function healthOf(score: number): { color: string; bg: string; border: string; label: string } {
    if (score >= 75) return { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", label: "Strong" };
    if (score >= 45) return { color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", label: "Building" };
    return { color: "#f85149", bg: "rgba(248,81,73,0.08)", border: "rgba(248,81,73,0.25)", label: "Weak" };
}

function ScoreBar({ label, value, detail, tooltip }: {
    label: string; value: number; detail: string; tooltip?: string;
}) {
    const color = value >= 75 ? "#34d399" : value >= 40 ? "#fbbf24" : "#f85149";
    return (
        <div className="space-y-1.5" title={tooltip}>
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#8b949e]">{label}</span>
                <span className="font-mono text-[11px] font-semibold" style={{ color }}>{detail}</span>
            </div>
            <div className="h-1 w-full rounded-full overflow-hidden bg-[#21262d]">
                <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                        width: `${Math.max(2, value)}%`,
                        background: `linear-gradient(90deg, ${color}99, ${color})`,
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

    const { pillarNode, spokeNodes, coverageScore, internalLinkScore, clusterAuthorityScore, missingSpokes } = cluster;
    const orphans = spokeNodes.filter(s => s.inboundClusterMentionCount === 0);
    const linkedCount = spokeNodes.filter(s => s.inboundClusterMentionCount > 0).length;
    const health = healthOf(clusterAuthorityScore);

    function handleGenerateDraft(gap: typeof missingSpokes[number]) {
        startGenerate(async () => {
            setGenResult(null);
            const result = await generateBlogForKeyword(
                gap.suggestedKeyword,
                0, 0, siteId
            );
            if (result.success) {
                setGenResult({ ok: true, message: "Draft queued — check Content tab." });
            } else if ("requiresConfirmation" in result && result.requiresConfirmation) {
                setGenResult({ ok: false, message: "SERP mismatch — confirm in Content tab." });
            } else {
                setGenResult({ ok: false, message: ("error" in result && result.error) || "Failed to queue draft." });
            }
        });
    }

    return (
        <div
            className="rounded-xl overflow-hidden transition-all duration-200"
            style={{
                border: `1px solid ${expanded ? health.border : "#21262d"}`,
                background: expanded ? health.bg : "rgb(13,17,23)",
            }}
        >
            {/* ── Header (always visible) ─────────────────────────────── */}
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left group"
                aria-expanded={expanded}
            >
                {/* Health dot */}
                <span
                    className="shrink-0 h-2 w-2 rounded-full transition-all duration-300"
                    style={{ background: health.color, boxShadow: expanded ? `0 0 6px ${health.color}` : "none" }}
                />

                {/* Cluster name + meta */}
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#e6edf3] truncate leading-tight">
                        {cluster.clusterName}
                    </p>
                    <p className="text-[11px] text-[#484f58] mt-0.5">
                        {pillarNode ? "1 pillar" : "No pillar detected"}
                        <span className="mx-1.5 text-[#30363d]">·</span>
                        {spokeNodes.length} spoke{spokeNodes.length !== 1 ? "s" : ""}
                        {orphans.length > 0 && (
                            <>
                                <span className="mx-1.5 text-[#30363d]">·</span>
                                <span style={{ color: "#fbbf24" }}>
                                    {orphans.length} orphan{orphans.length !== 1 ? "s" : ""}
                                </span>
                            </>
                        )}
                    </p>
                </div>

                {/* Right side: score pill + coverage + chevron */}
                <div className="flex items-center gap-3 shrink-0">
                    <span
                        className="hidden sm:inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide"
                        style={{ color: health.color, background: health.bg, border: `1px solid ${health.border}` }}
                    >
                        {health.label}
                    </span>
                    <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-[#484f58] leading-tight">Coverage</p>
                        <p className="text-xs font-mono font-bold text-[#c9d1d9]">
                            {spokeNodes.length}/4
                        </p>
                    </div>
                    <ChevronDown
                        className="h-4 w-4 text-[#484f58] transition-transform duration-200"
                        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                </div>
            </button>

            {/* ── Expanded body ───────────────────────────────────────── */}
            {expanded && (
                <div className="border-t border-[#21262d] divide-y divide-[#21262d]">

                    {/* Pillar */}
                    {pillarNode && (
                        <div className="px-5 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#484f58] mb-2.5">
                                Pillar page
                            </p>
                            <a
                                href={pillarNode.url}
                                target="_blank"
                                rel="noreferrer"
                                className="group/link inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                            >
                                <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                <span className="truncate max-w-[340px]">{pillarNode.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover/link:opacity-50 transition-opacity" />
                            </a>
                            {pillarNode.position !== undefined ? (
                                <div className="flex items-center gap-3 mt-1.5">
                                    <span className="inline-flex items-center gap-1 text-[11px] text-[#8b949e]">
                                        <TrendingUp className="h-3 w-3" />
                                        pos&nbsp;<span className="font-mono text-[#c9d1d9]">{pillarNode.position.toFixed(1)}</span>
                                    </span>
                                    <span className="text-[#30363d]">·</span>
                                    <span className="text-[11px] text-[#8b949e]">
                                        <span className="font-mono text-[#c9d1d9]">{(pillarNode.impressions ?? 0).toLocaleString()}</span> impressions
                                    </span>
                                    {pillarNode.clicks !== undefined && (
                                        <>
                                            <span className="text-[#30363d]">·</span>
                                            <span className="text-[11px] text-[#8b949e]">
                                                <span className="font-mono text-[#c9d1d9]">{pillarNode.clicks.toLocaleString()}</span> clicks
                                            </span>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <p className="text-[11px] text-[#484f58] mt-1.5">No GSC data for this page</p>
                            )}
                        </div>
                    )}

                    {/* Spoke list */}
                    {spokeNodes.length > 0 && (
                        <div className="px-5 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#484f58] mb-2.5">
                                Spoke pages
                            </p>
                            <ul className="space-y-3">
                                {spokeNodes.map(spoke => {
                                    const linked = spoke.inboundClusterMentionCount > 0;
                                    return (
                                        <li key={spoke.id} className="flex items-start gap-3 group/spoke">
                                            {/* Link status icon */}
                                            <div className="mt-0.5 shrink-0 w-4 flex justify-center">
                                                {linked ? (
                                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5" />
                                                ) : (
                                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline gap-2 flex-wrap">
                                                    <a
                                                        href={spoke.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className={`text-xs font-medium truncate transition-colors ${
                                                            linked ? "text-[#c9d1d9] hover:text-white" : "text-amber-300/80 hover:text-amber-300"
                                                        }`}
                                                    >
                                                        {spoke.title}
                                                    </a>
                                                    {!linked && (
                                                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide bg-amber-400/10 text-amber-400 border border-amber-400/20 shrink-0">
                                                            ORPHAN
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                    {spoke.position !== undefined ? (
                                                        <>
                                                            <span className="text-[10px] text-[#484f58]">
                                                                pos <span className="font-mono text-[#8b949e]">{spoke.position.toFixed(1)}</span>
                                                            </span>
                                                            <span className="text-[#30363d]">·</span>
                                                            <span className="text-[10px] text-[#484f58]">
                                                                <span className="font-mono text-[#8b949e]">{(spoke.impressions ?? 0).toLocaleString()}</span> imp
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="text-[10px] text-[#30363d]">No GSC data</span>
                                                    )}
                                                    {linked && (
                                                        <span className="text-[10px] text-emerald-600">
                                                            {spoke.inboundClusterMentionCount} inbound mention{spoke.inboundClusterMentionCount !== 1 ? "s" : ""}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {/* Metrics */}
                    <div className="px-5 py-4 space-y-3">
                        <ScoreBar
                            label="Coverage"
                            value={coverageScore}
                            detail={`${spokeNodes.length}/4 benchmark`}
                            tooltip="Number of spoke pages relative to a 4-spoke benchmark per pillar. Does not measure complete topical coverage."
                        />
                        <ScoreBar
                            label="Internal mentions detected"
                            value={internalLinkScore}
                            detail={`${linkedCount}/${spokeNodes.length} spokes`}
                            tooltip="Percentage of spoke pages that appear (by slug) in at least one other cluster page's content. Not a parsed href graph."
                        />
                    </div>

                    {/* Link graph */}
                    {(pillarNode || spokeNodes.length > 0) && spokeNodes.length > 0 && (
                        <div className="px-5 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#484f58] mb-3">
                                Cluster link graph
                                <span className="ml-2 font-normal normal-case text-[#30363d]">
                                    — solid = detected mention · dashed = opportunity
                                </span>
                            </p>
                            <div className="rounded-lg bg-[#080c10] border border-[#161b22]">
                                <LinkGraphSvg pillar={pillarNode} spokes={spokeNodes} />
                            </div>
                        </div>
                    )}

                    {/* Missing spoke */}
                    {missingSpokes.length > 0 && (
                        <div className="px-5 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#484f58] mb-3">
                                Coverage gaps
                            </p>
                            <div className="space-y-3">
                                {missingSpokes.map(gap => (
                                    <div
                                        key={gap.topicClusterKey}
                                        className="rounded-lg border border-dashed border-[#30363d] bg-[#0d1117] p-4"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 h-6 w-6 rounded-md bg-[#161b22] border border-[#30363d] flex items-center justify-center shrink-0">
                                                <Sparkles className="h-3 w-3 text-[#8b949e]" />
                                            </div>
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <p className="text-xs font-semibold text-[#c9d1d9]">{gap.suggestedTitle}</p>
                                                <p className="text-[11px] text-[#484f58]">
                                                    Keyword: <span className="font-mono text-[#8b949e]">{gap.suggestedKeyword}</span>
                                                    {!gap.hasGscEvidence && (
                                                        <span className="ml-1.5 text-[#30363d]">· heuristic, no GSC signal</span>
                                                    )}
                                                </p>
                                                {genResult ? (
                                                    <div className={`flex items-center gap-1.5 text-xs pt-1 ${genResult.ok ? "text-emerald-400" : "text-rose-400"}`}>
                                                        {genResult.ok
                                                            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                                            : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                                                        {genResult.message}
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={generating}
                                                        onClick={() => handleGenerateDraft(gap)}
                                                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-[11px] font-medium text-[#c9d1d9] hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
