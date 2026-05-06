"use client";
import { useEffect, useState } from "react";
import { getShareOfVoice }     from "@/app/actions/keywords";
import type { SovEntry }       from "@/lib/keywords/share-of-voice";

const PALETTE = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
    "#8b5cf6", "#06b6d4", "#f97316", "#6b7280",
];

export function ShareOfVoiceChart({ siteId }: { siteId: string }) {
    const [entries, setEntries] = useState<SovEntry[]>([]);
    const [loaded,  setLoaded]  = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    useEffect(() => {
        getShareOfVoice(siteId)
            .then((res) => {
                if (res.success) setEntries(res.entries ?? []);
                else             setError(res.error ?? "Failed");
            })
            .catch(() => setError("Failed to load"))
            .finally(() => setLoaded(true));
    }, [siteId]);

    if (!loaded) {
        return <div className="card-surface p-6 animate-pulse h-32 rounded-xl" aria-busy="true" />;
    }

    if (error || entries.length < 2) {
        return null;
    }

    const total    = entries.reduce((s, e) => s + e.clicks, 0);
    const myEntry  = entries.find((e) => e.isOwner);

    return (
        <div className="card-surface p-6">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h2 className="text-lg font-semibold">Organic Share of Voice</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Estimated click share across your tracked keywords
                    </p>
                </div>
                {myEntry && (
                    <div className="text-right">
                        <p className="text-2xl font-bold text-blue-400">{myEntry.sharePercent}%</p>
                        <p className="text-xs text-muted-foreground">your share</p>
                    </div>
                )}
            </div>

            {/* Stacked bar */}
            <div className="flex h-7 rounded-full overflow-hidden gap-px mb-4" role="img" aria-label="Share of voice bar chart">
                {entries.map((e, i) => (
                    <div
                        key={e.domain}
                        style={{ width: `${(e.clicks / total) * 100}%`, background: PALETTE[i] }}
                        title={`${e.domain}: ${e.sharePercent}%`}
                        className={`h-full transition-all ${e.isOwner ? "ring-2 ring-white/30" : ""}`}
                    />
                ))}
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
                {entries.map((e, i) => (
                    <div key={e.domain} className="flex items-center gap-2 min-w-0">
                        <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ background: PALETTE[i] }}
                        />
                        <span
                            className={`text-xs truncate ${e.isOwner ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                            title={e.domain}
                        >
                            {e.domain.replace(/^www\./, "").slice(0, 20)}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                            {e.sharePercent}%
                        </span>
                    </div>
                ))}
            </div>

            <p className="text-xs text-muted-foreground mt-4">
                Based on tracked keywords only · {total.toLocaleString()} estimated monthly clicks in set
            </p>
        </div>
    );
}
