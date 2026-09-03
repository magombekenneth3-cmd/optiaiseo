"use client";

import { CheckCircle2, Loader2, Circle, Activity } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
}

export interface PipelineState {
  activeStageId: string | null;
  completedStages: string[];
  selectedStageId: string | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "discovery",   label: "Discovered",    shortLabel: "1", description: "Identified SEO opportunity" },
  { id: "scoring",     label: "Scored",        shortLabel: "2", description: "Ranked by impact & urgency" },
  { id: "planning",    label: "Planned",       shortLabel: "3", description: "Action plan generated" },
  { id: "llm",         label: "AI Enhanced",   shortLabel: "4", description: "Optimized with AI" },
  { id: "draft",       label: "Draft",         shortLabel: "5", description: "Proposal ready for review" },
  { id: "authorized",  label: "Authorized",    shortLabel: "6", description: "Approved for execution" },
  { id: "executing",   label: "Executing",     shortLabel: "7", description: "Mutation in progress" },
  { id: "verified",    label: "Verified",      shortLabel: "8", description: "Changes confirmed" },
];

// ── Component ───────────────────────────────────────────────────────────────

export function PipelineFlow({
  state,
  onStageClick,
}: {
  state: PipelineState;
  onStageClick: (stageId: string) => void;
}) {
  return (
    <div className="card-surface p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-foreground">Pipeline Status</h3>
      </div>

      {/* Pipeline visualization */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isCompleted = state.completedStages.includes(stage.id);
          const isActive = state.activeStageId === stage.id;
          const isSelected = state.selectedStageId === stage.id;
          const isPast = state.completedStages.includes(stage.id);

          return (
            <div key={stage.id} className="flex items-center flex-1 min-w-0">
              {/* Node */}
              <button
                onClick={() => onStageClick(stage.id)}
                className={`pipeline-node group flex-shrink-0 ${isSelected ? "scale-105" : ""}`}
                aria-label={`${stage.label}: ${isCompleted ? "completed" : isActive ? "active" : "pending"}`}
                aria-pressed={isSelected}
              >
                {/* Circle */}
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

                {/* Label */}
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

              {/* Connector */}
              {idx < PIPELINE_STAGES.length - 1 && (
                <div
                  className={`pipeline-connector ${isPast ? "active" : ""}`}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
