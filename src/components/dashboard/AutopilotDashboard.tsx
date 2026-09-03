"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  RefreshCw,
  Loader2,
  Filter,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  ArrowUpDown,
} from "lucide-react";
import { PipelineFlow, type PipelineState } from "./autopilot/PipelineFlow";
import { ProposalCard, type ProposalSummary } from "./autopilot/ProposalCard";
import { ProposalDetail } from "./autopilot/ProposalDetail";

// ── Types ───────────────────────────────────────────────────────────────────

interface ProposalDetailFull {
  id: string;
  actionType: string;
  status: string;
  targetUrl: string | null;
  targetModel: string | null;
  safetyTier: number | null;
  riskLevel: string | null;
  confidence: number | null;
  generatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  proposedChanges: any;
  expectedOutcome: string | null;
  verificationCriteria: any;
  reasonRejected: string | null;
  isAiEnhanced: boolean;
  llm: any;
  scoreBreakdown: any;
  evidence: any[];
  decision: any;
  operation: any;
}

// ── Constants ───────────────────────────────────────────────────────────────

const FILTER_TABS = [
  { key: "ALL",       label: "All",        icon: Activity },
  { key: "DRAFT",     label: "Draft",      icon: Clock },
  { key: "READY",     label: "Ready",      icon: Shield },
  { key: "APPROVED",  label: "Approved",   icon: CheckCircle2 },
  { key: "EXECUTING", label: "Executing",  icon: Loader2 },
  { key: "COMPLETED", label: "Completed",  icon: CheckCircle2 },
  { key: "FAILED",    label: "Failed",     icon: XCircle },
];

