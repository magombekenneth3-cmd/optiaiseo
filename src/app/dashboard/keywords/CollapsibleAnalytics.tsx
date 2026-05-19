"use client";

import { useState } from "react";
import { ChevronDown, BarChart3 } from "lucide-react";
import { UnifiedAnalyticsPanel } from "@/components/dashboard/UnifiedAnalyticsPanel";

export function CollapsibleAnalytics({ siteId }: { siteId: string }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#0f1318] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#388bfd]" />
                    <span className="text-[13px] font-semibold text-[#e6edf3]">Analytics Overview</span>
                    <span className="text-[11px] text-[#6e7681]">GSC + GA4</span>
                </div>
                <ChevronDown
                    className={`w-4 h-4 text-[#6e7681] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
            </button>
            {open && (
                <div className="border-t border-[#21262d]">
                    <UnifiedAnalyticsPanel siteId={siteId} />
                </div>
            )}
        </div>
    );
}
