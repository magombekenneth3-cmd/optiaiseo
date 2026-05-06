"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCcw, TrendingDown, ArrowRight, Sparkles } from "lucide-react";
import { getDecayingContent, refreshDecayingContent } from "@/app/actions/contentDecay";
import { DecayRow } from "@/lib/gsc/index";

export default function RefreshClient({ siteId }: { siteId: string }) {
    const [decayData, setDecayData] = useState<DecayRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let mounted = true;
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const res = await getDecayingContent(siteId);
                if (mounted && res.success && res.data) {
                    setDecayData(res.data);
                } else if (mounted && !res.success) {
                    toast.error(res.error || "Failed to load decaying content data");
                }
            } catch {
                if (mounted) toast.error("Network error fetching decay data.");
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        fetchData();
        return () => { mounted = false; };
    }, [siteId]);

    const handleRefreshUrl = async (url: string) => {
        setIsRefreshing(prev => ({ ...prev, [url]: true }));
        const loadingId = toast.loading(`Rewriting and optimizing ${url}... (this takes ~30s)`);

        try {
            const res = await refreshDecayingContent(siteId, url);
            toast.dismiss(loadingId);

            if (res.success) {
                toast.success(
                    <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">Content Refreshed Successfully!</span>
                        <span className="text-xs opacity-80">A new draft has been queued in your Content & Blogs dashboard.</span>
                    </div>,
                    { duration: 6000 }
                );
            } else {
                toast.error(res.error || "Failed to refresh content.");
            }
        } catch {
            toast.dismiss(loadingId);
            toast.error("Network error while generating refreshed content.");
        } finally {
            setIsRefreshing(prev => ({ ...prev, [url]: false }));
        }
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-12 fade-in-up mt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1 flex items-center gap-2">
                        <RefreshCcw className="w-6 h-6 text-emerald-500" />
                        Content Decay Refresher
                    </h1>
                    <p className="text-muted-foreground text-sm max-w-2xl">
                        AI automatically identifies pages on your site that have lost more than 15% of their Google traffic over the last 90 days.
                        Click <strong className="text-foreground">Refresh with AI</strong> to generate a fully modernized, 2026-optimized draft.
                    </p>
                </div>
            </div>

            {isLoading ? (
                <div className="card-surface p-12 flex flex-col items-center justify-center text-muted-foreground min-h-[400px]">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                    <p className="font-medium text-zinc-300">Analyzing Google Search Console traffic...</p>
                    <p className="text-sm mt-1">Comparing the last 90 days against the previous period.</p>
                </div>
            ) : decayData.length === 0 ? (
                <div className="card-surface p-12 text-center border-dashed border-border min-h-[400px] flex flex-col items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex flex-col items-center justify-center mb-4">
                        <Sparkles className="w-8 h-8 text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">No Content Decay Detected!</h3>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                        Your site&apos;s traffic is stable. None of your pages have experienced a significant drop (&gt;15%) in clicks over the last 90 days.
                    </p>
                </div>
            ) : (
                <div className="card-surface overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border bg-card">
                                    <th className="p-4 font-semibold text-muted-foreground text-sm w-[45%]">Decaying URL</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-sm">Previous 90D Clicks</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-sm">Last 90D Clicks</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-sm">Traffic Drop</th>
                                    <th className="p-4 font-semibold text-muted-foreground text-sm text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {decayData.map((row, idx) => (
                                    <tr
                                        key={idx}
                                        className="group hover:bg-card transition-colors"
                                    >
                                        <td className="p-4">
                                            <a
                                                href={row.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-sm font-medium text-foreground hover:text-emerald-400 transition-colors line-clamp-2"
                                                title={row.url}
                                            >
                                                {row.url}
                                            </a>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-sm text-zinc-300 font-medium">{row.previousClicks}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-sm text-muted-foreground font-medium">{row.currentClicks}</span>
                                        </td>
                                        <td className="p-4">
                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm font-bold">
                                                <TrendingDown className="w-3.5 h-3.5" />
                                                -{row.dropPercentage}%
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => handleRefreshUrl(row.url)}
                                                disabled={isRefreshing[row.url]}
                                                className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold text-sm rounded-lg border border-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isRefreshing[row.url] ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <>
                                                        <Sparkles className="w-4 h-4" />
                                                        Refresh with AI
                                                        <ArrowRight className="w-3.5 h-3.5 opacity-70" />
                                                    </>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
