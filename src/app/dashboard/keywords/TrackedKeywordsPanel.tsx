"use client";
import { useState, useTransition } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { addTrackedKeyword, removeTrackedKeyword, getTrackedKeywords } from "@/app/actions/trackedKeywords";
import { estimateKeywordRoi, opportunityGap } from "@/lib/keywords/roi";
import { KeywordSparkline } from "@/components/dashboard/KeywordSparkline";

interface Snapshot {
    position:     number;
    recordedAt:   Date;
    searchVolume: number | null;
    cpc?:         number | null;
}

interface TrackedKw {
    id:                string;
    keyword:           string;
    snapshots:         Snapshot[];
    roi:               ReturnType<typeof estimateKeywordRoi> | null;
    opportunityGapUsd: number;
}

interface Props {
    siteId:      string;
    initialData: TrackedKw[];
    tier:        string;
    maxTracked:  number;
}

export function TrackedKeywordsPanel({ siteId, initialData, tier, maxTracked }: Props) {
    const [keywords, setKeywords] = useState<TrackedKw[]>(initialData);
    const [input,    setInput]    = useState("");
    const [error,    setError]    = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const atLimit = maxTracked !== -1 && keywords.length >= maxTracked;

    function handleAdd() {
        const raw = input.trim();
        if (!raw || raw.length > 200) { setError("Enter a keyword (max 200 chars)"); return; }
        setError(null);

        startTransition(async () => {
            const res = await addTrackedKeyword(siteId, raw);
            if (!res.success) { setError(res.error ?? "Failed to add"); return; }
            setInput("");
            const fresh = await getTrackedKeywords(siteId);
            if (fresh.success && fresh.keywords) setKeywords(fresh.keywords as TrackedKw[]);
        });
    }

    function handleRemove(trackedId: string) {
        startTransition(async () => {
            const res = await removeTrackedKeyword(siteId, trackedId);
            if (!res.success) { setError(res.error ?? "Failed to remove"); return; }
            setKeywords((prev) => prev.filter((k) => k.id !== trackedId));
        });
    }

    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-semibold">Tracked Keywords</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Monitor specific keywords daily — see real position history and revenue impact.
                    </p>
                </div>
                <span className="text-xs text-muted-foreground">
                    {maxTracked === -1
                        ? `${keywords.length} tracked`
                        : `${keywords.length} / ${maxTracked}`}
                </span>
            </div>

            {/* Add row */}
            <div className="p-4 border-b border-border flex gap-2">
                <input
                    type="text"
                    placeholder="e.g. best seo tool for agencies"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !atLimit && handleAdd()}
                    maxLength={200}
                    disabled={atLimit || isPending}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm
                               placeholder:text-muted-foreground focus:outline-none focus:ring-2
                               focus:ring-primary/50 disabled:opacity-50"
                    aria-label="Keyword to track"
                    id="tracked-keyword-input"
                />
                <button
                    onClick={handleAdd}
                    disabled={!input.trim() || atLimit || isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary
                               text-primary-foreground text-sm font-medium hover:bg-primary/90
                               disabled:opacity-50 transition-colors"
                    id="tracked-keyword-add-btn"
                >
                    <Plus className="w-4 h-4" />
                    Track
                </button>
            </div>

            {atLimit && (
                <p className="px-4 py-2 text-xs text-amber-400 bg-amber-500/5 border-b border-border">
                    {tier} plan limit reached.{" "}
                    <a href="/dashboard/billing" className="underline">Upgrade</a> for more tracked keywords.
                </p>
            )}

            {error && (
                <p className="px-4 py-2 text-xs text-red-400 bg-red-500/5 border-b border-border">{error}</p>
            )}

            {keywords.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                    No tracked keywords yet. Add your most important target keywords above.
                </div>
            ) : (
                <>
                    {/* Mobile */}
                    <div className="md:hidden divide-y divide-border">
                        {keywords.map((kw) => {
                            const latest = kw.snapshots.at(-1);
                            return (
                                <div key={kw.id} className="flex items-center gap-3 px-4 py-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{kw.keyword}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {latest ? `#${latest.position}` : "Pending"}{" "}
                                            {kw.roi ? `· ~$${kw.roi.estimatedRevenueUsd}/mo` : ""}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleRemove(kw.id)}
                                        className="shrink-0 p-1.5 rounded-md text-muted-foreground
                                                   hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        aria-label={`Remove ${kw.keyword}`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Desktop */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-card/50 text-xs font-semibold text-muted-foreground
                                              uppercase border-b border-border">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Keyword</th>
                                    <th scope="col" className="px-6 py-3">Position</th>
                                    <th scope="col" className="px-6 py-3">6-Week Trend</th>
                                    <th scope="col" className="px-6 py-3">Est. Value/mo</th>
                                    <th scope="col" className="px-6 py-3">Opp. at #3</th>
                                    <th scope="col" className="px-6 py-3 text-right">Remove</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {keywords.map((kw) => {
                                    const latest    = kw.snapshots.at(-1);
                                    const trend     = (() => {
                                        const h = kw.snapshots;
                                        if (h.length < 2) return "flat" as const;
                                        const d = h[h.length - 1].position - h[0].position;
                                        return d < -2 ? "up" as const : d > 2 ? "down" as const : "flat" as const;
                                    })();
                                    const TrendIcon = trend === "up"
                                        ? TrendingUp
                                        : trend === "down"
                                        ? TrendingDown
                                        : Minus;
                                    const trendColor = trend === "up"
                                        ? "text-emerald-400"
                                        : trend === "down"
                                        ? "text-red-400"
                                        : "text-muted-foreground";

                                    return (
                                        <tr key={kw.id} className="hover:bg-card transition-colors">
                                            <td className="px-6 py-3.5 font-medium max-w-[200px] truncate"
                                                title={kw.keyword}>
                                                {kw.keyword}
                                            </td>
                                            <td className="px-6 py-3.5">
                                                {latest
                                                    ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${
                                                        latest.position <= 3
                                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                            : latest.position <= 10
                                                            ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                                    }`}>#{latest.position}</span>
                                                    : <span className="text-muted-foreground text-xs">Pending</span>
                                                }
                                            </td>
                                            <td className="px-6 py-3.5">
                                                <div className="flex items-center gap-1.5">
                                                    <KeywordSparkline
                                                        data={
                                                            kw.snapshots.length >= 2
                                                                ? kw.snapshots.map((s) => ({
                                                                    date:     new Date(s.recordedAt).toISOString().slice(0, 10),
                                                                    position: s.position,
                                                                }))
                                                                : [{ date: "now", position: latest?.position ?? 50 }]
                                                        }
                                                        trend={trend}
                                                        width={72}
                                                        height={24}
                                                    />
                                                    <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
                                                </div>
                                            </td>
                                            <td className="px-6 py-3.5 font-medium text-emerald-400">
                                                {kw.roi
                                                    ? `~$${kw.roi.estimatedRevenueUsd.toLocaleString()}`
                                                    : <span className="text-muted-foreground">—</span>}
                                                {kw.roi && (
                                                    <span className="ml-1 text-xs text-muted-foreground font-normal">
                                                        ({kw.roi.confidence})
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3.5 text-blue-400 text-xs font-medium">
                                                {kw.opportunityGapUsd > 0
                                                    ? `+$${kw.opportunityGapUsd.toLocaleString()}`
                                                    : <span className="text-muted-foreground">Already top 3</span>}
                                            </td>
                                            <td className="px-6 py-3.5 text-right">
                                                <button
                                                    onClick={() => handleRemove(kw.id)}
                                                    className="p-1.5 rounded-md text-muted-foreground
                                                               hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                    aria-label={`Remove ${kw.keyword}`}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <p className="px-6 py-2.5 text-xs text-muted-foreground border-t border-border">
                        Positions updated daily · Revenue estimates based on CPC × CTR curve · Marked as estimates
                    </p>
                </>
            )}
        </div>
    );
}

// Re-export opportunityGap so callers don't need a second import
export { opportunityGap };
