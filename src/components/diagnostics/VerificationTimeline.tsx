"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import Link from "next/link";
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
    Globe2,
    Loader2,
    Microscope,
    RefreshCw,
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

interface CriterionEvaluationItem {
    type?: string;
    criterion?: {
        type: string;
        selector?: string;
        expected?: unknown;
        headerName?: string;
        url?: string;
        userAgent?: string;
    };
    passed: boolean;
    actual: unknown;
    error?: string;
}

function formatCriterionLabel(item: CriterionEvaluationItem): string {
    const c = item.criterion;
    const type = c?.type ?? item.type ?? "CHECK";
    switch (type) {
        case "HTML_SELECTOR":
            return `HTML selector ${c?.selector ? `\`${c.selector}\`` : ""}`.trim();
        case "HTTP_STATUS":
            return `HTTP status${c?.url ? ` (${c.url})` : ""}`;
        case "HEADER_VALUE":
            return `HTTP header ${c?.headerName ?? ""}`.trim();
        case "ROBOTS_ALLOWED":
            return `robots.txt (${c?.userAgent ?? "Googlebot"})`;
        case "XML_VALID":
            return "XML sitemap validity";
        case "URL_PRESENT":
            return `URL reachable (${c?.url ?? ""})`;
        case "SCHEMA_PRESENT":
            return "JSON-LD structured data";
        case "GSC_INDEXED":
            return "Search Console index status";
        default:
            return type.replace(/_/g, " ");
    }
}

function formatCriterionValue(val: unknown): string {
    if (val === null || val === undefined) return "none / missing";
    if (typeof val === "string") return val.length > 80 ? `${val.slice(0, 80)}…` : val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    try {
        const json = JSON.stringify(val);
        return json.length > 90 ? `${json.slice(0, 90)}…` : json;
    } catch {
        return String(val);
    }
}

function CriteriaChecklist({ items }: { items: CriterionEvaluationItem[] }) {
    if (!items || items.length === 0) return null;
    return (
        <ul className="space-y-1.5 mt-2">
            {items.map((item, idx) => {
                const expected = item.criterion?.expected;
                return (
                    <li
                        key={idx}
                        className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] ${
                            item.passed
                                ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-200"
                                : "bg-rose-500/5 border-rose-500/20 text-rose-200"
                        }`}
                    >
                        {item.passed ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                        ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="font-medium text-foreground">
                                {formatCriterionLabel(item)}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
                                {expected !== undefined && (
                                    <span>Expected: {formatCriterionValue(expected)}</span>
                                )}
                                <span>Observed: {formatCriterionValue(item.actual)}</span>
                            </div>
                            {item.error && (
                                <p className="text-[10px] text-rose-300">{item.error}</p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
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
    const passedCount = obs?.passedCount as number | undefined;
    const totalCount = obs?.totalCount as number | undefined;
    const gscInspection = obs?.gscInspection as Record<string, unknown> | undefined;
    const criteria = Array.isArray(obs?.criteria) ? (obs.criteria as CriterionEvaluationItem[]) : [];

    const isPositiveOutcome =
        outcome === "improved" ||
        outcome === "passed" ||
        outcome === "TECHNICALLY_VERIFIED" ||
        outcome === "SEARCH_VERIFIED" ||
        outcome === "OUTCOME_MEASURED";

    const isNegativeOutcome =
        outcome === "degraded" ||
        outcome === "failed" ||
        outcome === "REGRESSED" ||
        outcome === "INEFFECTIVE";

    return (
        <div className="space-y-2 mt-2">
            {outcome && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Outcome:
                    </span>
                    <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            isPositiveOutcome
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                : isNegativeOutcome
                                  ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                  : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        }`}
                    >
                        {outcome}
                    </span>
                    {typeof passedCount === "number" && typeof totalCount === "number" && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                            ({passedCount}/{totalCount} checks)
                        </span>
                    )}
                </div>
            )}
            {criteria.length > 0 && <CriteriaChecklist items={criteria} />}
            {gscInspection && typeof gscInspection.coverageState === "string" && (
                <div className="text-[10px] text-muted-foreground">
                    GSC Coverage:{" "}
                    <span className="text-foreground font-medium">
                        {gscInspection.coverageState}
                    </span>
                    {typeof gscInspection.googleCanonical === "string" && (
                        <span className="ml-2 font-mono text-[9px] text-zinc-400">
                            · Canonical: {gscInspection.googleCanonical}
                        </span>
                    )}
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
    defaultExpanded = false,
}: {
    stageKey: string;
    stage: TimelineStage;
    isLast: boolean;
    defaultExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    useEffect(() => {
        if (defaultExpanded) {
            setExpanded(true);
        }
    }, [defaultExpanded]);
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
                    type="button"
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

interface LiveVerifyResponseData {
    url?: string;
    outcome: string;
    passedCount: number;
    totalCount: number;
    t7Scheduled?: boolean;
    criteria?: CriterionEvaluationItem[];
    gscInspection?: {
        success: boolean;
        code?: string;
        data?: { coverageState?: string; googleCanonical?: string };
        message?: string;
    } | null;
}

function normalizeDomainHost(domain?: string | null): string {
    if (!domain) return "";
    return domain
        .trim()
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        ?.replace(/:\d+$/, "")
        .replace(/^www\./i, "")
        .toLowerCase() ?? "";
}

function validateSameOriginUrl(raw: string, domain?: string | null): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return "Enter a full URL on this site (for example https://example.com/page).";
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return "Enter a valid https:// or http:// URL.";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return "URL must start with https:// or http://.";
    }
    const expectedHost = normalizeDomainHost(domain);
    const actualHost = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (expectedHost && actualHost !== expectedHost) {
        return `URL must belong to the site (${expectedHost}).`;
    }
    return null;
}

export function VerificationTimeline({
    findingId,
    scopeUrls,
    siteDomain,
    gscConnected,
    verifyTriggerSeq,
    onVerified,
}: {
    findingId: string;
    scopeUrls?: string[];
    siteDomain?: string;
    gscConnected?: boolean;
    verifyTriggerSeq?: number;
    onVerified?: () => void;
}) {
    const [data, setData] = useState<TimelineData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState<string | null>(null);
    const [verifyResult, setVerifyResult] = useState<LiveVerifyResponseData | null>(null);

    const urlOptions = Array.from(
        new Set((scopeUrls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0))
    );
    const [selectedUrlOption, setSelectedUrlOption] = useState<string>(() =>
        urlOptions[0] ?? "__custom__"
    );
    const [customUrl, setCustomUrl] = useState("");
    const [customUrlEdited, setCustomUrlEdited] = useState(false);
    const [customUrlError, setCustomUrlError] = useState<string | null>(null);

    const selectId = useId();
    const customInputId = useId();
    const customErrorId = useId();
    const customUrlRef = useRef<HTMLInputElement | null>(null);
    const lastTriggerSeqRef = useRef<number>(0);

    const effectiveDomain = data?.domain ?? siteDomain ?? null;

    useEffect(() => {
        if (urlOptions.length > 0 && selectedUrlOption === "__custom__" && !customUrlEdited) {
            setSelectedUrlOption(urlOptions[0]);
        }
    }, [urlOptions, selectedUrlOption, customUrlEdited]);

    const fetchTimeline = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
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
            if (!silent) setError((e as Error).message);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [findingId]);

    const handleVerifyLive = useCallback(async (overrideIncludeGsc?: boolean) => {
        if (verifying) return;

        let targetUrl: string | undefined;
        if (selectedUrlOption === "__custom__") {
            const validationError = validateSameOriginUrl(customUrl, effectiveDomain);
            if (validationError) {
                setCustomUrlError(validationError);
                setCustomUrlEdited(true);
                requestAnimationFrame(() => customUrlRef.current?.focus());
                return;
            }
            targetUrl = customUrl.trim();
        } else if (selectedUrlOption) {
            targetUrl = selectedUrlOption;
        }

        setVerifying(true);
        setVerifyError(null);
        setCustomUrlError(null);
        try {
            const payload: { url?: string; includeGscInspection?: boolean } = {};
            if (targetUrl) payload.url = targetUrl;
            if (typeof overrideIncludeGsc === "boolean") {
                payload.includeGscInspection = overrideIncludeGsc;
            }

            const res = await fetch(`/api/diagnostics/${findingId}/verify`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            setVerifyResult({
                url: body.url,
                outcome: body.outcome,
                passedCount: body.passedCount,
                totalCount: body.totalCount,
                t7Scheduled: body.t7Scheduled,
                criteria: Array.isArray(body.criteria) ? body.criteria : undefined,
                gscInspection: body.gscInspection,
            });
            await fetchTimeline(true);
            onVerified?.();
        } catch (e) {
            setVerifyError((e as Error).message);
        } finally {
            setVerifying(false);
        }
    }, [
        findingId,
        verifying,
        selectedUrlOption,
        customUrl,
        effectiveDomain,
        fetchTimeline,
        onVerified,
    ]);

    useEffect(() => {
        fetchTimeline(false);
    }, [fetchTimeline]);

    useEffect(() => {
        if (
            typeof verifyTriggerSeq === "number" &&
            verifyTriggerSeq > lastTriggerSeqRef.current
        ) {
            lastTriggerSeqRef.current = verifyTriggerSeq;
            void handleVerifyLive();
        }
    }, [verifyTriggerSeq, handleVerifyLive]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-4 px-4 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span className="text-xs">Loading verification timeline…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-4 py-3 rounded-lg bg-rose-500/5 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Timeline unavailable: {error}</span>
                <button
                    type="button"
                    onClick={() => fetchTimeline(false)}
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
            <div className="px-4 py-2.5 bg-muted/20 flex items-center gap-2 flex-wrap">
                <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Verification Timeline
                </h4>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <Globe2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                        <label htmlFor={selectId} className="sr-only">
                            Target URL for live verification
                        </label>
                        <select
                            id={selectId}
                            value={selectedUrlOption}
                            onChange={(e) => {
                                setSelectedUrlOption(e.target.value);
                                setCustomUrlError(null);
                            }}
                            className="h-8 max-w-[230px] rounded-lg border border-border/60 bg-background/80 px-2 text-[11px] font-mono text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            {urlOptions.map((u) => (
                                <option key={u} value={u}>
                                    {u}
                                </option>
                            ))}
                            <option value="__custom__">Custom URL on this site…</option>
                        </select>
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleVerifyLive()}
                        aria-disabled={verifying}
                        aria-busy={verifying}
                        className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                    >
                        {verifying ? (
                            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                            <Shield className="w-3 h-3" aria-hidden="true" />
                        )}
                        {verifying ? "Verifying…" : "Verify Fix Live"}
                    </button>
                    <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${
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
            </div>

            {selectedUrlOption === "__custom__" && (
                <div className="px-4 py-2.5 bg-muted/10 border-b border-border/40 space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <label
                            htmlFor={customInputId}
                            className="text-[11px] font-medium text-muted-foreground shrink-0"
                        >
                            Custom target URL:
                        </label>
                        <input
                            ref={customUrlRef}
                            id={customInputId}
                            type="url"
                            value={customUrl}
                            placeholder={
                                effectiveDomain
                                    ? `https://${normalizeDomainHost(effectiveDomain)}/page`
                                    : "https://example.com/page"
                            }
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            aria-invalid={Boolean(customUrlError)}
                            aria-describedby={customUrlError ? customErrorId : undefined}
                            onChange={(e) => {
                                setCustomUrl(e.target.value);
                                setCustomUrlEdited(true);
                                if (customUrlError) {
                                    setCustomUrlError(null);
                                }
                            }}
                            onBlur={() => {
                                if (customUrlEdited && customUrl.trim().length > 0) {
                                    setCustomUrlError(
                                        validateSameOriginUrl(customUrl, effectiveDomain)
                                    );
                                }
                            }}
                            className="flex-1 h-8 rounded-lg border border-border/60 bg-background/80 px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[invalid=true]:border-rose-500/70"
                        />
                    </div>
                    {customUrlError && (
                        <p id={customErrorId} role="alert" className="text-[11px] text-rose-300">
                            {customUrlError}
                        </p>
                    )}
                </div>
            )}

            {verifyError && (
                <div
                    role="alert"
                    className="mx-4 mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-300 flex items-center gap-2"
                >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Live check failed: {verifyError}</span>
                </div>
            )}

            {verifyResult && (
                <div className="mx-4 mt-3 space-y-2">
                    <div
                        role="status"
                        aria-live="polite"
                        className={`px-3 py-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 flex-wrap ${
                            verifyResult.outcome === "TECHNICALLY_VERIFIED"
                                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                                : "bg-amber-500/10 border-amber-500/25 text-amber-200"
                        }`}
                    >
                        <span>
                            Live check result:{" "}
                            <strong className="font-semibold">{verifyResult.outcome}</strong>{" "}
                            ({verifyResult.passedCount}/{verifyResult.totalCount} checks passed)
                            {verifyResult.url ? ` on ${verifyResult.url}` : ""}
                            {verifyResult.t7Scheduled ? " · T+7 Search verification scheduled" : ""}
                        </span>
                        {verifyResult.gscInspection?.success && verifyResult.gscInspection.data?.coverageState && (
                            <span className="text-[10px] text-emerald-300 font-mono">
                                GSC: {verifyResult.gscInspection.data.coverageState}
                            </span>
                        )}
                    </div>

                    {verifyResult.criteria && verifyResult.criteria.length > 0 && (
                        <div className="px-3 py-2 rounded-lg border border-border/50 bg-background/40">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Per-criterion verification results
                            </p>
                            <CriteriaChecklist items={verifyResult.criteria} />
                        </div>
                    )}

                    {verifyResult.gscInspection && !verifyResult.gscInspection.success && (
                        <div
                            role="alert"
                            className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200 flex items-center justify-between gap-3 flex-wrap"
                        >
                            <div className="flex items-start gap-2 min-w-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>
                                    Search Console inspection skipped:{" "}
                                    {verifyResult.gscInspection.message ??
                                        (gscConnected === false
                                            ? "Google Search Console is not connected."
                                            : "Google Search Console permission unavailable.")}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Link
                                    href="/dashboard/settings"
                                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 transition-colors"
                                >
                                    Reconnect GSC
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => void handleVerifyLive(false)}
                                    aria-disabled={verifying}
                                    aria-busy={verifying}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-muted/40 text-foreground border border-border/60 hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                                >
                                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                                    Re-run technical check only
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="p-4">
                {stageOrder.map((key, i) => {
                    const stage = data.stages[key] as TimelineStage;
                    const shouldDefaultExpand =
                        key === "t0Verification"
                            ? Boolean(verifyResult)
                            : key === "remediation"
                              ? Boolean(stage.proposals && stage.proposals.length > 0 && !verifyResult)
                              : false;
                    return (
                        <TimelineStageRow
                            key={key}
                            stageKey={key}
                            stage={stage}
                            isLast={i === stageOrder.length - 1}
                            defaultExpanded={shouldDefaultExpand}
                        />
                    );
                })}
            </div>
        </div>
    );
}
