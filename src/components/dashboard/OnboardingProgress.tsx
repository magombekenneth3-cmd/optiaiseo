"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";

interface Step {
  id: string;
  label: string;
  href: string;
  done: boolean;
}

interface Props {
  steps: Step[];
}

export function OnboardingProgress({ steps }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;

  if (dismissed || (allDone && done > 0)) return null;

  const nextStep = steps.find((step) => !step.done) ?? steps[0];
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div
      className="relative mb-2 overflow-hidden rounded-2xl border p-4 shadow-sm"
      style={{
        background: "linear-gradient(135deg, var(--brand-muted), rgba(16, 185, 129, 0.04))",
        borderColor: "var(--brand-border)",
      }}
    >
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss onboarding checklist"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Activation</p>
            <p className="text-sm font-semibold text-foreground">Complete setup to unlock your first insights</p>
          </div>
        </div>

        <span className="rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {done}/{steps.length} done
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.4fr_0.7fr] md:items-center">
        <div className="space-y-2.5">
          {steps.map((step, i) => {
            const isNext = !step.done && steps.slice(0, i).every((s) => s.done);
            const isActive = step.id === nextStep.id;

            return (
              <div key={step.id} className="flex items-center gap-3">
                <div
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition-colors"
                  style={{
                    background: step.done ? "var(--brand)" : isActive ? "rgba(16, 185, 129, 0.08)" : "transparent",
                    borderColor: step.done ? "transparent" : isActive ? "var(--brand)" : "var(--border)",
                  }}
                >
                  {step.done && <Check className="w-3 h-3 text-white" />}
                </div>

                {step.done ? (
                  <span className="text-sm text-muted-foreground line-through">{step.label}</span>
                ) : isNext ? (
                  <Link
                    href={step.href}
                    className="text-sm font-medium transition-colors hover:underline"
                    style={{ color: "var(--brand)" }}
                  >
                    {step.label}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">{step.label}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-border/60 bg-background/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next step</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{nextStep.label}</p>
          <Link
            href={nextStep.href}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-95"
            style={{ background: "var(--brand)" }}
          >
            Continue
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--muted)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: "var(--brand)" }}
          />
        </div>
      </div>
    </div>
  );
}
