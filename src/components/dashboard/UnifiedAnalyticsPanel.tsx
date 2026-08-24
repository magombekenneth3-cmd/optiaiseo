"use client";

import { useEffect, useState } from "react";
import { getUnifiedAnalytics, type UnifiedAnalytics } from "@/app/actions/unified-analytics";
import {
    Search,
    BarChart3,
    Users,
    MousePointerClick,
    Eye,
    Timer,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
    Globe,
    Target,
    FileText,
} from "lucide-react";

function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function StatBox({
    label,
    value,
    sub,
    icon: Icon,
    color,
}: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ElementType;
    color: string;
}) {
    return (
        <div className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5" style={{ color }} />
                <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.06em]">{label}</span>
            </div>
            <span className="text-[22px] font-black tabular-nums leading-none" style={{ color }}>{value}</span>
            {sub && <span className="text-[10px] text-[#6e7681]">{sub}</span>}
        </div>
    );
}

function ChannelBar({ channel, pct, color }: { channel: string; pct: number; color: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#c9d1d9] w-28 truncate shrink-0">{channel}</span>
            <div className="flex-1 h-[6px] rounded-full bg-[#21262d] overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                />
            </div>
            <span className="text-[10px] font-semibold text-[#6e7681] w-10 text-right tabular-nums">{pct}%</span>
        </div>
    );
}

const CHANNEL_COLORS: Record<string, string> = {
    "Organic Search": "#2ea043",
    "Direct": "#388bfd",
    "Organic Social": "#a371f7",
    "Referral": "#d29922",
    "Email": "#f47067",
    "Paid Search": "#f778ba",
    "Display": "#79c0ff",
};

function getChannelColor(channel: string): string {
    return CHANNEL_COLORS[channel] ?? "#6e7681";
}

