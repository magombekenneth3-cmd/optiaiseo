"use client";

import { useState, useMemo } from "react";
import { useAuditFilter } from "./AuditDetailClient";
import { IssueRow } from "@/app/dashboard/audits/[id]/IssueRow";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";

type LocalFilter = "all" | "critical" | "high" | "medium" | "low";

const CATEGORY_ORDER = [
    "basics", "on-page", "onpage", "technical", "off-page", "offpage",
    "schema", "accessibility", "keywords", "social", "local",
] as const;

const SEV_TAG: Record<string, { cls: string; label: string }> = {
    critical: { cls: "bg-[#2c1417] text-[#f85149] border border-[rgba(248,81,73,0.25)]", label: "Critical" },
    high:     { cls: "bg-[#2d2208] text-[#d29922] border border-[rgba(210,153,34,0.25)]", label: "High" },
    medium:   { cls: "bg-[#1c2b3a] text-[#388bfd] border border-[rgba(56,139,253,0.25)]", label: "Medium" },
    low:      { cls: "bg-[#21262d] text-[#6e7681] border border-[#30363d]", label: "Low" },
};

interface Props {
    issues: NormalisedIssue[];
    siteId: string;
    domain: string;
    hasGithub: boolean;
    fixStatus?: string;
}

function ImpactPips({ score }: { score: number }) {
    const level = Math.min(5, Math.max(1, Math.round(score / 20)));
    return (
        <div className="flex gap-[2px]">
            {[1, 2, 3, 4, 5].map((p) => (
                <div
                    key={p}
                    className={`w-[5px] h-[16px] rounded-[2px] ${
                        p <= level
                            ? level >= 4
                                ? "bg-[#f85149]"
                                : level >= 3
                                    ? "bg-[#d29922]"
                                    : "bg-[#6e7681]"
                            : "bg-[#21262d]"
                    }`}
                />
            ))}
        </div>
    );
}

export function FilteredFindings({ issues, siteId, domain, hasGithub, fixStatus }: Props) {
    const sidebarFilter = useAuditFilter();
    const [localFilter, setLocalFilter] = useState<LocalFilter>("all");

    const activeFilter = sidebarFilter !== "all" ? sidebarFilter : localFilter;

    const filtered = useMemo(() => {
        if (activeFilter === "all") return issues;
        return issues.filter((i) => i.severity === activeFilter);
    }, [issues, activeFilter]);

    const grouped = useMemo(() => {
        const acc: Record<string, NormalisedIssue[]> = {};
        filtered.forEach((issue) => {
            const cat = (issue.category ?? "general").toLowerCase().replace(/\s+/g, "-");
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(issue);
        });
        return acc;
    }, [filtered]);

    const sortedCats = useMemo(() => {
        return Object.keys(grouped).sort((a, b) => {
            const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
            const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }, [grouped]);

    const counts = useMemo(() => ({
        all: issues.length,
        critical: issues.filter((i) => i.severity === "critical").length,
        high: issues.filter((i) => i.severity === "high").length,
        medium: issues.filter((i) => i.severity === "medium").length,
        low: issues.filter((i) => i.severity === "low").length,
    }), [issues]);

    const tabs: { key: LocalFilter; label: string; count: number }[] = [
        { key: "all", label: "All", count: counts.all },
        { key: "critical", label: "Critical", count: counts.critical },
        { key: "high", label: "High", count: counts.high },
        { key: "medium", label: "Medium", count: counts.medium },
        { key: "low", label: "Low", count: counts.low },
    ];

    return (
        <div className="flex flex-col gap-0">
            <div className="flex items-center justify-between mb-3 mt-1">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.06em] whitespace-nowrap">
                        Issues
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[10px] bg-[rgba(248,81,73,0.18)] text-[#f85149]">
                        {filtered.length} remaining
                    </span>
                </div>
                <div className="flex gap-1 bg-[#161b22] border border-[#30363d] rounded-md p-[3px]">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setLocalFilter(tab.key)}
                            className={`px-2.5 py-1 rounded text-[12px] transition-all font-medium ${
                                activeFilter === tab.key
                                    ? "bg-[#21262d] text-[#e6edf3]"
                                    : "text-[#8b949e] hover:text-[#e6edf3]"
                            }`}
                        >
                            {tab.label} ({tab.count})
                        </button>
                    ))}
                </div>
            </div>

            <div className="bg-[#161b22] border border-[#30363d] rounded-[10px] overflow-hidden">
                <div className="grid grid-cols-[36px_1fr_90px_100px_80px] bg-[#1c2128] border-b border-[#30363d]">
                    <div className="px-4 py-2.5" />
                    <div className="px-4 py-2.5 text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">Issue</div>
                    <div className="px-4 py-2.5 text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">Severity</div>
                    <div className="px-4 py-2.5 text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">Category</div>
                    <div className="px-4 py-2.5 text-[11px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">Impact</div>
                </div>

                {sortedCats.map((cat) => {
                    const catIssues = grouped[cat];
                    const criticals = catIssues.filter((i) => i.severity === "critical").length;
                    return (
                        <div key={cat}>
                            <div className="flex items-center gap-2.5 px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
                                <span className="text-[11px] font-semibold text-[#8b949e] capitalize">{cat.replace(/-/g, " ")}</span>
                                <span className="text-[10px] text-[#6e7681]">{catIssues.length} {catIssues.length === 1 ? "issue" : "issues"}</span>
                                {criticals > 0 && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(248,81,73,0.15)] text-[#f85149]">
                                        {criticals} critical
                                    </span>
                                )}
                            </div>
                            {catIssues.map((issue, i) => {
                                const sev = SEV_TAG[issue.severity] ?? SEV_TAG.low;
                                const impactScore = issue.priorityScore ?? Math.round((issue.roiImpact ?? 50) * 0.6 + (issue.aiVisibilityImpact ?? 50) * 0.4);
                                return (
                                    <div key={issue.id || i} className="border-b border-[#30363d] last:border-b-0">
                                        <div className="grid grid-cols-[36px_1fr_90px_100px_80px] items-start hover:bg-[#1c2128] transition-colors">
                                            <div className="px-4 py-3 flex items-center justify-center">
                                                <div className={`w-[8px] h-[8px] rounded-full ${
                                                    issue.severity === "critical" ? "bg-[#f85149]"
                                                    : issue.severity === "high" ? "bg-[#d29922]"
                                                    : issue.severity === "medium" ? "bg-[#388bfd]"
                                                    : "bg-[#6e7681]"
                                                }`} />
                                            </div>
                                            <div className="px-4 py-3 min-w-0">
                                                <IssueRow
                                                    issue={issue}
                                                    siteId={siteId}
                                                    domain={domain}
                                                    hasGithub={hasGithub}
                                                    fixStatus={fixStatus}
                                                />
                                            </div>
                                            <div className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1 px-[7px] py-[2px] rounded text-[11px] font-medium ${sev.cls}`}>
                                                    {sev.label}
                                                </span>
                                            </div>
                                            <div className="px-4 py-3">
                                                <span className="text-[11px] text-[#6e7681] capitalize">{(issue.category ?? "general").replace(/-/g, " ")}</span>
                                            </div>
                                            <div className="px-4 py-3">
                                                <ImpactPips score={impactScore} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                {filtered.length === 0 && (
                    <div className="px-6 py-12 text-center text-[13px] text-[#6e7681]">
                        No issues match the current filter.
                    </div>
                )}
            </div>
        </div>
    );
}