const SORT_OPTIONS = [
  { key: "createdAt",  label: "Newest First" },
  { key: "confidence", label: "Score" },
  { key: "safetyTier", label: "Safety Tier" },
];

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="metric-card">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0">
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function AutopilotDashboard() {
  const searchParams = useSearchParams();
  const siteId = searchParams.get("siteId");

  // List state
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sort, setSort] = useState("createdAt");
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Detail state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetailFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Pipeline state
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    activeStageId: null,
    completedStages: [],
    selectedStageId: null,
  });

  // ── Fetch proposals ────────────────────────────────────────────────────

  const fetchProposals = useCallback(async () => {
    if (!siteId) return;
    try {
      const params = new URLSearchParams({
        siteId,
        limit: "50",
        sort,
        order: "desc",
      });
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const res = await fetch(`/api/proposals?${params}`);
      if (!res.ok) throw new Error("Failed to fetch proposals");
      const data = await res.json();

      setProposals(data.proposals ?? []);
      setStatusCounts(data.statusCounts ?? {});
      setTotal(data.total ?? 0);
      setError(null);

      // Derive pipeline state from status counts
      const counts = data.statusCounts ?? {};
      const hasExecuting = (counts["EXECUTING"] ?? 0) > 0;
      const hasApproved = (counts["APPROVED"] ?? 0) > 0;
      const hasDraft = (counts["DRAFT"] ?? 0) > 0 || (counts["READY"] ?? 0) > 0;
      const hasCompleted = (counts["COMPLETED"] ?? 0) > 0 || (counts["VERIFIED"] ?? 0) > 0;

      const completedStages: string[] = [];
      if (hasCompleted) completedStages.push("discovery", "scoring", "planning", "llm", "draft", "authorized", "executing", "verified");
      else if (hasExecuting) completedStages.push("discovery", "scoring", "planning", "llm", "draft", "authorized");
      else if (hasApproved) completedStages.push("discovery", "scoring", "planning", "llm", "draft");
      else if (hasDraft) completedStages.push("discovery", "scoring", "planning", "llm");

      const activeStageId = hasExecuting
        ? "executing"
        : hasApproved
          ? "authorized"
          : hasDraft
            ? "draft"
            : data.total > 0
              ? "discovery"
              : null;

      setPipelineState((prev) => ({
        ...prev,
        activeStageId,
        completedStages,
      }));
    } catch {
      setError("Could not load proposals.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [siteId, statusFilter, sort]);

  useEffect(() => {
    setLoading(true);
    fetchProposals();
  }, [fetchProposals]);

  // ── Fetch detail ───────────────────────────────────────────────────────

  async function loadDetail(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/proposals/${id}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setDetail(data.proposal);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!selectedId) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/proposals/${selectedId}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Approval failed");
        return;
      }
      await loadDetail(selectedId);
      await fetchProposals();
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!selectedId) return;
    const reason = prompt("Rejection reason (optional):");
    if (reason === null) return; // cancelled
    setRejecting(true);
    try {
      const res = await fetch(`/api/proposals/${selectedId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Rejection failed");
        return;
      }
      await loadDetail(selectedId);
      await fetchProposals();
    } finally {
      setRejecting(false);
    }
  }

  function handleRefresh() {
    setRefreshing(true);
    fetchProposals();
  }

  function handlePipelineStageClick(stageId: string) {
    setPipelineState((prev) => ({
      ...prev,
      selectedStageId: prev.selectedStageId === stageId ? null : stageId,
    }));
  }

  // ── No site ────────────────────────────────────────────────────────────

  if (!siteId) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <Bot className="w-12 h-12 text-muted-foreground/20" />
        <p className="text-muted-foreground text-sm">Select a site to view the Autopilot Command Center.</p>
      </div>
    );
  }

  // ── Derived stats ──────────────────────────────────────────────────────

  const draftCount = (statusCounts["DRAFT"] ?? 0) + (statusCounts["READY"] ?? 0);
  const activeCount = (statusCounts["EXECUTING"] ?? 0) + (statusCounts["APPROVED"] ?? 0);
  const completedCount = (statusCounts["COMPLETED"] ?? 0) + (statusCounts["VERIFIED"] ?? 0);
  const failedCount = (statusCounts["FAILED"] ?? 0) + (statusCounts["REJECTED"] ?? 0);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted/30 border border-border flex items-center justify-center">
            <Bot className="w-5 h-5 text-foreground/70" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Autopilot Command Center
            </h1>
            <p className="text-muted-foreground text-xs mt-0.5">
              Autonomous pipeline monitoring & authorization
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="btn-secondary text-xs gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Stats Row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Proposals" value={total} icon={Activity} color="text-foreground" />
        <StatCard label="Pending" value={draftCount} icon={Clock} color="text-blue-400" />
        <StatCard label="Active" value={activeCount} icon={Shield} color="text-cyan-400" />
        <StatCard label="Completed" value={completedCount} icon={CheckCircle2} color="text-emerald-400" />
      </div>

      {/* ── Pipeline Flow ───────────────────────────────────────────────── */}
      <PipelineFlow state={pipelineState} onStageClick={handlePipelineStageClick} />

      {/* ── Filter + Sort Bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
          {FILTER_TABS.map((tab) => {
            const count = tab.key === "ALL" ? total : (statusCounts[tab.key] ?? 0);
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setStatusFilter(tab.key);
                  setSelectedId(null);
                }}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-colors whitespace-nowrap
                  ${isActive
                    ? "bg-brand/15 border-brand/30 text-brand"
                    : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
                  }
                `}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-brand/20" : "bg-white/5"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sort dropdown */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
          >
            <ArrowUpDown className="w-3 h-3" />
            {SORT_OPTIONS.find((s) => s.key === sort)?.label ?? "Sort"}
          </button>
          {showSortMenu && (
            <>
              <button
                className="fixed inset-0 z-10"
                onClick={() => setShowSortMenu(false)}
                aria-label="Close sort menu"
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSort(opt.key);
                      setShowSortMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      sort === opt.key
                        ? "bg-accent text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/15 rounded-lg px-3 py-2 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Main Content: List + Detail ─────────────────────────────────── */}
      <div className="flex gap-4 min-h-[500px]">
        {/* Proposals list */}
        <div className={`flex-1 flex flex-col gap-2 transition-all ${selectedId ? "max-w-[55%]" : ""}`}>
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-20">
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              <span className="text-sm text-muted-foreground">Loading proposals…</span>
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <Bot className="w-12 h-12 text-muted-foreground/15" />
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  {statusFilter !== "ALL"
                    ? `No proposals with status "${statusFilter}"`
                    : "No proposals yet"
                  }
                </p>
                <p className="text-xs text-muted-foreground/50">
                  The autonomous pipeline will create proposals when it discovers optimization opportunities.
                </p>
              </div>
            </div>
          ) : (
            proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                isSelected={selectedId === proposal.id}
                onClick={() => loadDetail(proposal.id)}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="w-[45%] shrink-0 card-surface p-5 overflow-y-auto max-h-[800px] sticky top-4">
            {detailLoading ? (
              <div className="flex items-center justify-center gap-3 py-12">
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                <span className="text-sm text-muted-foreground">Loading details…</span>
              </div>
            ) : (
              <ProposalDetail
                proposal={detail}
                onClose={() => setSelectedId(null)}
                onApprove={handleApprove}
                onReject={handleReject}
                approving={approving}
                rejecting={rejecting}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Footer info ─────────────────────────────────────────────────── */}
      {!loading && proposals.length > 0 && (
        <div className="text-[10px] text-muted-foreground/40 py-2">
          Showing {proposals.length} of {total} proposals
        </div>
      )}
    </div>
  );
}
