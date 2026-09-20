"use client";

import {
    FileText,
    PenLine,
    Shield,
    Eye,
    CheckCircle2,
    CircleCheck,
    AlertTriangle,
    ChevronRight,
} from "lucide-react";

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
    icon: typeof FileText;
    color: string;
    activeColor: string;
    activeBg: string;
    activeBorder: string;
    countKey: keyof PipelineCounts;
}[] = [
    {
        key: "ALL",
        label: "All",
        icon: FileText,
        color: "text-muted-foreground",
        activeColor: "text-foreground",
        activeBg: "bg-foreground/5",
        activeBorder: "border-b-foreground/60",
        countKey: "total",
    },
    {
        key: "WRITING",
        label: "Writing",
        icon: PenLine,
        color: "text-blue-400/60",
        activeColor: "text-blue-400",
        activeBg: "bg-blue-500/5",
        activeBorder: "border-b-blue-400",
        countKey: "writing",
    },
    {
        key: "EVIDENCE",
        label: "Evidence",
        icon: Shield,
        color: "text-violet-400/60",
        activeColor: "text-violet-400",
        activeBg: "bg-violet-500/5",
        activeBorder: "border-b-violet-400",
        countKey: "evidence",
    },
    {
        key: "REVIEW",
        label: "Review",
        icon: Eye,
        color: "text-orange-400/60",
        activeColor: "text-orange-400",
        activeBg: "bg-orange-500/5",
        activeBorder: "border-b-orange-400",
        countKey: "review",
    },
    {
        key: "READY",
        label: "Ready",
        icon: CircleCheck,
        color: "text-emerald-400/60",
        activeColor: "text-emerald-400",
        activeBg: "bg-emerald-500/5",
        activeBorder: "border-b-emerald-400",
        countKey: "ready",
    },
    {
        key: "PUBLISHED",
        label: "Published",
        icon: CheckCircle2,
        color: "text-emerald-400/60",
        activeColor: "text-emerald-400",
        activeBg: "bg-emerald-500/5",
        activeBorder: "border-b-emerald-500",
        countKey: "published",
    },
    {
        key: "ISSUES",
        label: "Issues",
        icon: AlertTriangle,
        color: "text-red-400/60",
        activeColor: "text-red-400",
        activeBg: "bg-red-500/5",
        activeBorder: "border-b-red-400",
        countKey: "issues",
    },
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
        <div className="rounded-2xl border border-border bg-card/40 px-2 py-1.5">
            <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground/60 px-3 pt-1.5 pb-0.5">
                <span>Content Pipeline</span>
            </div>
            <p className="px-3 pb-1.5 text-[10px] text-muted-foreground/40">Track your content from research to publication.</p>
            <div className="flex items-center gap-0.5 overflow-x-auto">
                {STAGES.map((stage, idx) => {
                    const Icon = stage.icon;
                    const isActive = activeFilter === stage.key;
                    const count = counts[stage.countKey];

                    return (
                        <div key={stage.key} className="flex items-center">
                            {idx > 0 && (
                                <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground/20" />
                            )}
                            <button
                                type="button"
                                onClick={() => onFilterChange(stage.key)}
                                className={`
                                    group relative flex items-center gap-2 rounded-xl px-3.5 py-2.5
                                    border-b-2 transition-all duration-200
                                    ${isActive
                                        ? `${stage.activeBg} ${stage.activeBorder} ${stage.activeColor}`
                                        : `border-b-transparent hover:bg-muted/30 ${stage.color}`
                                    }
                                `}
                            >
                                <div className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                                    isActive ? `${stage.activeBg}` : "bg-transparent group-hover:bg-muted/40"
                                }`}>
                                    <Icon className="h-3.5 w-3.5" />
                                </div>
                                <div className="flex flex-col items-start">
                                    <span className={`text-[11px] font-medium leading-none ${
                                        isActive ? stage.activeColor : "text-muted-foreground"
                                    }`}>
                                        {stage.label}
                                    </span>
                                    <span className={`mt-0.5 text-base font-bold leading-none tracking-tight ${
                                        isActive ? "text-foreground" : "text-foreground/70"
                                    }`}>
                                        {count}
                                    </span>
                                </div>
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
