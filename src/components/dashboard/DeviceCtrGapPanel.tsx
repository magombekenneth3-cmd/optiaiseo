"use client";

import { useState } from "react";
import { Monitor, Smartphone, AlertTriangle, Loader2 } from "lucide-react";
import { getDeviceBreakdown } from "@/app/actions/keywords";

interface DeviceMetric {
    device: string;
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    clickShare: number;
    impressionShare: number;
}

interface GapKeyword {
    keyword: string;
    url: string;
    desktop: { ctr: number; clicks: number; impressions: number; avgPosition: number } | null;
    mobile: { ctr: number; clicks: number; impressions: number; avgPosition: number } | null;
    hasMobileCtrGap: boolean;
}

interface Props {
    siteId: string;
}

export function DeviceCtrGapPanel({ siteId }: Props) {
    const [data, setData] = useState<{
        deviceMetrics: DeviceMetric[];
        gapKeywords: GapKeyword[];
        totalKeywords: number;
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await getDeviceBreakdown(siteId);
            if (!res.success) {
                setError(res.error ?? "Failed");
                return;
            }
            setData({
                deviceMetrics: (res.deviceMetrics ?? []) as DeviceMetric[],
                gapKeywords: (res.gapKeywords ?? []) as GapKeyword[],
                totalKeywords: res.totalKeywords ?? 0,
            });
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }

    const desktopMetrics = data?.deviceMetrics.find(m => m.device === "DESKTOP");
    const mobileMetrics = data?.deviceMetrics.find(m => m.device === "MOBILE");

    return (
        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="font-semibold text-[#e6edf3] flex items-center gap-2 text-sm">
                        <Smartphone className="w-4 h-4 text-blue-400" />
                        Mobile vs Desktop CTR Gap
                    </h3>
                    <p className="text-xs text-[#6e7681] mt-1">
                        Keywords where mobile CTR significantly underperforms desktop.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-[#238636] text-white text-xs font-medium
                               hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
                >
                    {loading ? (
                        <span className="flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Analysing…
                        </span>
                    ) : loaded ? "Refresh" : "Analyse Devices"}
                </button>
            </div>

            {error && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-4 py-2 mb-4">{error}</p>
            )}

            {data && (
                <>
                    <div className="grid grid-cols-2 gap-3 mb-5">
                        {[
                            { label: "Desktop avg CTR", value: `${desktopMetrics?.ctr.toFixed(1) ?? "—"}%`, icon: Monitor, color: "text-blue-400" },
                            { label: "Mobile avg CTR", value: `${mobileMetrics?.ctr.toFixed(1) ?? "—"}%`, icon: Smartphone, color: "text-emerald-400" },
                        ].map(({ label, value, icon: Icon, color }) => (
                            <div key={label} className="rounded-lg bg-[#161b22] border border-[#21262d] px-4 py-3">
                                <div className="flex items-center gap-1.5 text-xs text-[#6e7681] mb-1">
                                    <Icon className={`w-3.5 h-3.5 ${color}`} />
                                    {label}
                                </div>
                                <p className="text-xl font-semibold text-[#e6edf3]">{value}</p>
                            </div>
                        ))}
                    </div>

                    {data.gapKeywords.length === 0 ? (
                        <p className="text-sm text-[#6e7681] text-center py-6">
                            🎉 No significant mobile CTR gaps detected.
                        </p>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-4 h-4 text-amber-400" />
                                <p className="text-xs font-medium text-[#e6edf3]">
                                    {data.gapKeywords.length} keyword{data.gapKeywords.length !== 1 ? "s" : ""} with mobile CTR gap
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                {data.gapKeywords.slice(0, 20).map((kw) => {
                                    const mCtr = kw.mobile?.ctr ?? 0;
                                    const dCtr = kw.desktop?.ctr ?? 0;
                                    const gap = dCtr - mCtr;
                                    return (
                                        <div
                                            key={`${kw.keyword}-${kw.url}`}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#161b22] border border-[#21262d] text-sm"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[#e6edf3] font-medium truncate text-xs">{kw.keyword}</p>
                                                <p className="text-[10px] text-[#484f58] truncate">{kw.url}</p>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0 text-[11px]">
                                                <span className="text-[#6e7681]">
                                                    <Monitor className="w-3 h-3 inline mr-0.5" />{dCtr.toFixed(1)}%
                                                </span>
                                                <span className="text-[#6e7681]">
                                                    <Smartphone className="w-3 h-3 inline mr-0.5" />{mCtr.toFixed(1)}%
                                                </span>
                                                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold">
                                                    −{gap.toFixed(1)}%
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
