"use client";

import { useState, useMemo } from "react";
import { AuditSidebar, type SeverityFilter, type AuditSidebarGroup } from "./AuditSidebar";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";
import type { ReactNode } from "react";

interface Props {
    domain: string;
    issues: NormalisedIssue[];
    runDate: string;
    children: (filter: SeverityFilter) => ReactNode;
}

export function AuditDetailClient({ domain, issues, runDate, children }: Props) {
    const [activeFilter, setActiveFilter] = useState<SeverityFilter>("all");

    const groups: AuditSidebarGroup[] = useMemo(() => {
        const catItems = (sev: SeverityFilter) => {
            const map: Record<string, number> = {};
            issues
                .filter((i) => i.severity === sev)
                .forEach((i) => {
                    const cat = (i.category ?? "general")
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                    map[cat] = (map[cat] ?? 0) + 1;
                });
            return Object.entries(map)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({ name, count }));
        };

        return (["critical", "high", "medium", "low"] as const)
            .map((sev) => ({
                label: ({ critical: "Critical", high: "High Priority", medium: "Medium", low: "Low" } as const)[sev],
                severity: sev,
                items: catItems(sev),
            }))
            .filter((g) => g.items.length > 0);
    }, [issues]);

    return (
        <div className="flex -mx-4 md:-mx-8 -mt-4 md:-mt-8 min-h-[calc(100vh-52px)]">
            <AuditSidebar
                domain={domain}
                totalIssues={issues.length}
                groups={groups}
                runDate={runDate}
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
            />
            <div className="flex-1 min-w-0 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-6 pb-20">
                    {children(activeFilter)}
                </div>
            </div>
        </div>
    );
}
