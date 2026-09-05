/**
 * MetricCard — Redesigned for minimal B2B SaaS dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact KPI card: label above, large number, inline delta badge.
 * No progress bar, no icon container box — clean data-first layout.
 */

import Link from "next/link";
import { LucideIcon, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: number | string | null;
  unit?: string;
  description?: string;
  delta?: number | null;
  deltaLabel?: string;
  deltaPositiveIsGood?: boolean;
  progress?: number | null;
  progressColor?: string;
  icon: LucideIcon;
  iconColor?: string;
  emptyLabel?: string;
  emptyHref?: string;
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
  icon: Icon,
  iconColor = "text-brand",
  emptyLabel,
  emptyHref,
  footer,
  className = "",
}: MetricCardProps) {
  const isEmpty = value === null || value === undefined;

  const deltaIsPositive = (delta ?? 0) > 0;
  const deltaIsGood = deltaPositiveIsGood ? deltaIsPositive : !deltaIsPositive;
  const deltaColor =
    (delta ?? 0) === 0
      ? "text-muted-foreground"
      : deltaIsGood
      ? "text-emerald-400"
      : "text-rose-400";
  const DeltaIcon =
    (delta ?? 0) === 0 ? Minus : deltaIsPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={`metric-card ${className}`}>
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} aria-hidden="true" />
        <p className="text-xs font-medium text-muted-foreground leading-none truncate">
          {label}
        </p>
      </div>

      {/* Value block */}
      {isEmpty ? (
        <div className="flex flex-col gap-2 py-1">
          {emptyLabel && (
            <p className="text-xs text-muted-foreground leading-snug">{emptyLabel}</p>
          )}
          {emptyHref && emptyLabel && (
            <Link
              href={emptyHref}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand/80 transition-colors"
            >
              Set up <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {/* Number + unit */}
          <div className="flex items-baseline gap-1 leading-none">
            <span className="text-[32px] font-bold tracking-tight text-foreground tabular-nums leading-none">
              {value}
            </span>
            {unit && (
              <span className="text-sm font-medium text-muted-foreground">{unit}</span>
            )}
          </div>

          {/* Description + delta */}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {delta !== null && delta !== undefined && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${deltaColor}`}>
                <DeltaIcon className="w-3 h-3" aria-hidden="true" />
                {delta > 0 ? "+" : ""}{delta}
                {deltaLabel && (
                  <span className="opacity-60 font-normal ml-0.5">{deltaLabel}</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Optional footer */}
      {footer && (
        <div className="pt-1 border-t border-border/50 mt-auto">
          {footer}
        </div>
      )}
    </div>
  );
}

/* ── ScoreBar ── */
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
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
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
