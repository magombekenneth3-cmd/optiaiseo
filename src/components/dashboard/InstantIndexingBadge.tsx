"use client";

import React from "react";

export interface InstantIndexingBadgeProps {
    status?: "ACTIVE" | "PENDING" | "PAUSED";
    lastIndexedUrl?: string;
    totalUrlsPinned?: number;
}

export function InstantIndexingBadge({
    status = "ACTIVE",
    lastIndexedUrl = "/blog/seo-guide",
    totalUrlsPinned = 42,
}: InstantIndexingBadgeProps) {
    return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-full text-xs text-slate-300 backdrop-blur-sm shadow-sm">
            <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-semibold text-white">Instant Indexing</span>
            <span className="text-slate-500">|</span>
            <span className="text-emerald-400 font-medium">{totalUrlsPinned} URLs Pinned</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400 truncate max-w-[120px]">{lastIndexedUrl}</span>
        </div>
    );
}
