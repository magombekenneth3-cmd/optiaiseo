"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
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
    Filter,
    Loader2,
    Microscope,
    Search,
    Shield,
    XCircle,
    Zap,
} from "lucide-react";
import { VerificationTimeline } from "@/components/diagnostics/VerificationTimeline";
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
}

interface DiagnosticsSummary {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Activity; label: string }> = {
    FAIL:           { color: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/20",    icon: XCircle,     label: "Failing" },
    WARNING:        { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",  icon: AlertTriangle, label: "Warning" },
    PASS:           { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2, label: "Passed" },
    UNKNOWN:        { color: "text-zinc-400",    bg: "bg-zinc-500/10 border-zinc-500/20",    icon: Clock,       label: "Unknown" },
    NOT_APPLICABLE: { color: "text-zinc-500",    bg: "bg-zinc-500/10 border-zinc-500/20",    icon: Shield,      label: "N/A" },
    BLOCKED:        { color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/20", icon: Shield,      label: "Blocked" },
};

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; dot: string }> = {
    critical: { color: "text-rose-300",   bg: "bg-rose-500/10 border-rose-500/25",   dot: "bg-rose-400" },
    high:     { color: "text-orange-300", bg: "bg-orange-500/10 border-orange-500/25", dot: "bg-orange-400" },
    medium:   { color: "text-amber-300",  bg: "bg-amber-500/10 border-amber-500/25",  dot: "bg-amber-400" },
    low:      { color: "text-zinc-400",   bg: "bg-zinc-500/10 border-zinc-500/25",    dot: "bg-zinc-400" },
};

const REMEDIATION_LABELS: Record<string, string> = {
    DETERMINISTIC: "Deterministic fix",
    AI_PATCH: "AI auto-fix",
    EXPERIMENT: "Experiment",
    MANUAL: "Manual action",
};

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

// ── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: DiagnosticsSummary }) {
    const { byStatus, bySeverity, total } = summary;

    const cards = [
        {
            label: "Total Findings",
            value: total,
            icon: Microscope,
            color: "text-foreground",
            gradient: "from-zinc-500/20 to-zinc-800/20",
        },
        {
            label: "Failing",
            value: byStatus.FAIL ?? 0,
            icon: XCircle,
            color: "text-rose-400",
            gradient: "from-rose-500/10 to-rose-800/10",
        },
        {
            label: "Warnings",
            value: byStatus.WARNING ?? 0,
            icon: AlertTriangle,
            color: "text-amber-400",
            gradient: "from-amber-500/10 to-amber-800/10",
        },
        {
            label: "Resolved",
            value: byStatus.PASS ?? 0,
            icon: CheckCircle2,
            color: "text-emerald-400",
            gradient: "from-emerald-500/10 to-emerald-800/10",
        },
        {
            label: "Critical",
            value: bySeverity.critical ?? 0,
            icon: Zap,
            color: "text-rose-300",
            gradient: "from-rose-500/15 to-rose-900/10",
        },
        {
            label: "High",
            value: bySeverity.high ?? 0,
            icon: ArrowUpRight,
            color: "text-orange-300",
            gradient: "from-orange-500/10 to-orange-900/10",
        },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((c) => {
                const Icon = c.icon;
                return (
                    <div
                        key={c.label}
                        id={`diagnostic-summary-${c.label.toLowerCase().replace(/\s/g, "-")}`}
                        className={`relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br ${c.gradient} p-4 transition-all hover:border-border`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <Icon className={`w-4 h-4 ${c.color}`} />
                            <span className={`text-2xl font-black tabular-nums ${c.color}`}>
                                {c.value}
                            </span>
                        </div>
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                            {c.label}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
    statusFilter,
    severityFilter,
    searchQuery,
    onStatusChange,
    onSeverityChange,
    onSearchChange,
}: {
    statusFilter: string[];
    severityFilter: string[];
    searchQuery: string;
    onStatusChange: (s: string[]) => void;
    onSeverityChange: (s: string[]) => void;
    onSearchChange: (q: string) => void;
}) {
    const toggleStatus = (s: string) => {
        if (statusFilter.includes(s)) onStatusChange(statusFilter.filter(x => x !== s));
        else onStatusChange([...statusFilter, s]);
    };
    const toggleSeverity = (s: string) => {
        if (severityFilter.includes(s)) onSeverityChange(severityFilter.filter(x => x !== s));
        else onSeverityChange([...severityFilter, s]);
    };

    return (
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                    id="diagnostic-search"
                    type="text"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Search findings…"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 transition-all"
                />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
                <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                {["FAIL", "WARNING", "PASS"].map(s => {
                    const cfg = STATUS_CONFIG[s];
                    const active = statusFilter.includes(s);
                    return (
                        <button
                            key={s}
                            id={`diagnostic-filter-status-${s.toLowerCase()}`}
                            onClick={() => toggleStatus(s)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                                active
                                    ? `${cfg.bg} ${cfg.color} border-current`
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {cfg.label}
                        </button>
                    );
                })}
                <span className="w-px h-4 bg-border mx-1" />
                {["critical", "high", "medium", "low"].map(s => {
                    const cfg = SEVERITY_CONFIG[s];
                    const active = severityFilter.includes(s);
                    return (
                        <button
                            key={s}
                            id={`diagnostic-filter-severity-${s}`}
                            onClick={() => toggleSeverity(s)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all capitalize ${
                                active
                                    ? `${cfg.bg} ${cfg.color} border-current`
                                    : "text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground"
                            }`}
                        >
                            {s}
                        </button>
                    );
                })}
            </div>
        </div>
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
                    const verificationType = (observedValue as any)?.verificationType;

                    return (
                        <div key={ev.id} className="px-4 py-2.5 flex items-start gap-3 group hover:bg-muted/10 transition-colors">
                            {/* Timeline dot */}
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

function FindingRow({ finding, initialExpanded = false }: { finding: DiagnosticFinding; initialExpanded?: boolean }) {
    const [expanded, setExpanded] = useState(initialExpanded);
    const rowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialExpanded && rowRef.current) {
            rowRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [initialExpanded]);

    const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.UNKNOWN;
    const severityCfg = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.medium;
    const StatusIcon = statusCfg.icon;

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
            {/* Main row */}
            <button
                onClick={() => setExpanded(p => !p)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3"
            >
                {/* Status icon */}
                <StatusIcon className={`w-4 h-4 shrink-0 ${statusCfg.color}`} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">
                            {finding.issueType.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${severityCfg.bg} ${severityCfg.color} capitalize`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${severityCfg.dot}`} />
                            {finding.severity}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${statusCfg.bg} ${statusCfg.color}`}>
                            {statusCfg.label}
                        </span>
                        {finding.lifecycleState && (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                finding.lifecycleState === "RESOLVED"
                                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                    : finding.lifecycleState === "OPEN"
                                      ? "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"
                                      : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                            }`}>
                                {finding.lifecycleState}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        {truncate(finding.rootCause, 120)}
                    </p>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-3 shrink-0">
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
                            <ChevronUp className="w-4 h-4" />
                        ) : (
                            <ChevronDown className="w-4 h-4" />
                        )}
                    </div>
                </div>
            </button>

            {/* Expanded detail */}
            {expanded && (
                <div className="border-t border-border/40">
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
                                    <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20">
                                        {truncate(dep, 30)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Evidence trail */}
                    <EvidenceTrail evidence={finding.evidence} />

                    {/* Verification timeline */}
                    <VerificationTimeline findingId={finding.id} />
                </div>
            )}
        </div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
    const searchParams = useSearchParams();
    const siteIdParam = searchParams?.get("siteId") ?? null;
    const findingIdParam = searchParams?.get("findingId") ?? null;

    const [findings, setFindings] = useState<DiagnosticFinding[]>([]);
    const [summary, setSummary] = useState<DiagnosticsSummary>({ total: 0, byStatus: {}, bySeverity: {} });
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
    const [domain, setDomain] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [severityFilter, setSeverityFilter] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (siteIdParam) params.set("siteId", siteIdParam);
            if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
            if (severityFilter.length > 0) params.set("severity", severityFilter.join(","));
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
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, [siteIdParam, statusFilter, severityFilter, page]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Client-side text search filter
    const filtered = searchQuery.trim()
        ? findings.filter(f =>
            f.issueType.toLowerCase().includes(searchQuery.toLowerCase()) ||
            f.rootCause.toLowerCase().includes(searchQuery.toLowerCase()) ||
            f.expectedOutcome.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : findings;

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-12 fade-in-up mt-2 px-4 sm:px-6">
            <PageHeader
                title="Diagnostic Findings"
                description={domain
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

            {/* Summary Cards */}
            {!loading && !error && <SummaryCards summary={summary} />}

            {/* Filters */}
            <FilterBar
                statusFilter={statusFilter}
                severityFilter={severityFilter}
                searchQuery={searchQuery}
                onStatusChange={s => { setStatusFilter(s); setPage(1); }}
                onSeverityChange={s => { setSeverityFilter(s); setPage(1); }}
                onSearchChange={setSearchQuery}
            />

            {/* Loading State */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading diagnostic findings…</p>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="card-surface p-8 text-center border-rose-500/20">
                    <XCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-foreground mb-1">Unable to load diagnostics</h3>
                    <p className="text-sm text-muted-foreground mb-4">{error}</p>
                    <button
                        onClick={fetchData}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Empty State */}
            {!loading && !error && filtered.length === 0 && (
                <div className="card-surface p-12 text-center border-dashed border-border">
                    <Microscope className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <h2 className="text-xl font-semibold mb-2 text-foreground">
                        {summary.total === 0 ? "No diagnostic findings yet" : "No findings match your filters"}
                    </h2>
                    <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
                        {summary.total === 0
                            ? "Run an audit to generate evidence-driven diagnostic findings with root cause analysis and verification trails."
                            : "Try adjusting your status or severity filters to see more findings."
                        }
                    </p>
                </div>
            )}

            {/* Findings List */}
            {!loading && !error && filtered.length > 0 && (
                <div className="flex flex-col gap-3">
                    {filtered.map(f => (
                        <FindingRow key={f.id} finding={f} initialExpanded={f.id === findingIdParam} />
                    ))}
                </div>
            )}

            {/* Pagination */}
            {!loading && !error && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted-foreground">
                        Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                    </p>
                    <div className="flex items-center gap-1.5">
                        <button
                            id="diagnostic-page-prev"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={pagination.page <= 1}
                            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-all"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-medium text-muted-foreground px-2">
                            Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <button
                            id="diagnostic-page-next"
                            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                            disabled={pagination.page >= pagination.totalPages}
                            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-all"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
