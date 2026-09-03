"use client";

import { useState } from "react";
import {
  XCircle,
  Shield,
  Sparkles,
  Settings2,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Eye,
  Target,
  Zap,
  TrendingUp,
  BarChart3,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  finalScore: number;
  impactScore: number;
  confidenceScore: number;
  urgencyScore: number;
  decision: string;
  scoringVersion: string;
}

interface Evidence {
  id: string;
  type: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
}

interface LLMInfo {
  outcome: string;
  confidence: number | null;
  fallbackUsed: boolean;
  validationVerdict: string | null;
  promptVersion: string | null;
  timestamp: string | null;
}

interface ProposalFull {
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
  llm: LLMInfo | null;
  scoreBreakdown: ScoreBreakdown | null;
  evidence: Evidence[];
  decision: any;
  operation: any;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatActionType(type: string): string {
  return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
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

const SAFETY_CONFIG: Record<number, { label: string; color: string; warning: string }> = {
  1: { label: "Tier 1 — LOW",      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", warning: "" },
  2: { label: "Tier 2 — MEDIUM",   color: "text-amber-400 bg-amber-500/10 border-amber-500/20",      warning: "" },
  3: { label: "Tier 3 — HIGH",     color: "text-orange-400 bg-orange-500/10 border-orange-500/20",    warning: "⚠ High safety tier — review changes carefully before approving." },
  4: { label: "Tier 4 — CRITICAL", color: "text-rose-400 bg-rose-500/10 border-rose-500/20",          warning: "🚨 Critical safety tier — approval requires careful verification of all proposed changes." },
};

// ── Component ───────────────────────────────────────────────────────────────

export function ProposalDetail({
  proposal,
  onClose,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  proposal: ProposalFull | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
}) {
  const [showChanges, setShowChanges] = useState(true);
  const [showEvidence, setShowEvidence] = useState(true);
  const [confirmApprove, setConfirmApprove] = useState(false);

  if (!proposal) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <Eye className="w-10 h-10 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">Select a proposal to view details</p>
      </div>
    );
  }

  const safetyInfo = SAFETY_CONFIG[proposal.safetyTier ?? 1] ?? SAFETY_CONFIG[1];
  const score = proposal.scoreBreakdown;
  const changes = Array.isArray(proposal.proposedChanges) ? proposal.proposedChanges : [];
  const canAuthorize = proposal.status === "DRAFT" || proposal.status === "READY";

  return (
    <div className="flex flex-col gap-5 fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold">{formatActionType(proposal.actionType)}</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5 truncate max-w-[280px]">
            {proposal.targetUrl || proposal.decision?.url || proposal.targetModel}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close detail panel"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>

      {/* AI Enhancement Badge */}
      <div className="flex flex-wrap gap-2">
        {proposal.isAiEnhanced ? (
          <span className="ai-badge text-xs px-3 py-1">
            <Sparkles className="w-3 h-3" />
            AI Enhanced
            {proposal.llm?.confidence != null && (
              <span className="ml-1 opacity-70">({Math.round(proposal.llm.confidence * 100)}%)</span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-muted/50 text-muted-foreground border border-border">
            <Settings2 className="w-3 h-3" />
            Deterministic {proposal.llm?.fallbackUsed ? "(Fallback)" : ""}
          </span>
        )}

        {/* Safety tier */}
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${safetyInfo.color}`}>
          <Shield className="w-3 h-3" />
          {safetyInfo.label}
        </span>
      </div>

      {/* Safety warning */}
      {safetyInfo.warning && (
        <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{safetyInfo.warning}</span>
        </div>
      )}

      {/* Score Breakdown */}
      {score && (
        <div className="card-surface p-4">
          <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-brand" />
            Score Breakdown
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Impact",     value: score.impactScore,     icon: Zap,         color: "text-violet-400" },
              { label: "Confidence", value: score.confidenceScore, icon: TrendingUp,  color: "text-blue-400" },
              { label: "Urgency",    value: score.urgencyScore,    icon: Clock,       color: "text-amber-400" },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <item.icon className={`w-3 h-3 ${item.color}`} />
                  <span className="text-[10px] text-muted-foreground">{item.label}</span>
                </div>
                <p className="text-lg font-bold text-foreground">{item.value}</p>
                <div className="score-bar mt-1">
                  <div className="score-bar-fill" style={{ width: `${Math.min(item.value, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Final Score</span>
            <span className="text-sm font-bold text-brand">{score.finalScore}/100</span>
          </div>
        </div>
      )}

      {/* Proposed Changes */}
      {changes.length > 0 && (
        <div>
          <button
            onClick={() => setShowChanges(!showChanges)}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-brand transition-colors mb-2"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showChanges ? "rotate-90" : ""}`} />
            <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
            Proposed Changes ({changes.length})
          </button>

          {showChanges && (
            <div className="space-y-2">
              {changes.map((change: any, idx: number) => (
                <div key={idx} className="rounded-lg bg-[#0d1117] border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border/50">
                    <span className="text-[11px] font-bold text-foreground">{change.field || change.type || `Change ${idx + 1}`}</span>
                  </div>
                  <div className="p-3 space-y-1.5">
                    {change.currentValue != null && (
                      <div className="diff-remove text-xs truncate">
                        {typeof change.currentValue === "string" ? change.currentValue : JSON.stringify(change.currentValue)}
                      </div>
                    )}
                    {change.proposedValue != null && (
                      <div className="diff-add text-xs">
                        {typeof change.proposedValue === "string" ? change.proposedValue : JSON.stringify(change.proposedValue)}
                      </div>
                    )}
                    {change.reasoning && (
                      <p className="text-[10px] text-muted-foreground/60 mt-2 italic">
                        {change.reasoning}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Evidence */}
      {proposal.evidence.length > 0 && (
        <div>
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-brand transition-colors mb-2"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showEvidence ? "rotate-90" : ""}`} />
            <Eye className="w-3.5 h-3.5 text-violet-400" />
            Supporting Evidence ({proposal.evidence.length})
          </button>

          {showEvidence && (
            <div className="space-y-2">
              {proposal.evidence.map((ev) => (
                <div key={ev.id} className="rounded-lg bg-[#0d1117] border border-border p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-foreground">{ev.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      ev.severity === "HIGH" || ev.severity === "CRITICAL"
                        ? "text-rose-400 bg-rose-500/10"
                        : ev.severity === "MEDIUM"
                          ? "text-amber-400 bg-amber-500/10"
                          : "text-emerald-400 bg-emerald-500/10"
                    }`}>
                      {ev.severity}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 line-clamp-2">{ev.description}</p>
                  <div className="flex gap-3 mt-1.5 text-[9px] text-muted-foreground/50">
                    <span>Type: {ev.type}</span>
                    <span>Confidence: {Math.round(ev.confidence * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground/50 mb-0.5">Created</p>
          <p className="font-medium text-foreground">{timeAgo(proposal.createdAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground/50 mb-0.5">Generated By</p>
          <p className="font-medium text-foreground">{proposal.generatedBy ?? "AUTONOMOUS"}</p>
        </div>
        {proposal.decision?.primaryKeyword && (
          <div>
            <p className="text-muted-foreground/50 mb-0.5">Keyword</p>
            <p className="font-medium text-foreground truncate">{proposal.decision.primaryKeyword}</p>
          </div>
        )}
        {proposal.operation && (
          <div>
            <p className="text-muted-foreground/50 mb-0.5">Operation</p>
            <p className="font-medium text-foreground">
              {proposal.operation.status} · Risk {proposal.operation.riskLevel}
            </p>
          </div>
        )}
      </div>

      {/* Expected Outcome */}
      {proposal.expectedOutcome && (
        <div className="rounded-lg bg-brand/5 border border-brand/15 p-3">
          <p className="text-[10px] font-bold text-brand mb-1 uppercase tracking-wide">Expected Outcome</p>
          <p className="text-xs text-foreground/80">{proposal.expectedOutcome}</p>
        </div>
      )}

      {/* Rejection reason */}
      {proposal.reasonRejected && (
        <div className="rounded-lg bg-rose-500/5 border border-rose-500/15 p-3">
          <p className="text-[10px] font-bold text-rose-400 mb-1 uppercase tracking-wide">Rejection Reason</p>
          <p className="text-xs text-foreground/80">{proposal.reasonRejected}</p>
        </div>
      )}

      {/* Authorization Controls */}
      {canAuthorize && (
        <div className="pt-3 border-t border-border space-y-2">
          {confirmApprove ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-400">
                {(proposal.safetyTier ?? 1) >= 3
                  ? "⚠ This is a high safety-tier action. Confirm you have reviewed all proposed changes."
                  : "Confirm approval — this will authorize execution of the proposed changes."
                }
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onApprove}
                  disabled={approving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-brand text-white hover:brightness-110 disabled:opacity-50 transition-all active:scale-95"
                >
                  {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Approval
                </button>
                <button
                  onClick={() => setConfirmApprove(false)}
                  className="px-4 py-2.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmApprove(true)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={onReject}
                disabled={rejecting}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50 transition-colors active:scale-95"
              >
                {rejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
