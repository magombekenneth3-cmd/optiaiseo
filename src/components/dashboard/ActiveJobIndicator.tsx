"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useJobManager } from "@/context/JobProvider";

export function ActiveJobIndicator() {
    const { activeJobs } = useJobManager();

    if (activeJobs.length === 0) return null;

    const currentJob = activeJobs[0];

    return (
        <Link
            href={currentJob.targetHref ?? "/dashboard"}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-semibold hover:bg-brand/15 transition-all shadow-sm shadow-brand/10 animate-pulse"
            title={`${currentJob.title} (${currentJob.progressPct}%) — Click to view`}
        >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-brand" />
            <span className="truncate max-w-[130px] sm:max-w-[180px]">
                {currentJob.title.replace(/^AEO Audit — /, "AEO ").replace(/^SEO Audit — /, "Audit ")}
            </span>
            <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-brand/20 text-brand shrink-0">
                {currentJob.progressPct}%
            </span>
        </Link>
    );
}
