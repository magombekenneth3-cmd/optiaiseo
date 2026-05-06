"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";

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

  const pct = Math.round((done / steps.length) * 100);

  return (
    <div
      className="relative rounded-xl p-4 mb-2 border"
      style={{
        background: "var(--brand-muted)",
        borderColor: "var(--brand-border)",
      }}
    >
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss onboarding checklist"
      >
        <X className="w-4 h-4" />
      </button>

      <p className="text-sm font-semibold mb-3 text-foreground">
        Get full value in {steps.length} steps
        <span className="text-muted-foreground font-normal ml-2">
          {done}/{steps.length} complete
        </span>
      </p>

      <div className="flex flex-col gap-2.5 mb-4">
        {steps.map((step, i) => {
          const isNext = !step.done && steps.slice(0, i).every((s) => s.done);
          return (
            <div key={step.id} className="flex items-center gap-3">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  background: step.done ? "var(--brand)" : "transparent",
                  border: step.done
                    ? "none"
                    : isNext
                    ? "2px solid var(--brand)"
                    : "1px solid var(--border)",
                }}
              >
                {step.done && <Check className="w-3 h-3 text-white" />}
              </div>
              {step.done ? (
                <span className="text-sm text-muted-foreground line-through">
                  {step.label}
                </span>
              ) : isNext ? (
                <Link
                  href={step.href}
                  className="text-sm font-medium text-foreground hover:underline transition-colors"
                  style={{ color: "var(--brand)" }}
                >
                  {step.label} →
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">{step.label}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--brand)" }}
        />
      </div>
    </div>
  );
}
