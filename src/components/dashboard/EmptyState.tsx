/**
 * EmptyState
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared empty/zero-state component. Replaces all ad-hoc "No data yet" text
 * blocks across the dashboard with a consistent, professional pattern.
 *
 * Usage:
 *   <EmptyState
 *     icon={<BarChart2 className="w-6 h-6" />}
 *     title="No audits yet"
 *     description="Run your first audit to see your SEO score."
 *     action={{ label: "Run audit", href: "/dashboard/audits" }}
 *   />
 *
 * Variants:
 *   default — standard card (used inside sections)
 *   inline  — smaller, no card border (used inside table cells or panels)
 *   hero    — full-width, more padding (used as full-page empty dashboard)
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  variant?: "default" | "inline" | "hero";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  className = "",
}: Props) {
  if (variant === "inline") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className}`}>
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-muted/60 border border-border flex items-center justify-center text-muted-foreground/60 mb-1">
            {icon}
          </div>
        )}
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">{description}</p>
        )}
        {action && (
          <EmptyStateAction action={action} size="sm" />
        )}
      </div>
    );
  }

  if (variant === "hero") {
    return (
      <div className={`flex flex-col items-center justify-center gap-5 py-16 text-center max-w-md mx-auto ${className}`}>
        {icon && (
          <div className="w-16 h-16 rounded-2xl bg-brand/8 border border-brand/15 flex items-center justify-center text-brand mb-1">
            <span className="w-8 h-8">{icon}</span>
          </div>
        )}
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground tracking-tight">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {action && <EmptyStateAction action={action} size="lg" primary />}
          {secondaryAction && <EmptyStateAction action={secondaryAction} size="lg" />}
        </div>
      </div>
    );
  }

  // default
  return (
    <div className={`flex flex-col items-center justify-center gap-4 py-10 text-center ${className}`}>
      {icon && (
        <div className="w-11 h-11 rounded-2xl bg-muted border border-border flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {action && <EmptyStateAction action={action} size="md" primary />}
        {secondaryAction && <EmptyStateAction action={secondaryAction} size="md" />}
      </div>
    </div>
  );
}

function EmptyStateAction({
  action,
  size,
  primary = false,
}: {
  action: EmptyStateAction;
  size: "sm" | "md" | "lg";
  primary?: boolean;
}) {
  const sizeMap = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs",
    lg: "px-5 py-2.5 text-sm",
  };

  const baseClass = `inline-flex items-center gap-1.5 rounded-xl font-semibold transition-all active:scale-95 ${sizeMap[size]}`;
  const primaryClass = "bg-brand text-white hover:brightness-110";
  const secondaryClass = "bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-accent";

  const content = (
    <>
      {action.label}
      {primary && <ArrowRight className="w-3 h-3" />}
    </>
  );

  if (action.href) {
    return (
      <Link
        href={action.href}
        className={`${baseClass} ${primary ? primaryClass : secondaryClass}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      onClick={action.onClick}
      className={`${baseClass} ${primary ? primaryClass : secondaryClass}`}
    >
      {content}
    </button>
  );
}

/* ── Skeleton Cards ── */

/** Skeleton for a metric card — 3 shimmer lines matching real card layout */
export function MetricCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`metric-card-skeleton ${className}`}>
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-8 w-8 rounded-xl" />
      </div>
      <div className="space-y-2">
        <div className="skeleton h-9 w-20 rounded" />
        <div className="skeleton h-2.5 w-32 rounded" />
      </div>
      <div className="skeleton h-1.5 w-full rounded-full" />
    </div>
  );
}

/** Skeleton for a chart area */
export function ChartSkeleton({ height = 240, className = "" }: { height?: number; className?: string }) {
  return (
    <div
      className={`skeleton rounded-2xl ${className}`}
      style={{ height }}
      aria-label="Loading chart…"
      role="progressbar"
    />
  );
}

/** Skeleton for a list item row */
export function ListRowSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 py-3 ${className}`}>
      <div className="skeleton h-8 w-8 rounded-lg shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="skeleton h-2.5 w-1/2 rounded" />
      </div>
      <div className="skeleton h-6 w-16 rounded-lg" />
    </div>
  );
}
