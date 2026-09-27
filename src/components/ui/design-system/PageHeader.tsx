"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export interface PageHeaderProps {
  title: string;
  description: string;
  category?: string;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: React.ElementType;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: React.ElementType;
  };
  metrics?: Array<{
    label: string;
    value: string | number;
    badge?: string;
    color?: string;
  }>;
  currentStep?: "discover" | "decide" | "create" | "optimize" | "publish" | "measure" | "refresh";
}

const WORKFLOW_STEPS = [
  { id: "discover", label: "Discover", href: "/dashboard/audits" },
  { id: "decide", label: "Decide", href: "/dashboard/recommendations" },
  { id: "create", label: "Create", href: "/dashboard/blogs" },
  { id: "optimize", label: "Optimize", href: "/dashboard/editor" },
  { id: "publish", label: "Publish", href: "/dashboard/planner" },
  { id: "measure", label: "Measure", href: "/dashboard/aeo" },
  { id: "refresh", label: "Refresh", href: "/dashboard/content-decay" },
];

export function PageHeader({
  title,
  description,
  category,
  primaryAction,
  secondaryAction,
  metrics,
  currentStep,
}: PageHeaderProps) {
  const PrimaryIcon = primaryAction?.icon || Sparkles;
  const SecondaryIcon = secondaryAction?.icon;

  return (
    <div className="flex flex-col gap-4 border-b border-border/60 pb-6">
      {/* Category Eyebrow if specified */}
      {category && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
            {category}
          </span>
        </div>
      )}

      {/* Main Title + Description + Primary/Secondary Actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1 max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          {secondaryAction && (
            secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card/60 hover:bg-muted text-sm font-semibold text-foreground transition-all duration-150"
              >
                {SecondaryIcon && <SecondaryIcon className="w-4 h-4 text-muted-foreground" />}
                {secondaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card/60 hover:bg-muted text-sm font-semibold text-foreground transition-all duration-150"
              >
                {SecondaryIcon && <SecondaryIcon className="w-4 h-4 text-muted-foreground" />}
                {secondaryAction.label}
              </button>
            )
          )}

          {primaryAction && (
            primaryAction.href ? (
              <Link
                href={primaryAction.href}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all duration-150 active:scale-95"
              >
                <PrimaryIcon className="w-4 h-4" />
                {primaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all duration-150 active:scale-95"
              >
                <PrimaryIcon className="w-4 h-4" />
                {primaryAction.label}
              </button>
            )
          )}
        </div>
      </div>

      {/* Metrics Strip */}
      {metrics && metrics.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap pt-2">
          {metrics.map((m, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-card/60 border border-border/80 text-xs shadow-sm"
            >
              <span className="text-muted-foreground font-medium">{m.label}:</span>
              <span className={`font-bold tabular-nums ${m.color || "text-foreground"}`}>
                {m.value}
              </span>
              {m.badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  {m.badge}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Optional Workflow Navigator Strip */}
      {currentStep && (
        <div className="pt-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground overflow-x-auto">
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60 mr-1 shrink-0">
            Workflow:
          </span>
          {WORKFLOW_STEPS.map((step, index) => {
            const isCurrent = step.id === currentStep;
            return (
              <React.Fragment key={step.id}>
                {index > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
                <Link
                  href={step.href}
                  className={`px-2.5 py-1 rounded-lg transition-all shrink-0 ${
                    isCurrent
                      ? "bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30"
                      : "hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {step.label}
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
