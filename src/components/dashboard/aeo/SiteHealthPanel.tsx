"use client";
import React, { useState, useEffect } from "react";
import { Shield, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface Site {
    id: string;
    domain: string;
    competitors?: { domain: string }[];
}

interface SiteEntry {
    site: Site;
    latest: {
        citationScore?: number;
        score?: number;
        grade?: string | null;
        layerScores?: { aeo?: number; geo?: number; aio?: number } | null;
    } | null;
}

interface SiteHealthPanelProps {
    sites: SiteEntry[];
    activeSiteId?: string;
}

function scoreColor(s: number) {
    return s >= 65 ? "text-emerald-400" : s >= 40 ? "text-amber-400" : "text-rose-400";
}

const GRADE_COLORS: Record<string, string> = {
    A: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    B: "text-blue-400 border-blue-500/30 bg-blue-500/10",
    C: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    D: "text-orange-400 border-orange-500/30 bg-orange-500/10",
    F: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export function SiteHealthPanel({ sites, activeSiteId }: SiteHealthPanelProps) {
    const searchParams = useSearchParams();
    const [expanded, setExpanded] = useState(false);

    const display = expanded ? sites : sites.slice(0, 3);

    return (
        <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <p className="text-sm font-bold text-foreground">Site Health</p>
                </div>
                {sites.length > 3 && (
                    <button
                        onClick={() => setExpanded((e) => !e)}
                        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        {expanded ? "Show less" : `+${sites.length - 3} more`}
                    </button>
                )}
            </div>

            {/* Site rows */}
            {display.map(({ site, latest }) => {
                const rate = latest?.citationScore ?? latest?.score ?? null;
                const grade = latest?.grade ?? null;
                const ls = latest?.layerScores;
                const isActive = site.id === activeSiteId;

                const params = new URLSearchParams(searchParams.toString());
                params.set("siteId", site.id);

                return (
                    <div
                        key={site.id}
                        className={`rounded-xl border p-3 flex flex-col gap-2 transition-colors ${
                            isActive
                                ? "border-emerald-500/30 bg-emerald-500/5"
                                : "border-border/60 bg-muted/5 hover:bg-muted/10"
                        }`}
                    >
                        {/* Domain + grade */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                        rate !== null ? "bg-emerald-400" : "bg-muted-foreground/40"
                                    }`}
                                />
                                <span className="text-xs font-semibold text-foreground truncate">{site.domain}</span>
                            </div>
                            {grade && (
                                <span
                                    className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border shrink-0 ${
                                        GRADE_COLORS[grade] ?? "text-zinc-400 border-zinc-500/30 bg-zinc-500/10"
                                    }`}
                                >
                                    {grade}
                                </span>
                            )}
                        </div>

                        {/* Layer score badges */}
                        {ls && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                                {ls.aeo !== undefined && (
                                    <span className={`text-[10px] font-bold ${scoreColor(ls.aeo)}`}>
                                        AEO {ls.aeo}%
                                    </span>
                                )}
                                {ls.geo !== undefined && (
                                    <span className="text-muted-foreground/30 text-[10px]">·</span>
                                )}
                                {ls.geo !== undefined && (
                                    <span className={`text-[10px] font-bold ${scoreColor(ls.geo)}`}>
                                        GEO {ls.geo}%
                                    </span>
                                )}
                                {ls.aio !== undefined && (
                                    <span className="text-muted-foreground/30 text-[10px]">·</span>
                                )}
                                {ls.aio !== undefined && (
                                    <span className={`text-[10px] font-bold ${scoreColor(ls.aio)}`}>
                                        AIO {ls.aio}%
                                    </span>
                                )}
                            </div>
                        )}

                        {/* View details link */}
                        <Link
                            href={`/dashboard/aeo?${params.toString()}`}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors self-start"
                        >
                            View site details <ArrowUpRight className="w-2.5 h-2.5" />
                        </Link>
                    </div>
                );
            })}

            {sites.length === 0 && (
                <p className="text-xs text-muted-foreground/60 text-center">No sites registered yet.</p>
            )}
        </div>
    );
}
