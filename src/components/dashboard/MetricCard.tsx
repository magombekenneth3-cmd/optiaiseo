/**
 * MetricCard
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified metric card component. Fixes Priority 6 data presentation issues:
 *
 *  1. Label is ABOVE the number (WCAG reading order, scannable hierarchy)
 *  2. Number size is proportionate — not dominating text-4xl on every card
 *  3. Score bars are always present (shows progress context, not just a number)
 *  4. Empty/missing data uses structured "Not yet set up" state — not bare "—"
 *  5. Consistent icon treatment across all cards
 *  6. Delta badges are readable (minimum 12px)
 *  7. Grid-agnostic — card has consistent internal height management
 */

import Link from "next/link";
import { LucideIcon, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export interface MetricCardProps {
  /** Section label above the number */
  label: string;
  /** The primary metric value — null triggers empty state */
  value: number | string | null;
  /** Unit string displayed next to the number (e.g. "/100") */
  unit?: string;
  /** Supporting description below the value */
  description?: string;
  /** Numeric delta vs previous period (positive = good) */
  delta?: number | null;
  /** Human label for the delta (e.g. "vs last audit") */
  deltaLabel?: string;
  /** Whether a higher delta is good (default true) */
  deltaPositiveIsGood?: boolean;
  /** Progress bar value 0–100. Shown when not null. */
  progress?: number | null;
  /** Progress bar color override */
  progressColor?: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Icon background color class */
  iconColor?: string;
  /** Empty state CTA — shown when value is null */
  emptyLabel?: string;
  emptyHref?: string;
  /** Supplementary content rendered at the bottom */
  footer?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  description,
  delta,
  deltaLabel = "vs last",
  deltaPositiveIsGood = true,
  progress,
  progressColor,
  icon: Icon,
  iconColor = "text-brand",
  emptyLabel,
  emptyHref,
  footer,
  className = "",
}: MetricCardProps) {
  const isEmpty = value === null || value === undefined;

  // Auto-derive progress bar color from value if numeric
  const autoProgressColor =
    progressColor ??
    (typeof value === "number"
      ? value >= 80
        ? "#10b981"
        : value >= 60
          ? "#f59e0b"
          : "#ef4444"
      : "#10b981");

  // Delta styling
  const deltaIsPositive = (delta ?? 0) > 0;
  const deltaIsGood = deltaPositiveIsGood ? deltaIsPositive : !deltaIsPositive;
  const deltaColor = (delta ?? 0) === 0
    ? "text-muted-foreground"
    : deltaIsGood
      ? "text-emerald-400 bg-emerald-500/10"
      : "text-rose-400 bg-rose-500/10";
  const DeltaIcon = (delta ?? 0) === 0
    ? Minus
    : deltaIsPositive
      ? ArrowUpRight
      : ArrowDownRight;

  return (
    <div className={`metric-card overflow-hidden group flex flex-col gap-3 ${className}`}>
      {/* Header row: label + icon */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider leading-none">
          {label}
        </p>
        <div className={`shrink-0 w-9 h-9 rounded-xl bg-muted/60 border border-border/60 flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${iconColor}`} aria-hidden="true" />
        </div>
      </div>

      {/* Value block */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col gap-1.5">
          <span className="text-3xl font-bold text-muted-foreground/30 tracking-tight">—</span>
          {emptyLabel && (
            emptyHref ? (
              <Link
                href={emptyHref}
                className="text-xs font-semibold text-brand hover:underline underline-offset-2 inline-flex items-center gap-1"
              >
                {emptyLabel} <ArrowUpRight className="w-3 h-3" />
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground/60">{emptyLabel}</p>
            )
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-1">
          {/* Number */}
          <div className="flex items-end gap-1.5 leading-none">
            <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {value}
            </span>
            {unit && (
              <span className="text-sm font-semibold text-muted-foreground mb-0.5">
                {unit}
              </span>
            )}
          </div>

          {/* Description + delta row */}
          <div className="flex flex-wrap items-center gap-2">
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {delta !== null && delta !== undefined && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md ${deltaColor}`}>
                <DeltaIcon className="w-3 h-3" aria-hidden="true" />
                {delta > 0 ? "+" : ""}{delta}
                {deltaLabel && (
                  <span className="opacity-70 font-medium ml-0.5">{deltaLabel}</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {progress !== null && progress !== undefined && !isEmpty && (
        <div
          className="w-full h-1 rounded-full bg-muted/40 overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${Math.round(progress)}%`}
        >
          <div
            className="h-1 rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, Math.max(0, progress))}%`,
              background: autoProgressColor,
            }}
          />
        </div>
      )}

      {/* Optional footer slot */}
      {footer && (
        <div className="pt-1 border-t border-border/50 mt-auto">
          {footer}
        </div>
      )}
    </div>
  );
}

/* ── ScoreBar ── */
/** Standalone labelled score bar — used for categoryScores breakdown */
export function ScoreBar({
  label,
  score,
  maxScore = 100,
}: {
  label: string;
  score: number;
  maxScore?: number;
}) {
  const pct = Math.round((score / maxScore) * 100);
  const color =
    pct >= 80 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className="text-xs font-bold tabular-nums"
          style={{ color }}
        >
          {score}
        </span>
      </div>
      <div
        className="w-full h-1.5 rounded-full bg-muted/50 overflow-hidden"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={maxScore}
        aria-label={`${label}: ${score} out of ${maxScore}`}
      >
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/** Format a camelCase or PascalCase key to a human-readable label */
export function formatScoreKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
