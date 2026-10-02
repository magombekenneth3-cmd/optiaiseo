"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    ExternalLink,
    Eye,
    GitPullRequest,
    Loader2,
    Microscope,
    Rocket,
    Shield,
    Sparkles,
    Target,
    Wrench,
    XCircle,
} from "lucide-react";

interface TimelineEvidenceItem {
    id: string;
    source: string;
    url: string | null;
    observedAt: string;
    observedValue: Record<string, unknown> | null;
    confidence: number;
}

interface TimelineHealingLog {
    id: string;
    issueType: string;
    description: string;
    actionTaken: string;
    status: string;
    impactScore: number | null;
    createdAt: string;
}

interface TimelineProposal {
    id: string;
    issueLabel: string;
    status: string;
    prUrl: string | null;
    prNumber: number | null;
    createdAt: string;
}

interface TimelineDeployment {
    proposalId: string;
    issueLabel: string;
    prUrl: string | null;
    prNumber: number | null;
    deploymentUrl: string | null;
    deploymentStatus: string;
    deployedAt: string | null;
    verificationStatus: string;
}

interface TimelineFinding {
    id: string;
    issueType: string;
    status: string;
    severity: string;
    lifecycleState: string;
    rootCause: string;
    expectedOutcome: string;
    createdAt: string;
    resolvedAt: string | null;
}

interface TimelineStage<T = unknown> {
    status: string;
    timestamp?: string;
    count?: number;
    items?: TimelineEvidenceItem[];
    evidence?: TimelineEvidenceItem[];
    healingLogs?: TimelineHealingLog[];
    proposals?: TimelineProposal[];
    deployments?: TimelineDeployment[];
    resolvedAt?: string | null;
    lifecycleState?: string;
    extra?: T;
}

interface TimelineData {
    finding: TimelineFinding;
    stages: {
        discovery: TimelineStage;
        evidence: TimelineStage;
        remediation: TimelineStage;
        deployment: TimelineStage;
        t0Verification: TimelineStage;
        t7Verification: TimelineStage;
        t28Outcome: TimelineStage;
        resolution: TimelineStage;
    };
    domain: string;
}

const STAGE_CONFIG: Record<
    string,
    { label: string; icon: typeof Activity; description: string }
> = {
    discovery: {
        label: "Discovery",
        icon: Microscope,
        description: "Finding detected and root cause identified",
    },
    evidence: {
        label: "Evidence Collection",
        icon: Eye,
        description: "Supporting evidence gathered from multiple sources",
    },
    remediation: {
        label: "Remediation",
        icon: Wrench,
        description: "Fix actions initiated",
    },
    deployment: {
        label: "Deployment",
        icon: Rocket,
        description: "Fix deployed to the target environment",
    },
    t0Verification: {
        label: "T+0 Verification",
        icon: Target,
        description: "Immediate post-deployment check",
    },
    t7Verification: {
        label: "T+7 Stability",
        icon: Shield,
        description: "7-day stability verification",
    },
    t28Outcome: {
        label: "T+28 Business Impact",
        icon: Sparkles,
        description: "28-day business impact assessment",
    },
    resolution: {
        label: "Resolution",
        icon: CheckCircle2,
        description: "Finding lifecycle completion",
    },
};

const STATUS_STYLES: Record<
    string,
    { dot: string; line: string; text: string; bg: string }
