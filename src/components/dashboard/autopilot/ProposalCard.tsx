"use client";

import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Sparkles,
  Settings2,
  ArrowRight,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProposalSummary {
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
  isAiEnhanced: boolean;
  llmOutcome: string;
  llmConfidence: number | null;
  decision: {
    id: string;
    url: string | null;
    primaryKeyword: string | null;
    action: string | null;
    opportunityStatus: string | null;
    score: number | null;
  } | null;
}

// ── Status Config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof Clock }> = {
  DRAFT:          { color: "text-blue-400",     bg: "bg-blue-500/10",     border: "status-border-draft",     icon: Clock },
  READY:          { color: "text-violet-400",   bg: "bg-violet-500/10",   border: "status-border-ready",     icon: Shield },
  APPROVED:       { color: "text-emerald-400",  bg: "bg-emerald-500/10",  border: "status-border-approved",  icon: CheckCircle2 },
  EXECUTING:      { color: "text-cyan-400",     bg: "bg-cyan-500/10",     border: "status-border-executing", icon: Loader2 },
  COMPLETED:      { color: "text-emerald-400",  bg: "bg-emerald-500/10",  border: "status-border-completed", icon: CheckCircle2 },
  VERIFIED:       { color: "text-emerald-400",  bg: "bg-emerald-500/10",  border: "status-border-completed", icon: CheckCircle2 },
  FAILED:         { color: "text-rose-400",     bg: "bg-rose-500/10",     border: "status-border-failed",    icon: XCircle },
  REJECTED:       { color: "text-rose-400",     bg: "bg-rose-500/10",     border: "status-border-rejected",  icon: XCircle },
  EXPIRED:        { color: "text-zinc-400",     bg: "bg-zinc-500/10",     border: "status-border-failed",    icon: Clock },
  CANCELLED:      { color: "text-zinc-400",     bg: "bg-zinc-500/10",     border: "status-border-failed",    icon: XCircle },
};

const SAFETY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "LOW",      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  2: { label: "MEDIUM",   color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  3: { label: "HIGH",     color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  4: { label: "CRITICAL", color: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatActionType(type: string): string {
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

// ── Component ───────────────────────────────────────────────────────────────

export function ProposalCard({
  proposal,
  isSelected,
  onClick,
  animationDelay = 0,
}: {
  proposal: ProposalSummary;
  isSelected: boolean;
  onClick: () => void;
  animationDelay?: number;
}) {
  const statusCfg = STATUS_CONFIG[proposal.status] ?? STATUS_CONFIG.DRAFT;
  const StatusIcon = statusCfg.icon;
  const safetyInfo = SAFETY_LABELS[proposal.safetyTier ?? 1] ?? SAFETY_LABELS[1];
  const score = proposal.decision?.score ?? proposal.confidence ?? 0;

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left card-surface p-4 transition-all duration-200
        hover:border-brand/25 hover:shadow-[0_4px_20px_rgba(16,185,129,0.06)]
        ${statusCfg.border}
        ${isSelected ? "border-brand/40 ring-1 ring-brand/20 shadow-[0_4px_20px_rgba(16,185,129,0.08)]" : ""}
        fade-in-up
      `}
      style={{ animationDelay: `${animationDelay}ms` }}
      aria-pressed={isSelected}
    >
      {/* Top row: action type + time */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold text-foreground truncate">
              {formatActionType(proposal.actionType)}
            </span>
            {proposal.decision?.primaryKeyword && (
              <>
                <ArrowRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                  {proposal.decision.primaryKeyword}
                </span>
              </>
            )}
          </div>

          {/* URL */}
          {(proposal.targetUrl || proposal.decision?.url) && (
            <p className="text-[11px] text-muted-foreground/60 truncate mb-2">
              {proposal.targetUrl || proposal.decision?.url}
            </p>
          )}

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-current/20 ${statusCfg.color} ${statusCfg.bg}`}>
              <StatusIcon className={`w-3 h-3 ${proposal.status === "EXECUTING" ? "animate-spin" : ""}`} />
              {proposal.status.replace(/_/g, " ")}
            </span>

            {/* Safety tier badge */}
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${safetyInfo.color}`}>
              <Shield className="w-2.5 h-2.5" />
              T{proposal.safetyTier ?? 1}
            </span>

            {/* AI Enhanced / Deterministic badge */}
            {proposal.isAiEnhanced ? (
              <span className="ai-badge">
                <Sparkles className="w-2.5 h-2.5" />
                AI Enhanced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border border-border">
                <Settings2 className="w-2.5 h-2.5" />
                Deterministic
              </span>
            )}
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pt-0.5">
          {timeAgo(proposal.createdAt)}
        </span>
      </div>

      {/* Score bar */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground/50">Score</span>
          <span className="text-[10px] font-bold text-foreground">{score}/100</span>
        </div>
        <div className="score-bar">
          <div
            className="score-bar-fill"
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </div>
    </button>
  );
}
