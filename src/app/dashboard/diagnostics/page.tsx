"use client";

import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Clock,
    ExternalLink,
    Filter,
    GitPullRequest,
    Globe2,
    Loader2,
    Microscope,
    Search,
    Shield,
    Sparkles,
    Wrench,
    X,
    XCircle,
    Zap,
} from "lucide-react";
import { VerificationTimeline } from "@/components/diagnostics/VerificationTimeline";
import { FindingFixPanel, type LinkedProposalSummary } from "@/components/diagnostics/FindingFixPanel";
import { PageHeader } from "@/components/ui/design-system/PageHeader";

// ── Types ────────────────────────────────────────────────────────────────────

interface EvidenceItem {
    id: string;
    source: string;
    url: string | null;
    observedAt: string;
    observedValue: Record<string, unknown> | null;
    confidence: number;
}

interface DiagnosticFinding {
    id: string;
    siteId: string;
    fingerprint: string;
    issueType: string;
    status: string;
    severity: string;
    scopeType: string;
    scopeUrls: string[];
    rootCause: string;
    confidence: number;
    expectedOutcome: string;
    remediationType: string;
    verificationCriteria: unknown;
    dependencies: string[];
    priorityScore: number | null;
    priorityComponents: Record<string, number> | null;
    policyVersion: string | null;
    lifecycleState: string;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
    evidence: EvidenceItem[];
    latestProposal?: LinkedProposalSummary | null;
}

