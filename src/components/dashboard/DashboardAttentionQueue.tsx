"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";

export interface DashboardAttentionItem {
  id: string;
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium";
  state: "review" | "running" | "failed" | "unknown";
  href: string;
  action: string;
}

interface Props {
  items: DashboardAttentionItem[];
}

const severityTone = {
  critical: "border-rose-500/20 bg-rose-500/[0.06] text-rose-300",
  high: "border-amber-500/20 bg-amber-500/[0.06] text-amber-300",
  medium: "border-sky-500/20 bg-sky-500/[0.06] text-sky-300",
};

const severityLabel = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
};

const stateTone = {
  review: { label: "Needs review", icon: ShieldAlert },
  running: { label: "In progress", icon: Clock3 },
  failed: { label: "Failed", icon: AlertTriangle },
  unknown: { label: "Status unavailable", icon: AlertTriangle },
};

export function DashboardAttentionQueue({ items }: Props) {
  return (
    <section aria-labelledby="dashboard-attention" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Priority actions</p>
          <h2 id="dashboard-attention" className="mt-1 text-sm font-semibold text-foreground">
            {items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"} to review` : "No priority actions surfaced"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {items.length > 0 ? "Based on the latest available dashboard signals." : "New recommendations will appear here when available."}
          </p>
        </div>
        <Link href="/dashboard/recommendations" className="inline-flex shrink-0 items-center gap-1 self-start text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:self-center">
          View recommendations
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex items-start gap-3 px-4 py-5 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">You’re all caught up on surfaced actions</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">This doesn’t necessarily mean every site issue is resolved. Review the latest audit for a complete findings list.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const StateIcon = stateTone[item.state].icon;
            return (
              <li key={item.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                    <StateIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm font-semibold text-foreground">{item.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${severityTone[item.severity]}`}>
                        {severityLabel[item.severity]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                    <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <StateIcon className="h-3 w-3" aria-hidden="true" />
                      {stateTone[item.state].label}
                    </p>
                  </div>
                </div>
                <Link href={item.href} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-brand/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {item.action}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
