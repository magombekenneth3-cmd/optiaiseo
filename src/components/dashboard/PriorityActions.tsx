"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface PriorityAction {
    id: string;
    impact: "critical" | "high" | "medium" | "low";
    title: string;
    subtitle: string;
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
        <section aria-label="Priority actions">
            <p className="section-label mb-3">Priority Actions</p>
            <div className="flex flex-col gap-2">
                {actions.map((action) => (
                    <Link
                        key={action.id}
                        href={action.href}
                        className="action-card group"
                    >
                        <span className={IMPACT_CLASS[action.impact] ?? IMPACT_CLASS.medium}>
                            {action.impact}
                        </span>

                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-foreground leading-snug">
                                {action.title}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {action.subtitle}
                            </p>
                        </div>

                        <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                            {action.ctaLabel}
                            <ArrowRight className="w-3 h-3" />
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    );
}