interface DiagnosticsSummary {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byLifecycleState?: Record<string, number>;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface SiteOption {
    id: string;
    domain: string;
    hasGithub: boolean;
}

interface SiteCapabilities {
    hasGithub: boolean;
    gscConnected: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Activity; label: string }> = {
    FAIL: { color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", icon: XCircle, label: "Failing" },
    WARNING: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: AlertTriangle, label: "Warning" },
    PASS: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2, label: "Passed" },
    UNKNOWN: { color: "text-zinc-400", bg: "bg-zinc-500/10 border-zinc-500/20", icon: Clock, label: "Unknown" },
    NOT_APPLICABLE: { color: "text-zinc-500", bg: "bg-zinc-500/10 border-zinc-500/20", icon: Shield, label: "N/A" },
    BLOCKED: { color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", icon: Shield, label: "Blocked" },
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; dot: string }> = {
    critical: { color: "text-rose-300", bg: "bg-rose-500/10 border-rose-500/25", dot: "bg-rose-400" },
    high: { color: "text-orange-300", bg: "bg-orange-500/10 border-orange-500/25", dot: "bg-orange-400" },
    medium: { color: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/25", dot: "bg-amber-400" },
    low: { color: "text-zinc-400", bg: "bg-zinc-500/10 border-zinc-500/25", dot: "bg-zinc-400" },
};

const LIFECYCLE_LABELS: Record<string, string> = {
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    RESOLVED: "Resolved",
    REGRESSED: "Regressed",
};

const REMEDIATION_LABELS: Record<string, string> = {
    DETERMINISTIC: "Deterministic fix",
    AI_PATCH: "AI auto-fix",
    EXPERIMENT: "Experiment",
    MANUAL: "Manual action",
};

const REMEDIATION_FILTER_OPTIONS = [
    { key: "DETERMINISTIC", label: "Instant fix" },
    { key: "AI_PATCH", label: "AI patch" },
    { key: "MANUAL", label: "Manual" },
];

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function truncate(str: string, len: number): string {
    return str.length <= len ? str : str.slice(0, len) + "…";
}

function formatIssueLabel(issueType: string): string {
    return issueType.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim();
}

// ── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({
    summary,
    statusFilter,
    severityFilter,
    onToggleStatus,
    onToggleSeverity,
    onResetAll,
}: {
    summary: DiagnosticsSummary;
    statusFilter: string[];
    severityFilter: string[];
    onToggleStatus: (status: string) => void;
    onToggleSeverity: (severity: string) => void;
    onResetAll: () => void;
}) {
    const { byStatus, bySeverity, total } = summary;

    const cards = [
        {
            label: "Total Findings",
            value: total,
            icon: Microscope,
            color: "text-foreground",
            gradient: "from-zinc-500/20 to-zinc-800/20",
            pressed: statusFilter.length === 0 && severityFilter.length === 0,
            onClick: onResetAll,
        },
        {
            label: "Failing",
            value: byStatus.FAIL ?? 0,
            icon: XCircle,
            color: "text-rose-400",
            gradient: "from-rose-500/10 to-rose-800/10",
            pressed: statusFilter.includes("FAIL"),
            onClick: () => onToggleStatus("FAIL"),
        },
        {
            label: "Warnings",
            value: byStatus.WARNING ?? 0,
            icon: AlertTriangle,
            color: "text-amber-400",
            gradient: "from-amber-500/10 to-amber-800/10",
            pressed: statusFilter.includes("WARNING"),
            onClick: () => onToggleStatus("WARNING"),
        },
        {
            label: "Resolved",
            value: byStatus.PASS ?? 0,
            icon: CheckCircle2,
            color: "text-emerald-400",
            gradient: "from-emerald-500/10 to-emerald-800/10",
            pressed: statusFilter.includes("PASS"),
            onClick: () => onToggleStatus("PASS"),
        },
        {
            label: "Critical",
            value: bySeverity.critical ?? 0,
            icon: Zap,
            color: "text-rose-300",
            gradient: "from-rose-500/15 to-rose-900/10",
            pressed: severityFilter.includes("critical"),
            onClick: () => onToggleSeverity("critical"),
        },
        {
            label: "High",
            value: bySeverity.high ?? 0,
            icon: ArrowUpRight,
            color: "text-orange-300",
            gradient: "from-orange-500/10 to-orange-900/10",
            pressed: severityFilter.includes("high"),
            onClick: () => onToggleSeverity("high"),
        },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((c) => {
                const Icon = c.icon;
                return (
                    <button
                        type="button"
                        key={c.label}
                        id={`diagnostic-summary-${c.label.toLowerCase().replace(/\s/g, "-")}`}
                        aria-pressed={c.pressed}
                        onClick={c.onClick}
                        className={`relative text-left overflow-hidden rounded-xl border bg-gradient-to-br ${c.gradient} p-4 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                            c.pressed
                                ? "border-emerald-500/50 ring-1 ring-emerald-500/30"
                                : "border-border/60 hover:border-border"
                        }`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <Icon className={`w-4 h-4 ${c.color}`} aria-hidden="true" />
                            <span className={`text-2xl font-black tabular-nums ${c.color}`}>
                                {c.value}
                            </span>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                            {c.label}
                        </p>
                    </button>
                );
            })}
        </div>
    );
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
    statusFilter,
    severityFilter,
    lifecycleFilter,
    remediationFilter,
    searchQuery,
    hasActiveFilters,
    onStatusChange,
    onSeverityChange,
    onLifecycleChange,
    onRemediationChange,
    onSearchChange,
    onClearAll,
}: {
    statusFilter: string[];
    severityFilter: string[];
    lifecycleFilter: string[];
    remediationFilter: string[];
    searchQuery: string;
    hasActiveFilters: boolean;
    onStatusChange: (s: string[]) => void;
    onSeverityChange: (s: string[]) => void;
    onLifecycleChange: (s: string[]) => void;
    onRemediationChange: (s: string[]) => void;
    onSearchChange: (q: string) => void;
    onClearAll: () => void;
}) {
    const toggleValue = (list: string[], val: string, setter: (next: string[]) => void) => {
        if (list.includes(val)) setter(list.filter((x) => x !== val));
        else setter([...list, val]);
    };

    return (
        <search
            aria-label="Filter diagnostic findings"
            className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/40 p-3.5"
        >
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <div className="relative flex-1 min-w-0">
                    <label htmlFor="diagnostic-search" className="sr-only">
                        Search diagnostic findings
                    </label>
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                        aria-hidden="true"
                    />
                    <input
                        id="diagnostic-search"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Search findings, root causes, URLs…"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        className="w-full pl-9 pr-8 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-all"
                    />
                    {searchQuery.length > 0 && (
                        <button
                            type="button"
                            onClick={() => onSearchChange("")}
                            aria-label="Clear search query"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-emerald-400"
                        >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    )}
                </div>

                {hasActiveFilters && (
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors shrink-0"
                    >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        Clear filters
                    </button>
                )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
                <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-0.5" aria-hidden="true" />
                {["FAIL", "WARNING", "PASS"].map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    const active = statusFilter.includes(s);
                    return (
                        <button
                            type="button"
                            key={s}
                            id={`diagnostic-filter-status-${s.toLowerCase()}`}
                            aria-pressed={active}
                            onClick={() => toggleValue(statusFilter, s, onStatusChange)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                                active
                                    ? `${cfg.bg} ${cfg.color} border-current`
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {cfg.label}
                        </button>
                    );
                })}

                <span className="w-px h-4 bg-border mx-1" aria-hidden="true" />

                {["critical", "high", "medium", "low"].map((s) => {
                    const cfg = SEVERITY_CONFIG[s];
                    const active = severityFilter.includes(s);
                    return (
                        <button
                            type="button"
                            key={s}
                            id={`diagnostic-filter-severity-${s}`}
                            aria-pressed={active}
                            onClick={() => toggleValue(severityFilter, s, onSeverityChange)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                                active
                                    ? `${cfg.bg} ${cfg.color} border-current`
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {s}
                        </button>
                    );
                })}

                <span className="w-px h-4 bg-border mx-1" aria-hidden="true" />

                {(["OPEN", "IN_PROGRESS", "RESOLVED", "REGRESSED"] as const).map((lc) => {
                    const active = lifecycleFilter.includes(lc);
                    return (
                        <button
                            type="button"
                            key={lc}
                            id={`diagnostic-filter-lifecycle-${lc.toLowerCase()}`}
                            aria-pressed={active}
                            onClick={() => toggleValue(lifecycleFilter, lc, onLifecycleChange)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                                active
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {LIFECYCLE_LABELS[lc] ?? lc}
                        </button>
                    );
                })}

                <span className="w-px h-4 bg-border mx-1" aria-hidden="true" />

                {REMEDIATION_FILTER_OPTIONS.map((opt) => {
                    const active = remediationFilter.includes(opt.key);
                    return (
                        <button
                            type="button"
                            key={opt.key}
                            id={`diagnostic-filter-remediation-${opt.key.toLowerCase()}`}
                            aria-pressed={active}
                            onClick={() => toggleValue(remediationFilter, opt.key, onRemediationChange)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                                active
                                    ? "bg-primary/15 text-primary border-primary/40"
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </search>
    );
}

// ── Evidence Trail ───────────────────────────────────────────────────────────

function EvidenceTrail({ evidence }: { evidence: EvidenceItem[] }) {
    if (evidence.length === 0) {
        return (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
                No evidence records collected yet.
            </div>
        );
    }

    return (
        <div className="border-t border-border/50">
            <div className="px-4 py-2 bg-muted/20">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Evidence Trail ({evidence.length})
                </h4>
            </div>
            <div className="divide-y divide-border/30">
                {evidence.map((ev) => {
                    const sourceColor = EVIDENCE_SOURCE_COLORS[ev.source] ?? "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
                    const observedValue = ev.observedValue;
                    const verificationType = (observedValue as Record<string, unknown> | null)?.verificationType as string | undefined;

                    return (
                        <div key={ev.id} className="px-4 py-2.5 flex items-start gap-3 group hover:bg-muted/10 transition-colors">
                            <div className="flex flex-col items-center pt-1 shrink-0">
                                <div className="w-2 h-2 rounded-full bg-emerald-400/60 ring-2 ring-emerald-500/20" />
                                <div className="w-px h-full bg-border/40 mt-1" />
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${sourceColor}`}>
                                        {ev.source}
                                    </span>
                                    {verificationType && (
                                        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium text-blue-300 bg-blue-500/10 border border-blue-500/20">
                                            {verificationType.replace(/_/g, " ")}
                                        </span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground">
                                        {formatTimeAgo(ev.observedAt)}
                                    </span>
                                    <span className="text-[10px] font-mono text-muted-foreground/60">
                                        conf: {(ev.confidence * 100).toFixed(0)}%
                                    </span>
                                </div>
                                {ev.url && (
                                    <p className="text-[11px] text-muted-foreground font-mono truncate mb-1">
                                        {ev.url}
                                    </p>
                                )}
                                {observedValue && (
                                    <details className="group/details">
                                        <summary className="text-[11px] text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors select-none">
                                            View observed data
                                        </summary>
                                        <pre className="mt-1 p-2 rounded-lg bg-black/40 border border-border/40 text-[10px] text-muted-foreground font-mono overflow-x-auto max-h-32 scrollbar-thin">
                                            {JSON.stringify(observedValue, null, 2)}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Finding Row ──────────────────────────────────────────────────────────────

function FindingRow({
    finding,
    siteDomain,
    capabilities,
    selected,
    onToggleSelect,
    initialExpanded = false,
    onVerified,
    onFilterByIssue,
}: {
    finding: DiagnosticFinding;
    siteDomain: string;
    capabilities: SiteCapabilities;
    selected: boolean;
    onToggleSelect: (id: string) => void;
    initialExpanded?: boolean;
    onVerified?: () => void;
    onFilterByIssue?: (query: string) => void;
}) {
    const [expanded, setExpanded] = useState(initialExpanded);
    const [fixTriggerSeq, setFixTriggerSeq] = useState(0);
    const [verifyTriggerSeq, setVerifyTriggerSeq] = useState(0);
    const rowRef = useRef<HTMLDivElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (initialExpanded && rowRef.current) {
            rowRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [initialExpanded]);

    const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.UNKNOWN;
    const severityCfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.medium;
    const StatusIcon = statusCfg.icon;
    const humanIssueLabel = formatIssueLabel(finding.issueType);
    const primaryUrl = finding.scopeUrls[0] ?? null;

    const hasPr = Boolean(finding.latestProposal?.prUrl);
    const fixButtonText =
        finding.remediationType === "DETERMINISTIC"
            ? capabilities.hasGithub
                ? "Auto-fix"
                : "Get patch"
            : finding.remediationType === "AI_PATCH"
              ? "Auto-fix"
              : "Guide";

    const handleQuickFix = () => {
        setExpanded(true);
        setFixTriggerSeq((n) => n + 1);
    };

    const handleQuickVerify = () => {
        setExpanded(true);
        setVerifyTriggerSeq((n) => n + 1);
    };

    return (
        <div
            ref={rowRef}
            id={`diagnostic-finding-${finding.id}`}
            className={`rounded-xl border transition-all duration-200 ${
                expanded
                    ? "border-emerald-500/30 bg-card shadow-lg shadow-emerald-500/5"
                    : "border-border/60 bg-card/60 hover:border-border hover:bg-card"
            }`}
        >
            {/* Header bar: checkbox + expand trigger + separate trailing actions (no nested interactive controls) */}
            <div className="px-4 py-3.5 flex items-center gap-3">
                <label className="flex items-center shrink-0 cursor-pointer p-1 rounded focus-within:outline-2 focus-within:outline-emerald-400">
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect(finding.id)}
                        className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                    />
                    <span className="sr-only">Select {humanIssueLabel}</span>
                </label>

                <button
                    type="button"
                    onClick={() => setExpanded((p) => !p)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className="flex-1 min-w-0 text-left flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                    <StatusIcon className={`w-4 h-4 shrink-0 ${statusCfg.color}`} aria-hidden="true" />

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">
                                {humanIssueLabel}
                            </span>
                            <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${severityCfg.bg} ${severityCfg.color} capitalize`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${severityCfg.dot}`} aria-hidden="true" />
                                {finding.severity}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${statusCfg.bg} ${statusCfg.color}`}>
                                {statusCfg.label}
                            </span>
                            {finding.lifecycleState && (
                                <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                        finding.lifecycleState === "RESOLVED"
                                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                            : finding.lifecycleState === "OPEN"
                                              ? "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"
                                              : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                                    }`}
                                >
                                    {finding.lifecycleState}
                                </span>
                            )}
                            {finding.latestProposal?.status && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold border text-sky-300 bg-sky-500/10 border-sky-500/20">
                                    Proposal: {finding.latestProposal.status}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {truncate(finding.rootCause, 120)}
                        </p>
                        {primaryUrl && (
                            <p className="text-[10px] font-mono text-muted-foreground/80 truncate mt-0.5">
                                {primaryUrl}
                                {finding.scopeUrls.length > 1 ? ` (+${finding.scopeUrls.length - 1} more)` : ""}
                            </p>
                        )}
                    </div>

                    <div className="hidden md:flex items-center gap-3 shrink-0">
                        {finding.priorityScore !== null && (
                            <div className="text-right">
                                <div className="text-lg font-black tabular-nums text-foreground leading-none">
                                    {finding.priorityScore}
                                </div>
                                <div className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">
                                    Priority
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-1 text-muted-foreground">
                            <span className="text-[10px] font-mono">{finding.evidence.length} ev</span>
                            {expanded ? (
                                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                            ) : (
                                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                            )}
                        </div>
                    </div>
                </button>

                {/* Trailing Quick Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {hasPr && finding.latestProposal?.prUrl ? (
                        <a
                            href={finding.latestProposal.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 transition-colors"
                        >
                            <GitPullRequest className="w-3 h-3" aria-hidden="true" />
                            {finding.latestProposal.prNumber ? `PR #${finding.latestProposal.prNumber}` : "View PR"}
                            <span className="sr-only"> for {humanIssueLabel}</span>
                            <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                        </a>
                    ) : finding.lifecycleState !== "RESOLVED" ? (
                        <button
                            type="button"
                            onClick={handleQuickFix}
                            className="inline-flex items-center gap-1 min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
                        >
                            {finding.remediationType === "MANUAL" ? (
                                <Wrench className="w-3 h-3" aria-hidden="true" />
                            ) : (
                                <Sparkles className="w-3 h-3" aria-hidden="true" />
                            )}
                            {fixButtonText}
                            <span className="sr-only"> for {humanIssueLabel}</span>
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleQuickVerify}
                        className="inline-flex items-center gap-1 min-h-8 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors"
                    >
                        <Shield className="w-3 h-3" aria-hidden="true" />
                        Verify
                        <span className="sr-only"> live for {humanIssueLabel}</span>
                    </button>
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div id={panelId} className="border-t border-border/40">
                    {/* Meta grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
                        <div>
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Scope</div>
                            <div className="text-xs font-semibold text-foreground">{finding.scopeType}</div>
                            {finding.scopeUrls.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                    {finding.scopeUrls.slice(0, 3).map((u, i) => (
                                        <p key={i} className="text-[10px] text-muted-foreground font-mono truncate">{u}</p>
                                    ))}
                                    {finding.scopeUrls.length > 3 && (
                                        <p className="text-[10px] text-muted-foreground">+{finding.scopeUrls.length - 3} more</p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Remediation</div>
                            <div className="text-xs font-semibold text-foreground">
                                {REMEDIATION_LABELS[finding.remediationType] ?? finding.remediationType}
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Confidence</div>
                            <div className="text-xs font-semibold text-foreground">{(finding.confidence * 100).toFixed(0)}%</div>
                        </div>
                        <div>
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">First Seen</div>
                            <div className="text-xs font-semibold text-foreground">{formatTimeAgo(finding.createdAt)}</div>
                            {finding.resolvedAt && (
                                <div className="text-[10px] text-emerald-400 mt-0.5">
                                    Resolved {formatTimeAgo(finding.resolvedAt)}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Fix Action Panel */}
                    <div className="px-4 pb-3">
                        <FindingFixPanel
                            finding={finding}
                            hasGithub={capabilities.hasGithub}
                            triggerSeq={fixTriggerSeq}
                            onFixProgressed={onVerified}
                            onRequestLiveVerify={handleQuickVerify}
                        />
                    </div>

                    {/* Root cause full */}
                    <div className="px-4 pb-3">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Root Cause</div>
                        <p className="text-xs text-foreground bg-muted/20 border border-border/40 rounded-lg p-3 leading-relaxed">
                            {finding.rootCause}
                        </p>
                    </div>

                    {/* Expected outcome */}
                    <div className="px-4 pb-3">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Expected Outcome</div>
                        <p className="text-xs text-emerald-300 bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 leading-relaxed">
                            {finding.expectedOutcome}
                        </p>
                    </div>

                    {/* Priority components */}
                    {finding.priorityComponents && (
                        <div className="px-4 pb-3">
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                                Priority Breakdown ({finding.policyVersion ?? "—"})
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(finding.priorityComponents).map(([key, val]) => (
                                    <div
                                        key={key}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/30 border border-border/40"
                                    >
                                        <span className="text-[10px] text-muted-foreground capitalize">
                                            {key.replace(/([A-Z])/g, " $1").trim()}
                                        </span>
                                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-400 rounded-full transition-all"
                                                style={{ width: `${Math.round((val as number) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] font-bold tabular-nums text-foreground">
                                            {((val as number) * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Dependencies */}
                    {finding.dependencies.length > 0 && (
                        <div className="px-4 pb-3">
                            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                Blocked By
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {finding.dependencies.map((dep, i) => (
                                    <button
                                        type="button"
                                        key={i}
                                        onClick={() => onFilterByIssue?.(dep)}
                                        className="px-2 py-0.5 rounded-md text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 transition-colors"
                                    >
                                        {truncate(dep, 36)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Evidence trail */}
                    <EvidenceTrail evidence={finding.evidence} />

                    {/* Verification timeline */}
                    <VerificationTimeline
                        findingId={finding.id}
                        scopeUrls={finding.scopeUrls}
                        siteDomain={siteDomain}
                        gscConnected={capabilities.gscConnected}
                        verifyTriggerSeq={verifyTriggerSeq}
                        onVerified={onVerified}
                    />
                </div>
            )}
        </div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const siteIdParam = searchParams?.get("siteId") ?? null;
    const findingIdParam = searchParams?.get("findingId") ?? null;
    const siteSelectId = useId();

    const [findings, setFindings] = useState<DiagnosticFinding[]>([]);
    const [summary, setSummary] = useState<DiagnosticsSummary>({ total: 0, byStatus: {}, bySeverity: {} });
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [activeSiteId, setActiveSiteId] = useState<string>(siteIdParam ?? "");
    const [domain, setDomain] = useState<string>("");
    const [sites, setSites] = useState<SiteOption[]>([]);
    const [capabilities, setCapabilities] = useState<SiteCapabilities>({ hasGithub: false, gscConnected: false });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [severityFilter, setSeverityFilter] = useState<string[]>([]);
    const [lifecycleFilter, setLifecycleFilter] = useState<string[]>([]);
    const [remediationFilter, setRemediationFilter] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [page, setPage] = useState(1);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchVerifying, setBatchVerifying] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
    const [batchSummary, setBatchSummary] = useState<string | null>(null);
    const [batchError, setBatchError] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery((prev) => {
                if (prev !== searchQuery.trim()) {
                    setPage(1);
                }
                return searchQuery.trim();
            });
        }, 250);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const fetchData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (siteIdParam) params.set("siteId", siteIdParam);
            if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
            if (severityFilter.length > 0) params.set("severity", severityFilter.join(","));
            if (lifecycleFilter.length > 0) params.set("lifecycleState", lifecycleFilter.join(","));
            if (remediationFilter.length > 0) params.set("remediationType", remediationFilter.join(","));
            if (debouncedQuery.length > 0) params.set("q", debouncedQuery);
            params.set("page", String(page));
            params.set("limit", "20");

            const res = await fetch(`/api/diagnostics?${params.toString()}`, { credentials: "include" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            const data = await res.json();
            setFindings(data.findings ?? []);
            setSummary(data.summary ?? { total: 0, byStatus: {}, bySeverity: {} });
            setPagination(data.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 });
            setDomain(data.domain ?? "");
            if (data.siteId) setActiveSiteId(data.siteId);
            if (Array.isArray(data.sites)) setSites(data.sites);
            if (data.siteCapabilities) {
                setCapabilities({
                    hasGithub: Boolean(data.siteCapabilities.hasGithub),
                    gscConnected: Boolean(data.siteCapabilities.gscConnected),
                });
            }
        } catch (err) {
            if (!silent) setError((err as Error).message);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [
        siteIdParam,
        statusFilter,
        severityFilter,
        lifecycleFilter,
        remediationFilter,
        debouncedQuery,
        page,
    ]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleSiteSwitch = (nextSiteId: string) => {
        setActiveSiteId(nextSiteId);
        setSelectedIds([]);
        setPage(1);
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("siteId", nextSiteId);
        params.delete("findingId");
        const queryStr = params.toString();
        router.replace(queryStr ? `${pathname}?${queryStr}` : pathname);
    };

    const handleClearAllFilters = () => {
        setStatusFilter([]);
        setSeverityFilter([]);
        setLifecycleFilter([]);
        setRemediationFilter([]);
        setSearchQuery("");
        setDebouncedQuery("");
        setPage(1);
    };

    const toggleSummaryStatus = (s: string) => {
        setPage(1);
        setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    };

    const toggleSummarySeverity = (s: string) => {
        setPage(1);
        setSeverityFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    };

    const handleFilterByDependency = (dep: string) => {
        setSearchQuery(dep);
        setDebouncedQuery(dep);
        setPage(1);
    };

    const visibleIds = findings.map((f) => f.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

    const handleToggleSelectAll = () => {
        if (allVisibleSelected) {
            setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
        } else {
            setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
        }
    };

    const handleToggleRow = (id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleBatchVerify = async () => {
        if (batchVerifying || selectedIds.length === 0) return;

        const queue = [...selectedIds];
        setBatchVerifying(true);
        setBatchProgress({ done: 0, total: queue.length });
        setBatchSummary(null);
        setBatchError(null);

        let passedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < queue.length; i++) {
            const id = queue[i];
            try {
                const res = await fetch(`/api/diagnostics/${id}/verify`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                const body = await res.json().catch(() => ({}));
                if (res.ok && body.outcome === "TECHNICALLY_VERIFIED") {
                    passedCount++;
                } else {
                    failedCount++;
                }
            } catch {
                failedCount++;
            } finally {
                setBatchProgress({ done: i + 1, total: queue.length });
            }
        }

        setBatchVerifying(false);
        setBatchProgress(null);
        setBatchSummary(
            `Verified ${queue.length} selected finding${queue.length === 1 ? "" : "s"} (${passedCount} technically verified, ${failedCount} remaining/partial).`
        );
        await fetchData(true);
    };

    const hasActiveFilters =
        statusFilter.length > 0 ||
        severityFilter.length > 0 ||
        lifecycleFilter.length > 0 ||
        remediationFilter.length > 0 ||
        searchQuery.trim().length > 0;

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-12 fade-in-up mt-2 px-4 sm:px-6">
            <PageHeader
                title="Diagnostic Findings"
                description={
                    domain
                        ? `Evidence-driven SEO diagnostics for ${domain} — root cause analysis, verification status, and evidence trail.`
                        : "Evidence-driven SEO diagnostics with root cause analysis and verification trails."
                }
                category="Diagnostics"
                primaryAction={{
                    label: "Run Audit",
                    href: "/dashboard/audits",
                    icon: Zap,
                }}
            />

            {sites.length > 0 && (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <Globe2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <label htmlFor={siteSelectId} className="text-xs font-medium text-muted-foreground">
                            Site:
                        </label>
                        <select
                            id={siteSelectId}
                            value={activeSiteId}
                            onChange={(e) => handleSiteSwitch(e.target.value)}
                            className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        >
                            {sites.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.domain}
                                    {s.hasGithub ? " (GitHub connected)" : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Summary Cards */}
            {!error && (
                <SummaryCards
                    summary={summary}
                    statusFilter={statusFilter}
                    severityFilter={severityFilter}
                    onToggleStatus={toggleSummaryStatus}
                    onToggleSeverity={toggleSummarySeverity}
                    onResetAll={() => {
                        setStatusFilter([]);
                        setSeverityFilter([]);
                        setPage(1);
                    }}
                />
            )}

            {/* Filters */}
            <FilterBar
                statusFilter={statusFilter}
                severityFilter={severityFilter}
                lifecycleFilter={lifecycleFilter}
                remediationFilter={remediationFilter}
                searchQuery={searchQuery}
                hasActiveFilters={hasActiveFilters}
                onStatusChange={(next) => {
                    setStatusFilter(next);
                    setPage(1);
                }}
                onSeverityChange={(next) => {
                    setSeverityFilter(next);
                    setPage(1);
                }}
                onLifecycleChange={(next) => {
                    setLifecycleFilter(next);
                    setPage(1);
                }}
                onRemediationChange={(next) => {
                    setRemediationFilter(next);
                    setPage(1);
                }}
                onSearchChange={setSearchQuery}
                onClearAll={handleClearAllFilters}
            />

            {/* Batch Selection Bar */}
            {findings.length > 0 && (
                <div
                    role="region"
                    aria-label="Batch diagnostic actions"
                    className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 rounded-xl border border-border/60 bg-card/50"
                >
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={handleToggleSelectAll}
                            className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                        />
                        Select all on page
                        {selectedIds.length > 0 && (
                            <span className="text-muted-foreground">({selectedIds.length} selected)</span>
                        )}
                    </label>

                    <div className="flex items-center gap-2 flex-wrap">
                        {batchProgress && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                                Verifying {batchProgress.done}/{batchProgress.total}…
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => void handleBatchVerify()}
                            aria-disabled={batchVerifying || selectedIds.length === 0}
                            aria-busy={batchVerifying}
                            className="inline-flex items-center gap-1.5 min-h-8 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                        >
                            {batchVerifying ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                                <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            Verify Selected Live
                        </button>
                        {selectedIds.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSelectedIds([])}
                                aria-disabled={batchVerifying}
                                className="px-2.5 py-1 min-h-8 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors aria-disabled:opacity-50"
                            >
                                Deselect all
                            </button>
                        )}
                    </div>
                </div>
            )}

            {batchError && (
                <div
                    role="alert"
                    className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 flex items-center gap-2"
                >
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{batchError}</span>
                </div>
            )}

            {batchSummary && (
                <div
                    role="status"
                    aria-live="polite"
                    className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 flex items-center justify-between gap-2"
                >
                    <span>{batchSummary}</span>
                    <button
                        type="button"
                        onClick={() => setBatchSummary(null)}
                        aria-label="Dismiss batch verification summary"
                        className="p-1 text-emerald-300 hover:text-emerald-100 rounded"
                    >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    <span className="text-sm">Loading diagnostic findings…</span>
                </div>
            )}

            {/* Error state */}
            {!loading && error && (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                            <h2 className="text-sm font-semibold text-rose-200">Unable to load diagnostic findings</h2>
                            <p className="text-xs text-rose-300/90 mt-1">{error}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => void fetchData()}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 transition-colors shrink-0"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && findings.length === 0 && (
                <div className="rounded-xl border border-border/60 bg-card/40 p-10 text-center space-y-3">
                    <Microscope className="w-8 h-8 text-muted-foreground mx-auto" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-foreground">
                        {hasActiveFilters
                            ? "No findings match the active filters"
                            : "No diagnostic findings yet"}
                    </h2>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        {hasActiveFilters
                            ? "Try broadening your search query or clearing one of the active status, severity, or remediation filters."
                            : "Run a site audit to inspect HTML, headers, robots.txt, and Search Console evidence."}
                    </p>
                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={handleClearAllFilters}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 transition-colors"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            )}

            {/* Findings list */}
            {!loading && !error && findings.length > 0 && (
                <div className="space-y-3">
                    {findings.map((finding) => (
                        <FindingRow
                            key={finding.id}
                            finding={finding}
                            siteDomain={domain}
                            capabilities={capabilities}
                            selected={selectedIds.includes(finding.id)}
                            onToggleSelect={handleToggleRow}
                            initialExpanded={findingIdParam === finding.id}
                            onVerified={() => void fetchData(true)}
                            onFilterByIssue={handleFilterByDependency}
                        />
                    ))}
                </div>
            )}

            {/* Pagination */}
            {!loading && !error && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted-foreground tabular-nums">
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (page <= 1) return;
                                setPage((p) => Math.max(1, p - 1));
                            }}
                            aria-disabled={page <= 1}
                            aria-label="Previous page"
                            className="p-2 rounded-lg border border-border bg-card text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (page >= pagination.totalPages) return;
                                setPage((p) => Math.min(pagination.totalPages, p + 1));
                            }}
                            aria-disabled={page >= pagination.totalPages}
                            aria-label="Next page"
                            className="p-2 rounded-lg border border-border bg-card text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
