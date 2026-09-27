"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export type OpportunityImpact = "critical" | "high" | "medium" | "low";
export type OpportunityEffort = "low" | "medium" | "high";

export interface OpportunityAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  disabled?: boolean;
  /** Override the default action icon (e.g. a spinner while pending). */
  icon?: React.ElementType;
}

const IMPACT_CONFIG: Record<OpportunityImpact, { label: string; variant: BadgeVariant }> = {
  critical: { label: "Critical Impact", variant: "danger" },
  high: { label: "High Impact", variant: "warning" },
  medium: { label: "Medium Impact", variant: "info" },
  low: { label: "Low Impact", variant: "neutral" },
};

const EFFORT_CONFIG: Record<OpportunityEffort, { label: string; variant: BadgeVariant }> = {
  low: { label: "Low effort", variant: "success" },
  medium: { label: "Medium effort", variant: "neutral" },
  high: { label: "High effort", variant: "warning" },
};

export interface OpportunityCardProps {
  /** Optional category icon, shown in a small badge to the left of the eyebrow. */
  icon?: React.ElementType;
  /** Category label shown above the title, e.g. "Quick Win Opportunity". */
  eyebrow?: string;
  /** Priority / impact — drives the impact badge. */
  impact: OpportunityImpact;
  /** Override the default impact label (e.g. a domain-specific phrase). */
  impactLabel?: string;
  /** Extra pips shown next to the impact badge (source tag, status badge, etc). */
  badges?: React.ReactNode;
  /** Title — what the opportunity is, e.g. "Improve /pricing". */
  title: string;
  /** Primary metric — the single most important number, e.g. "Position #11". */
  primaryMetric?: string;
  /** Why it matters — a one-line explanation of the signal. */
  whyItMatters?: string;
  /** Supporting evidence — a short, secondary line (estimated value, evidence text). */
  evidence?: string;
  /** Escape hatch for compact, page-specific evidence (e.g. a small stats grid). Takes priority over `evidence` when present. */
  children?: React.ReactNode;
  /** Short chips shown below the evidence line. */
  tags?: string[];
  /** Effort required to act on this opportunity. */
  effort?: OpportunityEffort;
  /** Free-text risk note, shown alongside effort when present. */
  risk?: string;
  /** 1-3 actions; the first is styled as primary, the rest as secondary. */
  actions?: OpportunityAction[];
  className?: string;
}

function ActionButton({ action, variant }: { action: OpportunityAction; variant: "primary" | "secondary" }) {
  const Icon = action.icon ?? (variant === "primary" ? ArrowRight : undefined);
  const className = cn(
    "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none",
    variant === "primary"
      ? "bg-brand/10 text-brand hover:bg-brand/20"
      : "text-muted-foreground hover:text-foreground"
  );
  const content = (
    <>
      {action.label}
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
    </>
  );
  if (action.href) {
    return (
      <Link
        href={action.disabled ? "#" : action.href}
        aria-disabled={action.disabled || undefined}
        onClick={action.disabled ? (e) => e.preventDefault() : action.onClick}
        target={action.external ? "_blank" : undefined}
        rel={action.external ? "noopener noreferrer" : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled} className={className}>
      {content}
    </button>
  );
}

/**
 * Canonical opportunity presentation pattern — reused across Mission Control,
 * Recommendations, Keywords, AEO, and Audits so every "here's something you
 * could fix" surface reads the same way. Keep this compact; detailed
 * evidence belongs in a drawer or detail page, not this card.
 */
export function OpportunityCard({
  icon: Icon,
  eyebrow,
  impact,
  impactLabel,
  badges,
  title,
  primaryMetric,
  whyItMatters,
  evidence,
  children,
  tags,
  effort,
  risk,
  actions = [],
  className,
}: OpportunityCardProps) {
  const impactCfg = IMPACT_CONFIG[impact];
  const effortCfg = effort ? EFFORT_CONFIG[effort] : null;
  const [primaryAction, ...secondaryActions] = actions;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-accent">
              <Icon className="h-4 w-4 text-brand" />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {eyebrow && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {eyebrow}
                </span>
              )}
              <Badge variant={impactCfg.variant}>{impactLabel ?? impactCfg.label}</Badge>
              {badges}
            </div>
            <h4 className="text-sm font-semibold leading-snug text-foreground">{title}</h4>
          </div>
        </div>
        {(effortCfg || risk) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {effortCfg && <Badge variant={effortCfg.variant}>{effortCfg.label}</Badge>}
            {risk && <Badge variant="outline">{risk}</Badge>}
          </div>
        )}
      </div>

      {primaryMetric && (
        <p className="text-base font-bold tabular-nums text-foreground">{primaryMetric}</p>
      )}

      {whyItMatters && <p className="text-xs text-muted-foreground line-clamp-2">{whyItMatters}</p>}

      {children ?? (evidence && <p className="text-xs font-medium text-brand line-clamp-1">{evidence}</p>)}

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-accent/60 px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {primaryAction && (
        <div className="mt-1 flex items-center gap-3 border-t border-border/30 pt-2">
          <ActionButton action={primaryAction} variant="primary" />
          {secondaryActions.map((action, i) => (
            <ActionButton key={i} action={action} variant="secondary" />
          ))}
        </div>
      )}
    </div>
  );
}
