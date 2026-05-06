"use client";
import { useState, useMemo } from "react";
import { estimateKeywordRoi } from "@/lib/keywords/roi";

interface SimKeyword {
    id:           string;
    keyword:      string;
    position:     number;
    searchVolume: number;
    cpc:          number;
}

export function RevenueSimulator({ keywords }: { keywords: SimKeyword[] }) {
    const [targets, setTargets] = useState<Record<string, number>>(() =>
        Object.fromEntries(keywords.map((k) => [k.id, k.position]))
    );

    const { current, simulated } = useMemo(() => {
        let cur = 0;
        let sim = 0;
        for (const kw of keywords) {
            cur += estimateKeywordRoi({
                position:     kw.position,
                searchVolume: kw.searchVolume,
                cpc:          kw.cpc,
            }).estimatedRevenueUsd;
            sim += estimateKeywordRoi({
                position:     targets[kw.id] ?? kw.position,
                searchVolume: kw.searchVolume,
                cpc:          kw.cpc,
            }).estimatedRevenueUsd;
        }
        return { current: Math.round(cur), simulated: Math.round(sim) };
    }, [keywords, targets]);

    const uplift = simulated - current;

    return (
        <div className="card-surface overflow-hidden">
            <div className="p-6 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-semibold">Revenue Simulator</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Drag sliders to see the estimated revenue impact of improving keyword positions.
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-muted-foreground">Additional value at target positions</p>
                    <p className={`text-2xl font-bold ${uplift > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {uplift > 0 ? `+$${uplift.toLocaleString()}/mo` : "Drag sliders below"}
                    </p>
                </div>
            </div>

            <div className="divide-y divide-border">
                {keywords.map((kw) => {
                    const targetPos = targets[kw.id] ?? kw.position;
                    const { estimatedRevenueUsd } = estimateKeywordRoi({
                        position:     targetPos,
                        searchVolume: kw.searchVolume,
                        cpc:          kw.cpc,
                    });
                    const currentRevenue = estimateKeywordRoi({
                        position: kw.position, searchVolume: kw.searchVolume, cpc: kw.cpc,
                    }).estimatedRevenueUsd;
                    const improved = targetPos < kw.position;

                    return (
                        <div key={kw.id} className="px-6 py-4 grid grid-cols-[1fr_auto] gap-4 items-center">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium truncate max-w-[260px]" title={kw.keyword}>
                                        {kw.keyword}
                                    </span>
                                    <div className="flex items-center gap-2 shrink-0 ml-4">
                                        <span className="text-xs text-muted-foreground">
                                            #{kw.position} → #{targetPos}
                                        </span>
                                        {improved && (
                                            <span className="text-xs text-emerald-400 font-medium">
                                                +${Math.round(estimatedRevenueUsd - currentRevenue)}/mo
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <input
                                    type="range"
                                    min={1}
                                    max={Math.max(kw.position, 20)}
                                    step={1}
                                    value={targetPos}
                                    onChange={(e) =>
                                        setTargets((prev) => ({ ...prev, [kw.id]: Number(e.target.value) }))
                                    }
                                    className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
                                    aria-label={`Target position for ${kw.keyword}`}
                                    id={`sim-slider-${kw.id}`}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                    <span>#1</span>
                                    <span>#{Math.max(kw.position, 20)}</span>
                                </div>
                            </div>
                            <div className="text-right text-sm">
                                <p className="font-medium text-foreground">${Math.round(estimatedRevenueUsd)}</p>
                                <p className="text-xs text-muted-foreground">/mo est.</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <p className="px-6 py-3 text-xs text-muted-foreground border-t border-border">
                Estimates based on search volume × CTR curve × CPC · Marked as estimates, not guarantees.
            </p>
        </div>
    );
}
