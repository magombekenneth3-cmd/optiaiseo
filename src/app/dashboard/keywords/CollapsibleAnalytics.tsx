"use client";

import { useState } from "react";
import { ChevronDown, BarChart3 } from "lucide-react";
import { UnifiedAnalyticsPanel } from "@/components/dashboard/UnifiedAnalyticsPanel";

export function CollapsibleAnalytics({ siteId }: { siteId: string }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-info" />
                    <span className="text-sm font-semibold text-foreground">Traffic & Search Performance</span>
                    <span className="text-xs text-muted-foreground">GSC + GA4</span>
                </div>
                <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
            </button>
            {open && (
                <div className="border-t border-border">
                    <UnifiedAnalyticsPanel siteId={siteId} />
                </div>
            )}
        </div>
    );
}
