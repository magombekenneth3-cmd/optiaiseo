"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Circle, Activity } from "lucide-react";

export interface PipelineStage {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
}

/** A lifecycle snapshot for one selected proposal, never an aggregate guess. */
export interface PipelineState {
  proposalId: string | null;
  status: string | null;
  activeStageId: string | null;
  completedStages: string[];
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "discovery", label: "Discovered", shortLabel: "1", description: "An SEO opportunity was identified." },
  { id: "scoring", label: "Scored", shortLabel: "2", description: "Impact, confidence, and urgency were evaluated." },
  { id: "planning", label: "Planned", shortLabel: "3", description: "A concrete action plan and proposed changes were generated." },
  { id: "llm", label: "AI Reviewed", shortLabel: "4", description: "The optional AI enhancement/review step was evaluated; template fallback remains valid." },
  { id: "draft", label: "Draft", shortLabel: "5", description: "The proposal is being prepared before it can enter review." },
  { id: "authorized", label: "Authorized", shortLabel: "6", description: "The proposal is waiting for, or has received, the required authorization." },
  { id: "executing", label: "Executing", shortLabel: "7", description: "The approved mutation is queued or in progress." },
  { id: "verified", label: "Verified", shortLabel: "8", description: "The result is being checked against its verification criteria." },
];

function formatStatus(status: string | null): string {
  return status ? status.replace(/_/g, " ") : "No proposal selected";
}

export function PipelineFlow({ state }: { state: PipelineState }) {
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const selectedStage = PIPELINE_STAGES.find((stage) => stage.id === selectedStageId) ?? null;
  const hasProposal = Boolean(state.proposalId);

  useEffect(() => {
    setSelectedStageId(null);
  }, [state.proposalId]);

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">Proposal Pipeline</h3>
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          {formatStatus(state.status)}
        </span>
      </div>

      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isCompleted = state.completedStages.includes(stage.id);
          const isActive = state.activeStageId === stage.id;
          const isSelected = selectedStageId === stage.id;

          return (
            <div key={stage.id} className="flex items-center flex-1 min-w-0">
              <button
                type="button"
                disabled={!hasProposal}
                onClick={() => setSelectedStageId((current) => current === stage.id ? null : stage.id)}
                className={`pipeline-node group flex-shrink-0 ${isSelected ? "scale-105" : ""} ${!hasProposal ? "cursor-default" : ""}`}
                aria-label={`${stage.label}: ${isCompleted ? "completed" : isActive ? "active" : "pending"}`}
                aria-pressed={isSelected}
              >
                <div
                  className={`
                    w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors
                    ${isCompleted
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                      : isActive
                        ? "bg-brand/15 border-brand/50 text-brand"
                        : isSelected
                          ? "bg-violet-500/15 border-violet-500/40 text-violet-400"
                          : "bg-muted/30 border-border text-muted-foreground/40"
                    }
                  `}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Circle className="w-3.5 h-3.5" />
                  )}
                </div>

                <span
                  className={`
                    text-[10px] font-bold tracking-wide whitespace-nowrap transition-colors
                    ${isCompleted
                      ? "text-emerald-400"
                      : isActive
                        ? "text-brand"
                        : isSelected
                          ? "text-violet-400"
                          : "text-muted-foreground/50"
                    }
                  `}
                >
                  {stage.label}
                </span>
              </button>

              {idx < PIPELINE_STAGES.length - 1 && (
                <div
                  className={`pipeline-connector ${isCompleted ? "active" : ""}`}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground/70">
        {selectedStage
          ? selectedStage.description
          : hasProposal
            ? "Select a stage to see what it represents for this proposal."
            : "Select a proposal to inspect its exact lifecycle; site-wide totals are shown above."
        }
      </p>
    </div>
  );
}
