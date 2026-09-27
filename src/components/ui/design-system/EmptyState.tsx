"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

export interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  explanation: string;
  valueProp?: string;
  primaryAction: {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: React.ElementType;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  explanation,
  valueProp,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  const PrimaryIcon = primaryAction.icon || Sparkles;

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 p-8 sm:p-12 text-center max-w-xl mx-auto my-6">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
        <Icon className="h-7 w-7" />
      </div>

      <h3 className="text-lg font-bold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {explanation}
      </p>

      {valueProp && (
        <p className="mt-2 text-xs font-semibold text-emerald-400/90 bg-emerald-500/5 px-3 py-1 rounded-lg border border-emerald-500/10">
          💡 {valueProp}
        </p>
      )}

      <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
        {primaryAction.href ? (
          <Link
            href={primaryAction.href}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-emerald-500/15 transition-all hover:bg-emerald-400"
          >
            <PrimaryIcon className="h-4 w-4" />
            {primaryAction.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={primaryAction.onClick}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-emerald-500/15 transition-all hover:bg-emerald-400"
          >
            <PrimaryIcon className="h-4 w-4" />
            {primaryAction.label}
          </button>
        )}

        {secondaryAction && (
          secondaryAction.href ? (
            <Link
              href={secondaryAction.href}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
            >
              {secondaryAction.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
            >
              {secondaryAction.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>
    </div>
  );
}
