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

const stateTone = {
  review: { label: "Needs review", icon: ShieldAlert },
  running: { label: "In progress", icon: Clock3 },
  failed: { label: "Failed", icon: AlertTriangle },
  unknown: { label: "Needs verification", icon: AlertTriangle },
};

export function DashboardAttentionQueue({ items }: Props) {
  return (
    <section aria-labelledby="dashboard-attention" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Needs attention</p>
          <h2 id="dashboard-attention" className="mt-1 text-sm font-semibold text-foreground">
            {items.length > 0 ? items.length + " item" + (items.length === 1 ? "" : "s") + " require action" : "Nothing needs your attention"}
          </h2>
        </div>
        <Link href="/dashboard/recommendations" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          View all
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Latest signals are clear</p>
            <p className="mt-1 text-xs text-muted-foreground">Your recent audit and remediation pipeline have no open exceptions.</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => {
            const StateIcon = stateTone[item.state].icon;
            return (
              <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                    <StateIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                      <span className={"rounded-full border px-2 py-0.5 text-[11px] font-semibold " + severityTone[item.severity]}>
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                    <p className="mt-1.5 text-[11px] font-medium text-muted-foreground/70">{stateTone[item.state].label}</p>
                  </div>
                </div>
                <Link href={item.href} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-brand/30 hover:bg-accent">
                  {item.action}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
