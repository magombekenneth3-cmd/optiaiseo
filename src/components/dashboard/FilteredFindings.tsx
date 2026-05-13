"use client";

import { useState, useMemo } from "react";
import { IssueRow } from "@/app/dashboard/audits/[id]/IssueRow";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";
import { Search, ChevronDown, ChevronRight, AlertCircle, AlertTriangle, Info, Minus } from "lucide-react";

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const CATEGORY_ORDER = [
    "basics", "on-page", "onpage", "technical", "off-page", "offpage",
    "schema", "accessibility", "keywords", "social", "local",
] as const;

const SEV_CONFIG: Record<string, {
    label: string;
    color: string;
    bg: string;
    border: string;
    textCls: string;
    Icon: React.FC<{ className?: string }>;
    dotCls: string;
}> = {
    critical: {
        label: "Critical", color: "#f85149", bg: "#2c1417", border: "rgba(248,81,73,0.25)",
        textCls: "text-[#f85149]", Icon: AlertCircle, dotCls: "bg-[#f85149]",
    },
    high: {
        label: "High", color: "#d29922", bg: "#2d2208", border: "rgba(210,153,34,0.25)",
        textCls: "text-[#d29922]", Icon: AlertTriangle, dotCls: "bg-[#d29922]",
    },
    medium: {
        label: "Medium", color: "#388bfd", bg: "#1c2b3a", border: "rgba(56,139,253,0.25)",
        textCls: "text-[#388bfd]", Icon: Info, dotCls: "bg-[#388bfd]",
    },
    low: {
        label: "Low", color: "#6e7681", bg: "#21262d", border: "#30363d",
        textCls: "text-[#6e7681]", Icon: Minus, dotCls: "bg-[#6e7681]",
    },
};

interface Props {
    issues: NormalisedIssue[];
    siteId: string;
    domain: string;
    hasGithub: boolean;
    fixStatus?: string;
}

