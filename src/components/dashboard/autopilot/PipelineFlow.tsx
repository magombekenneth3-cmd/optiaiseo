"use client";

import { CheckCircle2, Loader2, Circle, Sparkles } from "lucide-react";

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
  { id: "discovery",   label: "Discovery",     shortLabel: "D.1", description: "Identify SEO opportunities" },
  { id: "scoring",     label: "Scoring",       shortLabel: "D.2", description: "Score by impact & urgency" },
  { id: "planning",    label: "Planning",      shortLabel: "D.3", description: "Generate action plan" },
  { id: "llm",         label: "Enhancement",   shortLabel: "D.4", description: "AI-powered optimization" },
  { id: "draft",       label: "Draft",         shortLabel: "DR",  description: "Proposal ready for review" },
  { id: "authorized",  label: "Authorized",    shortLabel: "AU",  description: "Approved for execution" },
  { id: "executing",   label: "Executing",     shortLabel: "EX",  description: "Mutation in progress" },
  { id: "verified",    label: "Verified",      shortLabel: "VR",  description: "Changes confirmed" },
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
    <div className="card-surface p-5 fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-foreground">Pipeline Flow</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          D.1 → D.2 → D.3 → D.4 → Draft → Auth → Exec → Verify
        </span>
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
                    w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300
                    ${isCompleted
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                      : isActive
                        ? "bg-brand/15 border-brand/50 text-brand glow-active"
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
                  {stage.shortLabel}
                </span>

                {/* Full label on hover */}
                <span
                  className={`
                    text-[9px] whitespace-nowrap transition-all opacity-0 group-hover:opacity-100 absolute -bottom-4
                    ${isCompleted ? "text-emerald-400/70" : isActive ? "text-brand/70" : "text-muted-foreground/40"}
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
