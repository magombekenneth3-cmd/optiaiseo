"use client";

/**
 * ReAuditNudge
 * ─────────────────────────────────────────────────────────────────────────────
 * A soft, dismissable prompt shown when the last audit is >7 days old.
 * Clicking "Run Audit Now" fires a POST to /api/audits/run (existing endpoint)
 * for the primary site, then redirects to the audits page.
 *
 * Dismissed state is stored in sessionStorage so it re-appears on the next
 * browser session (weekly reminder, not permanent dismissal).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";

interface Props {
    daysSince: number;
    siteId: string;
    siteUrl: string;
}

export function ReAuditNudge({ daysSince, siteId, siteUrl }: Props) {
    const router = useRouter();
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const sessionKey = `re-audit-nudge:${siteId}`;

    useEffect(() => {
        try {
            if (!sessionStorage.getItem(sessionKey)) setVisible(true);
        } catch { /* ignore */ }
    }, [sessionKey]);

    function dismiss() {
        setVisible(false);
        try { sessionStorage.setItem(sessionKey, "1"); } catch { /* ignore */ }
    }

    async function runAudit() {
        setLoading(true);
        try {
            const res = await fetch("/api/audits/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ siteId, url: siteUrl }),
            });
            if (!res.ok) {
                throw new Error(`Server error ${res.status}`);
            }
            router.push("/dashboard/audits");
        } catch {
            setLoading(false);
            const { toast } = await import("sonner");
            toast.error("Failed to start audit — please try again.");
        }
    }

    if (!visible) return null;

    const urgency = daysSince >= 14 ? "rose" : daysSince >= 10 ? "amber" : "blue";

    const colorMap = {
        rose:  { bg: "bg-rose-950/40",  border: "border-rose-500/30",  text: "text-rose-400",  btn: "bg-rose-500 hover:bg-rose-600" },
        amber: { bg: "bg-amber-950/40", border: "border-amber-500/30", text: "text-amber-400", btn: "bg-amber-500 hover:bg-amber-600" },
        blue:  { bg: "bg-blue-950/40",  border: "border-blue-500/30",  text: "text-blue-400",  btn: "bg-blue-500 hover:bg-blue-600" },
    };
    const c = colorMap[urgency];

    return (
        <div className={`fade-in-up w-full rounded-2xl border ${c.border} ${c.bg} p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3`}>
            <div className={`shrink-0 w-9 h-9 rounded-xl bg-current/10 border border-current/20 flex items-center justify-center ${c.text}`}>
                <RefreshCw className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">
                    Last audit was {daysSince} day{daysSince !== 1 ? "s" : ""} ago
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                    {daysSince >= 14
                        ? "Two weeks without a check — new issues may have compounded."
                        : "Run a fresh audit to catch anything new before it affects rankings."}
                </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                <button
                    onClick={runAudit}
                    disabled={loading}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md disabled:opacity-60 disabled:cursor-not-allowed ${c.btn}`}
                >
                    {loading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {loading ? "Starting…" : "Run Audit Now"}
                </button>
                <button
                    onClick={dismiss}
                    aria-label="Dismiss re-audit nudge"
                    className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
