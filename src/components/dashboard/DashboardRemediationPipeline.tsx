import Link from "next/link";
import { ArrowRight, CheckCircle2, GitPullRequest, ShieldCheck, Sparkles } from "lucide-react";

interface Props {
  proposed: number;
  active: number;
  completed: number;
  verified: number;
}

const steps = [
  { key: "proposed", label: "Proposed", icon: Sparkles },
  { key: "active", label: "In progress", icon: GitPullRequest },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
  { key: "verified", label: "Verified", icon: ShieldCheck },
] as const;

export function DashboardRemediationPipeline({ proposed, active, completed, verified }: Props) {
  const values = { proposed, active, completed, verified };
  const total = proposed + active + completed + verified;

  return (
    <section aria-labelledby="dashboard-remediation" className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Remediation</p>
          <h2 id="dashboard-remediation" className="mt-1 text-sm font-semibold text-foreground">From recommendation to verified outcome</h2>
        </div>
        <Link href="/dashboard/operations" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          Open operations
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.key} className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                {step.key === "verified" && verified > 0 && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              </div>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{values[step.key]}</p>
              <p className="mt-1 text-xs text-muted-foreground">{step.label}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3.5">
        <span className="text-xs text-muted-foreground">{total > 0 ? total + " remediation event" + (total === 1 ? "" : "s") + " in the current pipeline" : "No remediation activity yet"}</span>
        <Link href="/dashboard/recommendations" className="text-xs font-semibold text-brand hover:underline">
          Find opportunities
        </Link>
      </div>
    </section>
  );
}