function CategoryAccordion({
    cat,
    catIssues,
    siteId,
    domain,
    hasGithub,
    fixStatus,
}: {
    cat: string;
    catIssues: NormalisedIssue[];
    siteId: string;
    domain: string;
    hasGithub: boolean;
    fixStatus?: string;
}) {
    const [open, setOpen] = useState(true);

    const counts = {
        critical: catIssues.filter((i) => i.severity === "critical").length,
        high: catIssues.filter((i) => i.severity === "high").length,
        medium: catIssues.filter((i) => i.severity === "medium").length,
        low: catIssues.filter((i) => i.severity === "low").length,
    };

    const impactScore = catIssues.reduce((acc, i) => {
        const s = i.severity;
        return acc + (s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1);
    }, 0);
    const maxImpact = catIssues.length * 4;
    const impactPct = Math.round((impactScore / maxImpact) * 100);

    return (
        <div className="border border-[#21262d] rounded-xl overflow-hidden mb-3 last:mb-0">
            {/* Category header */}
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-[#0d1117] hover:bg-[#161b22] transition-colors text-left group"
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {open ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                    ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
                    )}
                    <span className="text-[13px] font-semibold text-[#c9d1d9] capitalize truncate">
                        {cat.replace(/-/g, " ")}
                    </span>
                    <span className="text-[11px] text-[#6e7681]">{catIssues.length} issues</span>
                </div>

                {/* Severity mini-pills */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {counts.critical > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#2c1417] text-[#f85149] border-[rgba(248,81,73,0.25)]">
                            {counts.critical} crit
                        </span>
                    )}
                    {counts.high > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#2d2208] text-[#d29922] border-[rgba(210,153,34,0.25)]">
                            {counts.high} high
                        </span>
                    )}
                    {counts.medium > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#1c2b3a] text-[#388bfd] border-[rgba(56,139,253,0.25)]">
                            {counts.medium} med
                        </span>
                    )}
                    {counts.low > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#21262d] text-[#6e7681] border-[#30363d]">
                            {counts.low} low
                        </span>
                    )}
                </div>

                {/* Impact bar */}
                <div className="hidden sm:flex items-center gap-2 shrink-0 w-[80px]">
                    <div className="flex-1 h-[4px] bg-[#21262d] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${impactPct}%`,
                                background: impactPct > 66 ? "#f85149" : impactPct > 33 ? "#d29922" : "#6e7681",
                            }}
                        />
                    </div>
                </div>
            </button>

            {/* Issues list */}
            {open && (
                <div className="bg-[#0d1117] divide-y divide-[#161b22] border-t border-[#21262d]">
                    {catIssues.map((issue, i) => {
                        const sev = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.low;
                        return (
                            <div
                                key={issue.id || i}
                                className="flex items-start gap-0 hover:bg-[#161b22] transition-colors"
                            >
                                {/* Severity stripe */}
                                <div
                                    className="w-[3px] self-stretch shrink-0"
                                    style={{ background: sev.color, opacity: 0.7 }}
                                />
                                {/* Severity dot */}
                                <div className="pl-3 pr-2 py-3.5 flex items-center justify-center shrink-0">
                                    <sev.Icon
                                        className={`w-3.5 h-3.5 ${sev.textCls}`}
                                    />
                                </div>
                                {/* Main content */}
                                <div className="flex-1 min-w-0 py-1.5">
                                    <IssueRow
                                        issue={issue}
                                        siteId={siteId}
                                        domain={domain}
                                        hasGithub={hasGithub}
                                        fixStatus={fixStatus}
                                    />
                                </div>
                                {/* Badge pill */}
                                <div className="px-3 py-3.5 shrink-0">
                                    <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border"
                                        style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}
                                    >
                                        {sev.label}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function FilteredFindings({ issues, siteId, domain, hasGithub, fixStatus }: Props) {
    const [activeFilter, setActiveFilter] = useState<SeverityFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");

    const counts = useMemo(() => ({
        all: issues.length,
        critical: issues.filter((i) => i.severity === "critical").length,
        high: issues.filter((i) => i.severity === "high").length,
        medium: issues.filter((i) => i.severity === "medium").length,
        low: issues.filter((i) => i.severity === "low").length,
    }), [issues]);

    const filtered = useMemo(() => {
        let list = activeFilter === "all" ? issues : issues.filter((i) => i.severity === activeFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(
                (i) =>
                    (i.title ?? "").toLowerCase().includes(q) ||
                    (i.description ?? "").toLowerCase().includes(q) ||
                    (i.category ?? "").toLowerCase().includes(q)
            );
        }
        return list;
    }, [issues, activeFilter, searchQuery]);

    const grouped = useMemo(() => {
        const acc: Record<string, NormalisedIssue[]> = {};
        filtered.forEach((issue) => {
            const cat = (issue.category ?? "general").toLowerCase().replace(/\s+/g, "-");
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(issue);
        });
        return acc;
    }, [filtered]);

    const sortedCats = useMemo(() =>
        Object.keys(grouped).sort((a, b) => {
            const ia = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
            const ib = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        })
    , [grouped]);

    const tabs: { key: SeverityFilter; label: string; count: number; color?: string }[] = [
        { key: "all", label: "All issues", count: counts.all },
        { key: "critical", label: "Critical", count: counts.critical, color: "#f85149" },
        { key: "high", label: "High", count: counts.high, color: "#d29922" },
        { key: "medium", label: "Medium", count: counts.medium, color: "#388bfd" },
        { key: "low", label: "Low", count: counts.low, color: "#6e7681" },
    ];

    return (
        <div id="section-findings" className="flex flex-col gap-0">
            {/* Section label */}
            <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.1em] whitespace-nowrap">
                    All Findings
                </span>
                <div className="flex-1 h-px bg-[#21262d]" />
                <span className="text-[10px] text-[#6e7681]">
                    {filtered.length} of {issues.length} shown
                </span>
            </div>

            {/* Controls row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                {/* Horizontal tab pills — Ahrefs style */}
                <div className="flex items-center gap-1 bg-[#161b22] border border-[#30363d] rounded-lg p-1 flex-wrap">
                    {tabs.map((tab) => {
                        const isActive = activeFilter === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveFilter(tab.key)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                                    isActive
                                        ? "bg-[#21262d] text-[#e6edf3] shadow-sm"
                                        : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]/50"
                                }`}
                            >
                                {tab.color && (
                                    <span
                                        className="w-[6px] h-[6px] rounded-full shrink-0"
                                        style={{ background: isActive ? tab.color : "#6e7681" }}
                                    />
                                )}
                                {tab.label}
                                <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center transition-colors ${
                                        isActive && tab.color
                                            ? ""
                                            : "bg-[#21262d] text-[#6e7681]"
                                    }`}
                                    style={isActive && tab.color ? {
                                        background: `${tab.color}20`,
                                        color: tab.color,
                                    } : {}}
                                >
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search input */}
                <div className="relative flex-1 sm:max-w-[300px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681]" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search issues…"
                        className="w-full bg-[#161b22] border border-[#30363d] rounded-lg pl-9 pr-4 py-2 text-[12px] text-[#c9d1d9] placeholder:text-[#6e7681] focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd]/30 transition-all"
                    />
                </div>
            </div>

            {/* Issue groups */}
            {sortedCats.length > 0 ? (
                <div>
                    {sortedCats.map((cat) => (
                        <CategoryAccordion
                            key={cat}
                            cat={cat}
                            catIssues={grouped[cat]}
                            siteId={siteId}
                            domain={domain}
                            hasGithub={hasGithub}
                            fixStatus={fixStatus}
                        />
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-6 py-12 text-center">
                    <Search className="w-8 h-8 text-[#6e7681] mx-auto mb-3 opacity-50" />
                    <p className="text-[13px] text-[#6e7681]">No issues match the current filters.</p>
                    <button
                        onClick={() => { setActiveFilter("all"); setSearchQuery(""); }}
                        className="mt-3 text-[12px] text-[#388bfd] hover:underline"
                    >
                        Clear filters
                    </button>
                </div>
            )}
        </div>
    );
}
