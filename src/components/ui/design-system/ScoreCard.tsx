"use client";

import React from "react";
import { Zap, CheckCircle2, ArrowRight } from "lucide-react";

export interface ScoreImprovement {
  id: string;
  label: string;
  pointsGain: number;
  severity?: "critical" | "warning" | "info";
  actionLabel?: string;
  onFix?: () => void;
}

export interface ScoreCardProps {
  title: string;
  score: number;
  maxScore?: number;
  subtitle?: string;
  improvements?: ScoreImprovement[];
  onFixAll?: () => void;
  fixAllLoading?: boolean;
}

export function ScoreCard({
  title,
  score,
  maxScore = 100,
  subtitle,
  improvements = [],
  onFixAll,
  fixAllLoading = false,
}: ScoreCardProps) {
  const percentage = Math.min(100, Math.max(0, Math.round((score / maxScore) * 100)));
  const isHigh = percentage >= 80;
  const isMedium = percentage >= 60 && percentage < 80;

  const scoreColor = isHigh
    ? "text-emerald-400"
    : isMedium
    ? "text-amber-400"
    : "text-rose-400";

  const progressBg = isHigh
    ? "bg-emerald-500"
    : isMedium
    ? "bg-amber-500"
    : "bg-rose-500";

  return (
    <div className="card-surface p-5 flex flex-col gap-4 border border-border/80 rounded-2xl bg-card">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <span className={`text-3xl font-black tracking-tight tabular-nums ${scoreColor}`}>
          {score}
          <span className="text-sm font-normal text-muted-foreground/60">/{maxScore}</span>
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${progressBg} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Improvements section */}
      {improvements.length > 0 ? (
        <div className="flex flex-col gap-3 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              {improvements.length} improvement{improvements.length > 1 ? "s" : ""} available
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {improvements.map((imp) => (
              <div
                key={imp.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-accent/40 border border-border/40 text-xs gap-3 group hover:border-border transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      imp.severity === "critical"
                        ? "bg-rose-400"
                        : imp.severity === "warning"
                        ? "bg-amber-400"
                        : "bg-blue-400"
                    }`}
                  />
                  <span className="text-foreground font-medium truncate">{imp.label}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10px] border border-emerald-500/20">
                    +{imp.pointsGain} pts
                  </span>
                  {imp.onFix && (
                    <button
                      type="button"
                      onClick={imp.onFix}
                      className="text-[11px] font-semibold text-primary hover:text-emerald-400 transition-colors"
                    >
                      {imp.actionLabel || "Fix"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {onFixAll && (
            <button
              type="button"
              onClick={onFixAll}
              disabled={fixAllLoading}
              className="mt-1 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-md shadow-emerald-500/15 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {fixAllLoading ? "Applying fixes..." : `Fix all ${improvements.length} issues`}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold pt-1">
          <CheckCircle2 className="w-4 h-4" />
          Optimal performance — no action required
        </div>
      )}
    </div>
  );
}
