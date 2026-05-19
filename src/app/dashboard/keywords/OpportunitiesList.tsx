"use client";

import { useState } from "react";
import { Zap, ChevronDown } from "lucide-react";
import { GenerateBlogButton } from "./GenerateBlogButton";

function posColor(pos: number) {
    if (pos <= 3)  return { text: "#2ea043", bg: "#0d2818", border: "rgba(46,160,67,0.3)"   };
    if (pos <= 10) return { text: "#388bfd", bg: "#0d1f3c", border: "rgba(56,139,253,0.3)"  };
    if (pos <= 20) return { text: "#d29922", bg: "#2d2208", border: "rgba(210,153,34,0.3)"  };
    return         { text: "#f85149", bg: "#2c1417", border: "rgba(248,81,73,0.3)"          };
}

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface Opportunity {
    keyword: string;
    avgPosition: number;
    impressions: number;
    ctr: number;
    opportunityScore: number;
    reason: string;
}

const INITIAL_SHOW = 5;

export function OpportunitiesList({
    opportunities,
    siteId,
    siteDomain,
}: {
    opportunities: Opportunity[];
    siteId: string;
    siteDomain: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? opportunities : opportunities.slice(0, INITIAL_SHOW);
    const hasMore = opportunities.length > INITIAL_SHOW;

    if (opportunities.length === 0) {
        return (
            <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-[#21262d]">
                    <Zap className="w-4 h-4 text-[#d29922]" />
                    <h2 className="text-[15px] font-semibold text-[#e6edf3]">Top Keyword Opportunities</h2>
                </div>
                <div className="px-6 py-10 text-center text-[13px] text-[#6e7681]">
                    No clear opportunities found yet. Check back after more data accumulates in Search Console.
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#21262d]">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <Zap className="w-4 h-4 text-[#d29922]" />
                        <h2 className="text-[15px] font-semibold text-[#e6edf3]">Top Keyword Opportunities</h2>
                    </div>
                    <p className="text-[12px] text-[#6e7681]">
                        High-impression keywords with poor rankings — generate a blog post to rank higher.
                    </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#d29922]/10 text-[#d29922] border border-[#d29922]/20">
                    {opportunities.length} found
                </span>
            </div>

            {/* List */}
            <div className="divide-y divide-[#161b22]">
                {visible.map((opp, i) => {
                    const pc = posColor(opp.avgPosition);
                    return (
                        <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#0f1318] transition-colors">
                            <span
                                className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-md border"
                                style={{ color: pc.text, background: pc.bg, borderColor: pc.border }}
                            >
                                #{opp.avgPosition}
                            </span>

                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-[#e6edf3] truncate">{opp.keyword}</p>
                                <p className="text-[11px] text-[#6e7681] mt-0.5 line-clamp-1">{opp.reason}</p>
                            </div>

                            <div className="hidden sm:flex items-center gap-4 shrink-0 text-[11px] text-[#6e7681]">
                                <span>{fmt(opp.impressions)} impr</span>
                                <span>{opp.ctr}% CTR</span>
                                <span className="font-bold text-[#d29922]">Score {opp.opportunityScore}</span>
                            </div>

                            <div className="shrink-0">
                                <GenerateBlogButton
                                    keyword={opp.keyword}
                                    position={opp.avgPosition}
                                    impressions={opp.impressions}
                                    siteId={siteId}
                                    siteDomain={siteDomain}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Expand toggle */}
            {hasMore && (
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="w-full flex items-center justify-center gap-1.5 px-5 py-2.5 border-t border-[#21262d] text-[11px] font-semibold text-[#388bfd] hover:bg-[#0f1318] transition-colors"
                >
                    {expanded ? "Show less" : `Show all ${opportunities.length} opportunities`}
                    <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
            )}
        </div>
    );
}
