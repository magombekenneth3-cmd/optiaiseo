"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock,
    Filter,
    GitBranch,
    Loader2,
    RefreshCw,
    RotateCcw,
    Shield,
    XCircle,
    Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface OperationSummary {
    id: string;
    siteId: string;
    mutationType: string;
    targetModel: string;
    targetId: string;
    actorId: string;
    actorType: string;
    riskLevel: string;
    riskScore: number;
    status: string;
    affectedFields: string[];
    diffSizeBytes: number;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    _count: { effects: number; auditEvents: number };
}

interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Activity }> = {
    PROPOSED:              { color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20",    icon: Clock },
    PENDING_APPROVAL:      { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",  icon: Shield },
    APPROVED:              { color: "text-emerald-400",  bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
    EXECUTING:             { color: "text-cyan-400",     bg: "bg-cyan-500/10 border-cyan-500/20",    icon: Loader2 },
    COMMITTED:             { color: "text-emerald-400",  bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
    EFFECTS_PENDING:       { color: "text-purple-400",   bg: "bg-purple-500/10 border-purple-500/20", icon: Zap },
    COMPLETED:             { color: "text-emerald-400",  bg: "bg-emerald-500/10 border-emerald-500/20", icon: CheckCircle2 },
    REJECTED:              { color: "text-rose-400",     bg: "bg-rose-500/10 border-rose-500/20",    icon: XCircle },
    FAILED:                { color: "text-rose-400",     bg: "bg-rose-500/10 border-rose-500/20",    icon: XCircle },
    STALE:                 { color: "text-zinc-400",     bg: "bg-zinc-500/10 border-zinc-500/20",    icon: Clock },
    CANCELLED:             { color: "text-zinc-400",     bg: "bg-zinc-500/10 border-zinc-500/20",    icon: XCircle },
    ROLLED_BACK:           { color: "text-orange-400",   bg: "bg-orange-500/10 border-orange-500/20", icon: RotateCcw },
    COMPLETED_WITH_ERRORS: { color: "text-amber-400",    bg: "bg-amber-500/10 border-amber-500/20",  icon: AlertTriangle },
    EXPIRED:               { color: "text-zinc-500",     bg: "bg-zinc-500/10 border-zinc-500/20",    icon: Clock },
};

const RISK_COLORS: Record<string, string> = {
    LOW:      "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    MEDIUM:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
    HIGH:     "text-orange-400 bg-orange-500/10 border-orange-500/20",
    CRITICAL: "text-rose-400 bg-rose-500/10 border-rose-500/20",
};

const FILTER_STATUSES = [
    "ALL",
    "PROPOSED",
    "PENDING_APPROVAL",
    "EXECUTING",
    "COMMITTED",
    "EFFECTS_PENDING",
    "COMPLETED",
    "FAILED",
    "ROLLED_BACK",
    "COMPLETED_WITH_ERRORS",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatMutationType(type: string): string {
    return type
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PROPOSED;
    const Icon = cfg.icon;
    return (
        <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}
        >
            <Icon className={`w-3 h-3 ${status === "EXECUTING" ? "animate-spin" : ""}`} />
            {status.replace(/_/g, " ")}
        </span>
    );
}

function RiskBadge({ level }: { level: string }) {
    const cls = RISK_COLORS[level] ?? RISK_COLORS.LOW;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
            {level}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OperationsPage() {
    const searchParams = useSearchParams();
    const siteId = searchParams.get("siteId");

    const [operations, setOperations] = useState<OperationSummary[]>([]);
    const [pagination, setPagination] = useState<Pagination | null>(null);
    const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState("ALL");
    const [page, setPage] = useState(1);
    const [refreshing, setRefreshing] = useState(false);

    // Detail panel
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [rollbackLoading, setRollbackLoading] = useState(false);

    const fetchOperations = useCallback(async () => {
        if (!siteId) return;
        try {
            const params = new URLSearchParams({ siteId, page: String(page), limit: "20" });
            if (filter !== "ALL") params.set("status", filter);
            const res = await fetch(`/api/operations?${params}`);
            if (!res.ok) throw new Error("Failed to fetch operations");
            const data = await res.json();
            setOperations(data.operations);
            setPagination(data.pagination);
            setStatusCounts(data.statusCounts);
            setError(null);
        } catch {
            setError("Could not load operations.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [siteId, page, filter]);

    useEffect(() => {
        setLoading(true);
        fetchOperations();
    }, [fetchOperations]);

    function handleRefresh() {
        setRefreshing(true);
        fetchOperations();
    }

    async function loadDetail(id: string) {
        setSelectedId(id);
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/operations/${id}`);
            if (!res.ok) throw new Error("Failed to load operation detail");
            const data = await res.json();
            setDetail(data);
        } catch {
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }

    async function handleRollback() {
        if (!selectedId || !detail?.canRollback) return;
        if (!confirm("Are you sure you want to rollback this operation? The target will be restored to its pre-mutation state.")) return;
        setRollbackLoading(true);
        try {
            const res = await fetch(`/api/operations/${selectedId}/rollback`, { method: "POST" });
            if (!res.ok) {
                const errData = await res.json();
                alert(errData.error || "Rollback failed");
                return;
            }
            // Refresh
            await loadDetail(selectedId);
            await fetchOperations();
        } finally {
            setRollbackLoading(false);
        }
    }

    // No site selected
    if (!siteId) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
                <Activity className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-muted-foreground text-sm">Select a site to view mutation operations.</p>
            </div>
        );
    }

    const totalOps = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const activeOps = (statusCounts["EXECUTING"] ?? 0) + (statusCounts["EFFECTS_PENDING"] ?? 0);
    const failedOps = (statusCounts["FAILED"] ?? 0) + (statusCounts["COMPLETED_WITH_ERRORS"] ?? 0);

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
                        <Activity className="w-6 h-6 text-emerald-400" />
                        Operations
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Mutation lifecycle: operation → target → actor → status → risk → effects
                    </p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Total Ops", value: totalOps, color: "text-foreground", icon: Activity },
                    { label: "Active", value: activeOps, color: "text-cyan-400", icon: Zap },
                    { label: "Completed", value: statusCounts["COMPLETED"] ?? 0, color: "text-emerald-400", icon: CheckCircle2 },
                    { label: "Failed", value: failedOps, color: "text-rose-400", icon: AlertTriangle },
                ].map((card) => (
                    <div
                        key={card.label}
                        className="card-surface p-4 flex items-center gap-3"
                    >
                        <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                            <card.icon className={`w-4 h-4 ${card.color}`} />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">{card.label}</p>
                            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
                {FILTER_STATUSES.map((s) => {
                    const count = s === "ALL" ? totalOps : (statusCounts[s] ?? 0);
                    const isActive = filter === s;
                    return (
                        <button
                            key={s}
                            onClick={() => { setFilter(s); setPage(1); setSelectedId(null); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-colors whitespace-nowrap ${
                                isActive
                                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                                    : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                            }`}
                        >
                            {s === "ALL" ? "All" : s.replace(/_/g, " ")}
                            {count > 0 && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    isActive ? "bg-emerald-500/20" : "bg-white/5"
                                }`}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {error && (
                <div className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/15 rounded-lg px-3 py-2">
                    {error}
                </div>
            )}

            {/* Main content: list + detail panel */}
            <div className="flex gap-4 min-h-[500px]">
                {/* Operations list */}
                <div className={`flex-1 flex flex-col gap-2 ${selectedId ? "max-w-[55%]" : ""}`}>
                    {loading ? (
                        <div className="flex items-center justify-center gap-3 py-20">
                            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                            <span className="text-sm text-muted-foreground">Loading operations…</span>
                        </div>
                    ) : operations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                            <Activity className="w-10 h-10 text-muted-foreground/20" />
                            <p className="text-muted-foreground text-sm">
                                {filter !== "ALL"
                                    ? `No operations with status "${filter.replace(/_/g, " ")}".`
                                    : "No mutation operations recorded yet."}
                            </p>
                        </div>
                    ) : (
                        <>
                            {operations.map((op) => (
                                <button
                                    key={op.id}
                                    onClick={() => loadDetail(op.id)}
                                    className={`w-full text-left card-surface p-4 hover:border-emerald-500/30 transition-all ${
                                        selectedId === op.id ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : ""
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-semibold text-foreground truncate">
                                                    {formatMutationType(op.mutationType)}
                                                </span>
                                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                                <span className="text-xs text-muted-foreground truncate">
                                                    {op.targetModel}:{op.targetId.slice(0, 8)}…
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <StatusBadge status={op.status} />
                                                <RiskBadge level={op.riskLevel} />
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                                            {timeAgo(op.createdAt)}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground mt-2">
                                        <span className="flex items-center gap-1">
                                            <Shield className="w-3 h-3" />
                                            {op.actorType === "USER" ? op.actorId.slice(0, 8) : op.actorType}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <GitBranch className="w-3 h-3" />
                                            {op.affectedFields.slice(0, 3).join(", ")}
                                            {op.affectedFields.length > 3 && ` +${op.affectedFields.length - 3}`}
                                        </span>
                                        {op._count.effects > 0 && (
                                            <span className="flex items-center gap-1">
                                                <Zap className="w-3 h-3" />
                                                {op._count.effects} effect{op._count.effects !== 1 ? "s" : ""}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}

                            {/* Pagination */}
                            {pagination && pagination.totalPages > 1 && (
                                <div className="flex items-center justify-between pt-3">
                                    <span className="text-xs text-muted-foreground">
                                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            disabled={pagination.page <= 1}
                                            onClick={() => setPage((p) => p - 1)}
                                            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>
                                        <button
                                            disabled={pagination.page >= pagination.totalPages}
                                            onClick={() => setPage((p) => p + 1)}
                                            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Detail panel */}
                {selectedId && (
                    <div className="w-[45%] shrink-0 card-surface p-5 overflow-y-auto max-h-[700px] sticky top-4">
                        {detailLoading ? (
                            <div className="flex items-center justify-center gap-3 py-12">
                                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                                <span className="text-sm text-muted-foreground">Loading details…</span>
                            </div>
                        ) : detail?.operation ? (
                            <OperationDetail
                                operation={detail.operation}
                                canRollback={detail.canRollback}
                                rollbackLoading={rollbackLoading}
                                onRollback={handleRollback}
                                onClose={() => setSelectedId(null)}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                Failed to load operation details.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail Panel
// ─────────────────────────────────────────────────────────────────────────────

function OperationDetail({
    operation,
    canRollback,
    rollbackLoading,
    onRollback,
    onClose,
}: {
    operation: any;
    canRollback: boolean;
    rollbackLoading: boolean;
    onRollback: () => void;
    onClose: () => void;
}) {
    const [showSnapshot, setShowSnapshot] = useState(false);

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-base font-bold">
                        {formatMutationType(operation.mutationType)}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {operation.targetModel}:{operation.targetId}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    aria-label="Close detail panel"
                >
                    <XCircle className="w-4 h-4" />
                </button>
            </div>

            {/* Status + Risk */}
            <div className="flex flex-wrap gap-2">
                <StatusBadge status={operation.status} />
                <RiskBadge level={operation.riskLevel} />
                <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                    Score: {operation.riskScore}/100
                </span>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                    <p className="text-muted-foreground mb-0.5">Actor</p>
                    <p className="font-medium">{operation.actorType === "USER" ? operation.actorId.slice(0, 12) : operation.actorType}</p>
                </div>
                <div>
                    <p className="text-muted-foreground mb-0.5">Created</p>
                    <p className="font-medium">{new Date(operation.createdAt).toLocaleString()}</p>
                </div>
                {operation.approvedBy && (
                    <>
                        <div>
                            <p className="text-muted-foreground mb-0.5">Approved by</p>
                            <p className="font-medium">{operation.approvedBy.slice(0, 12)}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground mb-0.5">Approved at</p>
                            <p className="font-medium">{new Date(operation.approvedAt).toLocaleString()}</p>
                        </div>
                    </>
                )}
                <div>
                    <p className="text-muted-foreground mb-0.5">Affected Fields</p>
                    <p className="font-medium">{operation.affectedFields.join(", ") || "—"}</p>
                </div>
                <div>
                    <p className="text-muted-foreground mb-0.5">Diff Size</p>
                    <p className="font-medium">{operation.diffSizeBytes > 0 ? `${(operation.diffSizeBytes / 1024).toFixed(1)} KB` : "—"}</p>
                </div>
            </div>

            {/* Snapshot */}
            {operation.snapshot && (
                <div>
                    <button
                        onClick={() => setShowSnapshot(!showSnapshot)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                    >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showSnapshot ? "rotate-90" : ""}`} />
                        Snapshot (before/after)
                    </button>
                    {showSnapshot && (
                        <div className="mt-2 grid grid-cols-1 gap-2">
                            <div>
                                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase">Before</p>
                                <pre className="text-[10px] bg-[#0d1117] rounded-lg p-3 border border-border overflow-x-auto max-h-40 text-muted-foreground">
                                    {JSON.stringify(operation.snapshot.beforeState, null, 2)}
                                </pre>
                            </div>
                            {operation.snapshot.afterState && (
                                <div>
                                    <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase">After</p>
                                    <pre className="text-[10px] bg-[#0d1117] rounded-lg p-3 border border-border overflow-x-auto max-h-40 text-muted-foreground">
                                        {JSON.stringify(operation.snapshot.afterState, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Effects */}
            {operation.effects?.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-purple-400" />
                        Effects ({operation.effects.length})
                    </h3>
                    <div className="space-y-2">
                        {operation.effects.map((eff: any) => (
                            <div key={eff.id} className="rounded-lg bg-[#0d1117] border border-border p-3">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-semibold">{eff.effectType}</span>
                                    <StatusBadge status={eff.status} />
                                </div>
                                <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                                    {eff.platform && <span>Platform: {eff.platform}</span>}
                                    <span>Attempts: {eff.attempts}/{eff.maxAttempts}</span>
                                    <span>Compensation: {eff.compensationPolicy}</span>
                                    {eff.externalId && <span className="truncate max-w-[180px]">Ext: {eff.externalId}</span>}
                                </div>
                                {eff.externalError && (
                                    <p className="text-[10px] text-rose-400 mt-1 truncate">{eff.externalError}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Audit Trail */}
            {operation.auditEvents?.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-400" />
                        Audit Trail ({operation.auditEvents.length})
                    </h3>
                    <div className="relative pl-4 border-l border-border space-y-3">
                        {operation.auditEvents.map((evt: any) => (
                            <div key={evt.id} className="relative">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-border border-2 border-[#161b22]" />
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-[11px] font-semibold">{evt.eventType}</span>
                                    <span className="text-[10px] text-muted-foreground">{timeAgo(evt.createdAt)}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    Actor: {evt.actorId.slice(0, 12)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Rollback button */}
            {canRollback && (
                <div className="pt-2 border-t border-border">
                    <button
                        onClick={onRollback}
                        disabled={rollbackLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                    >
                        {rollbackLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <RotateCcw className="w-4 h-4" />
                        )}
                        Rollback to Pre-Mutation State
                    </button>
                    <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                        Restores the target to its snapshot before this mutation was applied.
                    </p>
                </div>
            )}
        </div>
    );
}