> = {
    completed: {
        dot: "bg-emerald-400 ring-emerald-500/30",
        line: "bg-emerald-500/40",
        text: "text-emerald-400",
        bg: "bg-emerald-500/5 border-emerald-500/20",
    },
    passed: {
        dot: "bg-emerald-400 ring-emerald-500/30",
        line: "bg-emerald-500/40",
        text: "text-emerald-400",
        bg: "bg-emerald-500/5 border-emerald-500/20",
    },
    failed: {
        dot: "bg-rose-400 ring-rose-500/30",
        line: "bg-rose-500/40",
        text: "text-rose-400",
        bg: "bg-rose-500/5 border-rose-500/20",
    },
    pending: {
        dot: "bg-amber-400/60 ring-amber-500/20",
        line: "bg-border/50",
        text: "text-amber-400",
        bg: "bg-amber-500/5 border-amber-500/15",
    },
    insufficient_data: {
        dot: "bg-orange-400/60 ring-orange-500/20",
        line: "bg-border/50",
        text: "text-orange-400",
        bg: "bg-orange-500/5 border-orange-500/15",
    },
    unavailable: {
        dot: "bg-zinc-500/60 ring-zinc-500/20",
        line: "bg-border/30",
        text: "text-zinc-500",
        bg: "bg-zinc-500/5 border-zinc-500/15",
    },
    skipped: {
        dot: "bg-zinc-500/40 ring-zinc-500/15",
        line: "bg-border/20",
        text: "text-zinc-500",
        bg: "bg-zinc-500/5 border-zinc-500/10",
    },
};

const STATUS_LABELS: Record<string, string> = {
    completed: "Completed",
    passed: "Passed",
    failed: "Failed",
    pending: "Pending",
    insufficient_data: "Insufficient Data",
    unavailable: "No Data",
    skipped: "Skipped",
};

function formatTimeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const EVIDENCE_SOURCE_COLORS: Record<string, string> = {
    HTML: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    HTTP_HEADERS: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    ROBOTS: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    SITEMAP: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    GSC: "text-green-400 bg-green-500/10 border-green-500/20",
    GA4: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    CRUX: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    LINK_GRAPH: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    SCHEMA: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    DNS: "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

function EvidenceItems({ items }: { items: TimelineEvidenceItem[] }) {
    if (items.length === 0) return null;
    return (
        <div className="space-y-1.5 mt-2">
            {items.slice(0, 5).map((ev) => {
                const sourceColor =
                    EVIDENCE_SOURCE_COLORS[ev.source] ??
                    "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
                return (
                    <div
                        key={ev.id}
                        className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-black/20 border border-border/30"
                    >
                        <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${sourceColor}`}
                        >
                            {ev.source}
                        </span>
                        <div className="flex-1 min-w-0">
                            {ev.url && (
                                <p className="text-[10px] text-muted-foreground font-mono truncate">
                                    {ev.url}
                                </p>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                                {formatTimeAgo(ev.observedAt)} · conf:{" "}
                                {(ev.confidence * 100).toFixed(0)}%
                            </span>
                        </div>
                    </div>
                );
            })}
            {items.length > 5 && (
                <p className="text-[10px] text-muted-foreground px-3">
                    +{items.length - 5} more evidence records
                </p>
            )}
        </div>
    );
}

function VerificationDetail({
    evidence,
}: {
    evidence: TimelineEvidenceItem[];
}) {
    if (evidence.length === 0) return null;

    const latest = evidence[evidence.length - 1];
    const obs = latest.observedValue as Record<string, unknown> | null;
    const outcome = obs?.outcome as string | undefined;
    const impactScore = obs?.impactScore as number | undefined;
    const metrics = obs?.metrics as Record<string, unknown> | undefined;

    return (
        <div className="space-y-2 mt-2">
            {outcome && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Outcome:
                    </span>
                    <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            outcome === "improved" || outcome === "passed"
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                : outcome === "degraded" || outcome === "failed"
                                  ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                  : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        }`}
                    >
                        {outcome}
                    </span>
                </div>
            )}
            {impactScore !== undefined && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Impact:
                    </span>
                    <span className="text-xs font-bold tabular-nums text-foreground">
                        {impactScore}
                    </span>
                </div>
            )}
            {metrics && (
                <details className="group/metrics">
                    <summary className="text-[10px] text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors select-none">
                        View metrics
                    </summary>
                    <pre className="mt-1 p-2 rounded-lg bg-black/40 border border-border/40 text-[10px] text-muted-foreground font-mono overflow-x-auto max-h-24 scrollbar-thin">
                        {JSON.stringify(metrics, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}

function TimelineStageRow({
    stageKey,
    stage,
    isLast,
}: {
    stageKey: string;
    stage: TimelineStage;
    isLast: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const config = STAGE_CONFIG[stageKey];
    const styles = STATUS_STYLES[stage.status] ?? STATUS_STYLES.unavailable;
    const Icon = config?.icon ?? Activity;

    const hasContent =
        (stage.items && stage.items.length > 0) ||
        (stage.evidence && stage.evidence.length > 0) ||
        (stage.healingLogs && stage.healingLogs.length > 0) ||
        (stage.proposals && stage.proposals.length > 0) ||
        (stage.deployments && stage.deployments.length > 0) ||
        stage.resolvedAt;

    const timestamp =
        stage.timestamp ??
        stage.items?.[0]?.observedAt ??
        stage.evidence?.[0]?.observedAt ??
        stage.healingLogs?.[0]?.createdAt ??
        stage.proposals?.[0]?.createdAt ??
        stage.deployments?.[0]?.deployedAt ??
        stage.resolvedAt ??
        null;

    return (
        <div className="relative flex gap-3" id={`timeline-stage-${stageKey}`}>
            <div className="flex flex-col items-center shrink-0 w-6">
                <div
                    className={`w-3 h-3 rounded-full ring-4 ${styles.dot} mt-1.5 transition-all`}
                />
                {!isLast && (
                    <div
                        className={`w-0.5 flex-1 mt-1 ${styles.line} transition-all`}
                    />
                )}
            </div>

            <div className="flex-1 pb-6 min-w-0">
                <button
                    onClick={() => hasContent && setExpanded((p) => !p)}
                    className={`w-full text-left rounded-xl border p-3 transition-all ${
                        expanded
                            ? `${styles.bg} shadow-sm`
                            : `border-border/40 hover:border-border/60 ${
                                  hasContent ? "cursor-pointer" : "cursor-default"
                              }`
                    }`}
                    disabled={!hasContent}
                    aria-expanded={expanded}
                    aria-controls={`timeline-detail-${stageKey}`}
                >
                    <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${styles.text}`} />
                        <span className="text-xs font-semibold text-foreground">
                            {config?.label ?? stageKey}
                        </span>
                        <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${styles.bg} ${styles.text}`}
                        >
                            {STATUS_LABELS[stage.status] ?? stage.status}
                        </span>
                        {stage.count !== undefined && stage.count > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                                ({stage.count} items)
                            </span>
                        )}
                        <div className="flex-1" />
                        {timestamp && (
                            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                {formatTimeAgo(timestamp)}
                            </span>
                        )}
                        {hasContent &&
                            (expanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        {config?.description}
                    </p>
                </button>

                {expanded && hasContent && (
                    <div
                        id={`timeline-detail-${stageKey}`}
                        className="mt-2 pl-1 space-y-2"
                    >
                        {stage.items && stage.items.length > 0 && (
                            <EvidenceItems items={stage.items} />
                        )}

                        {stage.evidence && stage.evidence.length > 0 && (
                            <VerificationDetail evidence={stage.evidence} />
                        )}

                        {stage.healingLogs &&
                            stage.healingLogs.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                                        Self-Healing Actions
                                    </p>
                                    {stage.healingLogs.map((log) => (
                                        <div
                                            key={log.id}
                                            className="px-3 py-2 rounded-lg bg-black/20 border border-border/30"
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <Wrench className="w-3 h-3 text-amber-400" />
                                                <span className="text-[11px] font-medium text-foreground">
                                                    {log.issueType.replace(/_/g, " ")}
                                                </span>
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                        log.status === "COMPLETED"
                                                            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                                                            : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                                                    }`}
                                                >
                                                    {log.status}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground leading-relaxed">
                                                {log.description}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                {formatTimeAgo(log.createdAt)}
                                                {log.impactScore !== null &&
                                                    ` · impact: ${log.impactScore}`}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                        {stage.proposals &&
                            stage.proposals.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                                        Fix Proposals
                                    </p>
                                    {stage.proposals.map((p) => (
                                        <div
                                            key={p.id}
                                            className="px-3 py-2 rounded-lg bg-black/20 border border-border/30"
                                        >
                                            <div className="flex items-center gap-2">
                                                <GitPullRequest className="w-3 h-3 text-blue-400" />
                                                <span className="text-[11px] font-medium text-foreground">
                                                    {p.issueLabel}
                                                </span>
                                                <span className="text-[9px] text-muted-foreground font-mono">
                                                    {p.status}
                                                </span>
                                                {p.prUrl && (
                                                    <a
                                                        href={p.prUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-400 hover:text-blue-300 transition-colors"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                {formatTimeAgo(p.createdAt)}
                                                {p.prNumber && ` · PR #${p.prNumber}`}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                        {stage.deployments &&
                            stage.deployments.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                                        Deployments
                                    </p>
                                    {stage.deployments.map((d) => (
                                        <div
                                            key={d.proposalId}
                                            className="px-3 py-2 rounded-lg bg-black/20 border border-border/30"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Rocket className="w-3 h-3 text-emerald-400" />
                                                <span className="text-[11px] font-medium text-foreground">
                                                    {d.issueLabel}
                                                </span>
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                                        d.deploymentStatus === "DEPLOYED"
                                                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                                            : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                                                    }`}
                                                >
                                                    {d.deploymentStatus}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                                {d.deployedAt ? formatDate(d.deployedAt) : "Pending"}
                                                {d.deploymentUrl && (
                                                    <>
                                                        {" · "}
                                                        <a
                                                            href={d.deploymentUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-400 hover:text-blue-300"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            View deployment
                                                        </a>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                        {stageKey === "resolution" && (
                            <div className="px-3 py-2 rounded-lg bg-black/20 border border-border/30">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                        Lifecycle State:
                                    </span>
                                    <span
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                            stage.lifecycleState === "RESOLVED"
                                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                                : stage.lifecycleState === "OPEN"
                                                  ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                                  : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                                        }`}
                                    >
                                        {stage.lifecycleState}
                                    </span>
                                </div>
                                {stage.resolvedAt && (
                                    <p className="text-[10px] text-emerald-400 mt-1">
                                        Resolved {formatDate(stage.resolvedAt)}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function VerificationTimeline({
    findingId,
}: {
    findingId: string;
}) {
    const [data, setData] = useState<TimelineData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTimeline = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/diagnostics/${findingId}/timeline`, {
                credentials: "include",
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const json = await res.json();
            setData(json);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [findingId]);

    useEffect(() => {
        fetchTimeline();
    }, [fetchTimeline]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-4 px-4 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading verification timeline…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-4 py-3 rounded-lg bg-rose-500/5 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Timeline unavailable: {error}</span>
                <button
                    onClick={fetchTimeline}
                    className="ml-auto text-[10px] font-bold text-rose-300 hover:text-rose-200 transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!data) return null;

    const stageOrder: (keyof typeof data.stages)[] = [
        "discovery",
        "evidence",
        "remediation",
        "deployment",
        "t0Verification",
        "t7Verification",
        "t28Outcome",
        "resolution",
    ];

    return (
        <div className="border-t border-border/50">
            <div className="px-4 py-2.5 bg-muted/20 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Verification Timeline
                </h4>
                <span
                    className={`ml-auto px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                        data.finding.lifecycleState === "RESOLVED"
                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                            : data.finding.lifecycleState === "OPEN"
                              ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                              : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                    }`}
                >
                    {data.finding.lifecycleState}
                </span>
            </div>
            <div className="p-4">
                {stageOrder.map((key, i) => (
                    <TimelineStageRow
                        key={key}
                        stageKey={key}
                        stage={data.stages[key] as TimelineStage}
                        isLast={i === stageOrder.length - 1}
                    />
                ))}
            </div>
        </div>
    );
}
