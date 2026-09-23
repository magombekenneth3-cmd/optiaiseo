"use client";

import Link from "next/link";
import { ArrowRight, Bot, Clock, Sparkles, Zap } from "lucide-react";

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
  automationState: "AUTOPILOT" | "SUPERVISED" | "REPORT_ONLY" | "PAUSED";
}

export function DashboardHeroHeader({ domain, lastAuditDate, seoScore, aeoScore, pendingPrsCount, siteId, statusHeadline, automationState }: Props) {
  const automationLabel = automationState === "AUTOPILOT" ? "Autopilot" : automationState === "SUPERVISED" ? "Supervised" : automationState === "PAUSED" ? "Paused" : "Report only";
  const automationTone = automationState === "AUTOPILOT"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : automationState === "PAUSED"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
      : "border-border bg-background/60 text-muted-foreground";

  return (
    <section aria-labelledby="dashboard-site-title" className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              SEO workspace
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${automationTone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${automationState === "AUTOPILOT" ? "bg-emerald-400" : automationState === "PAUSED" ? "bg-amber-400" : "bg-muted-foreground"}`} />
              {automationLabel}
            </span>
          </div>

          <h1 id="dashboard-site-title" className="mt-3 break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {domain || statusHeadline || "Your SEO dashboard"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-5 text-muted-foreground">
            {domain ? statusHeadline || "Monitor search performance, technical health, and AI visibility." : statusHeadline || "Connect a website to start tracking search performance."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {seoScore > 0 && <span className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">SEO score <span className="font-semibold text-foreground">{seoScore}/100</span></span>}
            {aeoScore > 0 && <span className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">AEO score <span className="font-semibold text-foreground">{aeoScore}/100</span></span>}
            {lastAuditDate && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" />Last audit {lastAuditDate}</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {siteId && (
            <Link href={`/dashboard/audits?siteId=${encodeURIComponent(siteId)}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
              <Zap className="h-4 w-4" aria-hidden="true" />
              Run audit
            </Link>
          )}
          {siteId && (
            <Link href={`/dashboard/autopilot?siteId=${encodeURIComponent(siteId)}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Autopilot
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {pendingPrsCount > 0 && (
        <Link href={siteId ? `/dashboard/operations?siteId=${encodeURIComponent(siteId)}` : "/dashboard/operations"} className="mt-4 flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-3 text-sm transition-colors hover:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium text-amber-200">{pendingPrsCount} proposed fix{pendingPrsCount === 1 ? "" : "es"} awaiting review</span>
          <span className="inline-flex items-center gap-1 font-semibold text-amber-300">Review fixes <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
        </Link>
      )}
    </section>
  );
}
