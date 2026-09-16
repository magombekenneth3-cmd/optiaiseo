"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface PriorityAction {
    id: string;
    impact: "critical" | "high" | "medium" | "low";
    title: string;
    subtitle: string;
    reason?: string;
    confidence?: string;
    href: string;
    ctaLabel: string;
}

interface Props {
    actions: PriorityAction[];
}

const IMPACT_CLASS: Record<string, string> = {
    critical: "impact-badge impact-badge-critical",
    high: "impact-badge impact-badge-high",
    medium: "impact-badge impact-badge-medium",
    low: "impact-badge impact-badge-low",
};

export function PriorityActions({ actions }: Props) {
    if (actions.length === 0) return null;

    return (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {actions.map((action) => (
                <Link
                    key={action.id}
                    href={action.href}
                    className="group rounded-2xl border border-border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_12px_24px_rgba(16,185,129,0.08)]"
                >
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={IMPACT_CLASS[action.impact] ?? IMPACT_CLASS.medium}>
                            {action.impact}
                        </span>
                        {action.confidence && (
                            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {action.confidence}
                            </span>
                        )}
                    </div>

                    <div className="space-y-2">
                        <p className="text-[13px] font-semibold text-foreground leading-snug">
                            {action.title}
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            {action.subtitle}
                        </p>
                        {action.reason && (
                            <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2.5">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Why it matters</p>
                                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
                                    {action.reason}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                            Recommended next step
                        </span>
                        <span className="flex items-center gap-1 text-xs font-medium text-foreground group-hover:text-brand transition-colors">
                            {action.ctaLabel}
                            <ArrowRight className="w-3 h-3" />
                        </span>
                    </div>
                </Link>
            ))}
        </div>
    );
}
