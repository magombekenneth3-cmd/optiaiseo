"use client";

import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Clock, Sparkles, Zap } from "lucide-react";

interface Props {
  domain: string;
  lastAuditDate: string | null;
  seoScore: number;
  aeoScore: number;
  clicksDeltaPct: number | null;
  rankDelta: number | null;
  pendingPrsCount: number;
  siteId: string | null;
  statusHeadline: string;
}

export function DashboardHeroHeader({ domain, lastAuditDate, seoScore, aeoScore, clicksDeltaPct, rankDelta, pendingPrsCount, siteId, statusHeadline }: Props) {
  const activeSignals = [
    seoScore > 0 ? `SEO ${seoScore}` : "SEO not checked",
    aeoScore > 0 ? `AEO ${aeoScore}` : "AEO not checked",
    clicksDeltaPct !== null ? `${clicksDeltaPct > 0 ? "+" : ""}${clicksDeltaPct}% clicks` : null,
    rankDelta !== null ? `↑${rankDelta} positions` : null,
  ].filter(Boolean) as string[];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/10 via-card to-card px-5 py-5 sm:px-7 sm:py-6">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-24 w-48 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand">
              <Bot className="h-3 w-3" />
              SEO Autopilot
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Active
            </span>
            {domain && <span className="text-xs font-medium text-muted-foreground">{domain}</span>}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            Your SEO is running. Automatically.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
            Detect issues, prioritize opportunities, execute safe fixes, and verify the impact from one mission control surface.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {activeSignals.slice(0, 4).map((signal) => (
              <span key={signal} className="rounded-lg border border-border/80 bg-background/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                {signal}
              </span>
            ))}
            {lastAuditDate && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />Updated {lastAuditDate}</span>}
          </div>
        </div>

        <div className="relative flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          {siteId && (
            <Link href={`/dashboard/autopilot?siteId=${siteId}`} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition-all hover:-translate-y-0.5 hover:bg-brand/90">
              <Sparkles className="h-4 w-4" />
              Open Autopilot
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {siteId && (
            <Link href={`/dashboard/audits?siteId=${siteId}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <Zap className="h-4 w-4" />
              Run audit
            </Link>
          )}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-1 gap-2 border-t border-border/70 pt-4 sm:grid-cols-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="font-medium">Detect</span>
          <span className="text-muted-foreground/60">→ explain</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-4 w-4 text-brand" />
          <span className="font-medium">Recommend</span>
          <span className="text-muted-foreground/60">→ execute</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-sky-400" />
          <span className="font-medium">Verify</span>
          <span className="text-muted-foreground/60">→ measure impact</span>
        </div>
      </div>

      {pendingPrsCount > 0 && (
        <Link href={siteId ? `/dashboard/operations?siteId=${siteId}` : "/dashboard/operations"} className="relative mt-3 flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs transition-colors hover:bg-amber-500/10">
          <span className="font-medium text-amber-200">{pendingPrsCount} proposed fix{pendingPrsCount === 1 ? "" : "es"} waiting for review</span>
          <span className="font-semibold text-amber-300">Review <ArrowRight className="ml-1 inline h-3 w-3" /></span>
        </Link>
      )}

      <span className="sr-only">{statusHeadline}</span>
    </section>
  );
}