export function UnifiedAnalyticsPanel({ siteId }: { siteId: string }) {
    const [data, setData] = useState<UnifiedAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [noData, setNoData] = useState(false);

    useEffect(() => {
        getUnifiedAnalytics(siteId)
            .then(d => { setData(d); setNoData(!d || (!d.gsc && !d.ga4)); })
            .catch(() => { setData(null); setNoData(true); })
            .finally(() => setLoading(false));
    }, [siteId]);

    if (loading) {
        return (
            <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] p-8">
                <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border-2 border-[#388bfd] border-t-transparent animate-spin" />
                    <span className="text-[13px] text-[#6e7681]">Loading analytics...</span>
                </div>
            </div>
        );
    }

    if (noData || !data || (!data.gsc && !data.ga4)) {
        return (
            <div className="p-6 flex flex-col items-center gap-3 text-center">
                <Globe className="w-7 h-7 text-[#6e7681]" />
                <p className="text-[13px] font-semibold text-[#8b949e]">No analytics data yet</p>
                <p className="text-[12px] text-[#6e7681] max-w-xs">
                    Connect Google Search Console to see click and impression data, then link a GA4 property for sessions, bounce rate, and conversion tracking.
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-1">
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                    <a
                        href="/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard%2Fkeywords"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#388bfd]/10 text-[#388bfd] border border-[#388bfd]/25 hover:bg-[#388bfd]/20 transition-colors"
                    >
                        <Search className="w-3 h-3" /> Connect GSC
                    </a>
                    <a
                        href={`/dashboard/sites/${siteId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#a371f7]/10 text-[#a371f7] border border-[#a371f7]/25 hover:bg-[#a371f7]/20 transition-colors"
                    >
                        <BarChart3 className="w-3 h-3" /> Link GA4 Property
                    </a>
                </div>
            </div>
        );
    }

    const { gsc, ga4, merged } = data;

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#21262d] flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <BarChart3 className="w-4 h-4 text-[#388bfd]" />
                        <h2 className="text-[15px] font-semibold text-[#e6edf3]">Search + Analytics</h2>
                    </div>
                    <p className="text-[12px] text-[#6e7681]">GSC + GA4 unified · last 28 days</p>
                </div>
                {merged && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#2ea043]/10 border border-[#2ea043]/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#2ea043] animate-pulse" />
                        <span className="text-[10px] font-bold text-[#2ea043]">SYNCED</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#21262d]">
                {gsc && (
                    <>
                        <StatBox label="GSC Clicks" value={fmt(gsc.totalClicks)} sub={`${gsc.ctr}% CTR`} icon={MousePointerClick} color="#2ea043" />
                        <StatBox label="Impressions" value={fmt(gsc.totalImpressions)} sub={`${gsc.page1Count} on page 1`} icon={Eye} color="#388bfd" />
                    </>
                )}
                {ga4 && (
                    <>
                        <StatBox label="Sessions" value={fmt(ga4.sessions)} sub={`${ga4.organicPct}% organic`} icon={Users} color="#a371f7" />
                        <StatBox label="Bounce Rate" value={`${ga4.bounceRate}%`} sub={`${ga4.avgSessionDuration.toFixed(0)}s avg`} icon={Timer} color={ga4.bounceRate > 60 ? "#f85149" : "#d29922"} />
                    </>
                )}
                {gsc && !ga4 && (
                    <>
                        <StatBox label="Keywords" value={fmt(gsc.totalKeywords)} sub={`Avg pos ${gsc.avgPosition}`} icon={Search} color="#d29922" />
                        <StatBox label="Top 3" value={String(gsc.top3Count)} sub={`${gsc.page1Pct}% page 1`} icon={ArrowUpRight} color="#a371f7" />
                    </>
                )}
            </div>

            {/* GA4 nudge — shown when GSC is connected but GA4 isn't */}
            {gsc && !ga4 && (
                <div className="px-5 py-3 border-t border-[#21262d] flex items-center gap-3">
                    <BarChart3 className="w-4 h-4 text-[#a371f7] shrink-0" />
                    <p className="text-[12px] text-[#6e7681] flex-1">
                        <span className="text-[#a371f7] font-semibold">Add GA4</span> to see sessions, bounce rate, and conversion data alongside your GSC metrics.
                    </p>
                    <a
                        href={`/dashboard/sites/${siteId}`}
                        className="shrink-0 text-[11px] font-semibold text-[#a371f7] border border-[#a371f7]/25 px-2.5 py-1 rounded-lg hover:bg-[#a371f7]/10 transition-colors whitespace-nowrap"
                    >
                        Link GA4 →
                    </a>
                </div>
            )}

            {ga4 && (ga4.conversions > 0 || ga4.pageviews > 0) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-[#21262d] border-t border-[#21262d]">
                    <StatBox label="Conversions" value={fmt(ga4.conversions)} sub="GA4 key events" icon={Target} color="#f778ba" />
                    <StatBox label="Pageviews" value={fmt(ga4.pageviews)} sub={`${ga4.users} users`} icon={FileText} color="#79c0ff" />
                    <StatBox
                        label="Conv. Rate"
                        value={ga4.sessions > 0 ? `${((ga4.conversions / ga4.sessions) * 100).toFixed(1)}%` : "—"}
                        sub={ga4.sessions > 0 ? `${ga4.conversions} / ${fmt(ga4.sessions)} sessions` : undefined}
                        icon={ArrowUpRight}
                        color={ga4.sessions > 0 && (ga4.conversions / ga4.sessions) > 0.02 ? "#2ea043" : "#d29922"}
                    />
                </div>
            )}

            {merged && (
                <div className="px-5 py-3 border-t border-[#21262d]">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em]">
                            Click → Session ratio
                        </span>
                        <span className="text-[12px] font-bold text-[#e6edf3]">
                            {merged.clickToSessionRatio !== null ? `${merged.clickToSessionRatio}x` : "—"}
                        </span>
                        {merged.clickToSessionRatio !== null && (
                            <span className="text-[10px] text-[#6e7681]">
                                ({fmt(merged.organicClicksGsc)} clicks → {fmt(merged.organicSessionsGa4)} sessions)
                            </span>
                        )}
                    </div>
                </div>
            )}

            {ga4 && ga4.topChannels.length > 0 && (
                <div className="px-5 py-4 border-t border-[#21262d]">
                    <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] block mb-3">
                        Traffic Channels
                    </span>
                    <div className="flex flex-col gap-2">
                        {ga4.topChannels.slice(0, 6).map((ch) => (
                            <ChannelBar
                                key={ch.channel}
                                channel={ch.channel}
                                pct={ch.pct}
                                color={getChannelColor(ch.channel)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {merged && merged.topLandingPages.length > 0 && (
                <div className="px-5 py-4 border-t border-[#21262d]">
                    <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] block mb-3">
                        Top Landing Pages (GSC + GA4)
                    </span>
                    <div className="flex flex-col gap-1">
                        {merged.topLandingPages.slice(0, 6).map((page) => (
                            <div key={page.path} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[#161b22] transition-colors">
                                <span className="text-[12px] text-[#c9d1d9] truncate flex-1 min-w-0 font-mono">{page.path}</span>
                                <div className="flex items-center gap-3 shrink-0 text-[10px]">
                                    <span className="text-[#2ea043] tabular-nums">{fmt(page.gscClicks)} clicks</span>
                                    <span className="text-[#a371f7] tabular-nums">{fmt(page.ga4Views)} views</span>
                                    {page.gap === "gsc_only" && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#d29922]/10 text-[#d29922] font-semibold">GSC only</span>
                                    )}
                                    {page.gap === "ga4_only" && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#a371f7]/10 text-[#a371f7] font-semibold">GA4 only</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
