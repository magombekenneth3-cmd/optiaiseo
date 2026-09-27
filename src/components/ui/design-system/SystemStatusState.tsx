"use client";

import React from "react";
import { CheckCircle2, Loader2, AlertCircle, RefreshCw } from "lucide-react";

export interface StatusStep {
  id: string;
  label: string;
  status: "completed" | "in_progress" | "pending" | "failed";
  detail?: string;
}

export interface SystemStatusStateProps {
  title: string;
  steps: StatusStep[];
  estimatedTime?: string;
  isFailed?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  previousResultsAvailable?: boolean;
}

export function SystemStatusState({
  title,
  steps,
  estimatedTime = "~30 seconds",
  isFailed = false,
  errorMessage,
  onRetry,
  previousResultsAvailable = false,
}: SystemStatusStateProps) {
  if (isFailed) {
    return (
      <div className="card-surface p-6 rounded-2xl bg-rose-500/[0.03] border border-rose-500/20 flex flex-col gap-4 max-w-lg mx-auto text-center">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-400">
          <AlertCircle className="w-6 h-6" />
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-base font-bold text-foreground">We couldn't complete the task</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {errorMessage || "An unexpected error occurred during processing."}
          </p>
          {previousResultsAvailable && (
            <p className="text-[11px] text-emerald-400 font-medium mt-1">
              Your previous analysis results remain saved and accessible.
            </p>
          )}
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-md transition-all self-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry analysis
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card-surface p-6 rounded-2xl bg-card border border-border flex flex-col gap-5 max-w-md mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          {title}
        </h3>
        {estimatedTime && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {estimatedTime}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {steps.map((step) => (
          <div key={step.id} className="flex items-start gap-3 text-xs">
            {step.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : step.status === "in_progress" ? (
              <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
            ) : step.status === "failed" ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <span className="w-4 h-4 rounded-full border border-border shrink-0 mt-0.5" />
            )}

            <div className="flex flex-col min-w-0">
              <span
                className={`font-medium ${
                  step.status === "completed"
                    ? "text-foreground"
                    : step.status === "in_progress"
                    ? "text-emerald-400 font-bold"
                    : "text-muted-foreground/60"
                }`}
              >
                {step.label}
              </span>
              {step.detail && (
                <span className="text-[11px] text-muted-foreground mt-0.5">
                  {step.detail}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
