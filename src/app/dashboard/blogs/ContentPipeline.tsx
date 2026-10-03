"use client";

export type PipelineFilter =
    | "ALL"
    | "WRITING"
    | "EVIDENCE"
    | "REVIEW"
    | "READY"
    | "PUBLISHED"
    | "ISSUES";

interface PipelineCounts {
    total: number;
    writing: number;
    evidence: number;
    review: number;
    ready: number;
    published: number;
    issues: number;
}

const STAGES: {
    key: PipelineFilter;
    label: string;
    countKey: keyof PipelineCounts;
    activeColor: string;
    activeBg: string;
}[] = [
    { key: "ALL", label: "All", countKey: "total", activeColor: "text-foreground", activeBg: "bg-foreground/8" },
    { key: "WRITING", label: "Writing", countKey: "writing", activeColor: "text-blue-400", activeBg: "bg-blue-500/8" },
    { key: "EVIDENCE", label: "Evidence", countKey: "evidence", activeColor: "text-violet-400", activeBg: "bg-violet-500/8" },
    { key: "REVIEW", label: "Review", countKey: "review", activeColor: "text-orange-400", activeBg: "bg-orange-500/8" },
    { key: "READY", label: "Ready", countKey: "ready", activeColor: "text-emerald-400", activeBg: "bg-emerald-500/8" },
    { key: "PUBLISHED", label: "Published", countKey: "published", activeColor: "text-emerald-400", activeBg: "bg-emerald-500/8" },
    { key: "ISSUES", label: "Issues", countKey: "issues", activeColor: "text-red-400", activeBg: "bg-red-500/8" },
];

export function ContentPipeline({
    counts,
    activeFilter,
    onFilterChange,
}: {
    counts: PipelineCounts;
    activeFilter: PipelineFilter;
    onFilterChange: (filter: PipelineFilter) => void;
}) {
    return (
        <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-card/30 p-1">
            {STAGES.map((stage) => {
                const isActive = activeFilter === stage.key;
                const count = counts[stage.countKey];
                return (
                    <button
                        key={stage.key}
                        type="button"
                        onClick={() => onFilterChange(stage.key)}
                        className={`
                            flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs
                            transition-all duration-150 whitespace-nowrap
                            ${isActive
                                ? `${stage.activeBg} ${stage.activeColor} font-semibold`
                                : "font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                            }
                        `}
                    >
                        {stage.label}
                        <span className={`tabular-nums text-[11px] ${isActive ? "" : "opacity-50"}`}>
                            {count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
