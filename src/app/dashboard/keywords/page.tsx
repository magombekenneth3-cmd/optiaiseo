import type { Metadata, } from "next";
import type { ReactNode } from "react";
import { getKeywordRankingsFast } from "@/app/actions/keywords";
import { AlertCircle, Search, BarChart3, TrendingUp, AlertTriangle, Target, Eye } from "lucide-react";
import { ConnectGSCButton } from "@/components/ConnectGSCButton";
import { GscConnectCard } from "@/components/dashboard/GscConnectCard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCompetitors } from "@/app/actions/competitors";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordSiteSwitcher } from "@/components/dashboard/KeywordSiteSwitcher";
import { getTrackedKeywords } from "@/app/actions/trackedKeywords";
import { estimateKeywordRoi } from "@/lib/keywords/roi";
import { getVisibilityScore } from "@/lib/keywords/visibility-score";
import { hasFeature, getPlan } from "@/lib/stripe/plans";
import { KeywordTabPanels } from "./KeywordTabPanels";
import { CollapsibleAnalytics } from "./CollapsibleAnalytics";
import { PriorityActions } from "./OpportunitiesList";

export const metadata: Metadata = {
    title: "Keywords | OptiAISEO",
    description: "Track keyword rankings, find opportunities and grow organic traffic.",
};

type SiteRow = { id: string; domain: string };
type TrackedKwRow = {
    id: string;
    keyword: string;
    snapshots: { position: number; recordedAt: Date; searchVolume: number | null; cpc: number | null }[];
    roi: ReturnType<typeof estimateKeywordRoi> | null;
    opportunityGapUsd: number;
};
type VisibilityRow = { score: number; trend: string; top10Pct: number } | null;

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

function KpiCard({ label, value, sub, warn, children }: {
    label: string; value: string; sub: string; warn?: boolean; children?: ReactNode;
}) {
    return (
        <div className={`rounded-xl border px-4 py-3.5 ${warn ? "border-[#f85149]/20 bg-[#f85149]/5" : "border-[#21262d] bg-[#0d1117]"}`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-[#8b949e]">{label}</span>
                {children}
            </div>
            <p className={`text-[26px] font-black tabular-nums leading-none ${warn ? "text-[#f85149]" : "text-[#e6edf3]"}`}>
                {value}
            </p>
            <p className="text-[11px] text-[#6e7681] mt-1.5">{sub}</p>
        </div>
    );
}

function HealthBar({ summary }: {
    summary: { criticalCount: number; weakCount: number; improvingCount: number; strongCount: number };
}) {
    const buckets = [
        { label: "Critical", count: summary.criticalCount, color: "#f85149" },
        { label: "Weak", count: summary.weakCount, color: "#d29922" },
        { label: "Improving", count: summary.improvingCount, color: "#388bfd" },
        { label: "Strong", count: summary.strongCount, color: "#2ea043" },
    ];
    const total = buckets.reduce((s, b) => s + b.count, 0) || 1;

    return (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-[#21262d] bg-[#0d1117] flex-wrap">
            <span className="text-[12px] font-semibold text-[#e6edf3] shrink-0">Keyword Health</span>
            <div className="flex-1 flex h-[5px] rounded-full overflow-hidden gap-[1px] min-w-[80px]">
                {buckets.filter(b => b.count > 0).map(b => (
                    <div key={b.label} className="h-full rounded-full" style={{ width: `${(b.count / total) * 100}%`, background: b.color }} />
                ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                {buckets.map(b => (
                    <div key={b.label} className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
                        <span className="text-[10px] text-[#6e7681]">
                            {b.label} <span className="font-semibold" style={{ color: b.color }}>{b.count}</span>
                        </span>
                    </div>
                ))}
            </div>
            {summary.criticalCount > 0 && (
                <a href="#workspace" className="shrink-0 text-[10px] font-semibold text-[#388bfd] hover:text-[#58a6ff] transition-colors">
                    View critical keywords →
                </a>
            )}
        </div>
    );
}

function TrafficMini({ summary, visibilityScore }: {
    summary: { totalClicks: number; totalImpressions: number; page1Pct: number };
    visibilityScore: VisibilityRow;
}) {
    return (
        <div className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden h-full flex flex-col">
            <div className="px-5 py-3 border-b border-[#161b22]">
                <h2 className="text-[14px] font-semibold text-[#e6edf3]">Traffic & Search Performance</h2>
                <p className="text-[10px] text-[#6e7681] mt-0.5">Google Search Console + GA4</p>
            </div>
            <div className="flex-1 px-5 py-4">
                <div className="mb-1">
                    <span className="text-[10px] font-medium text-[#6e7681] uppercase tracking-[0.06em]">Organic clicks</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-[28px] font-black text-[#e6edf3] tabular-nums">{fmt(summary.totalClicks)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <p className="text-[16px] font-bold text-[#c9d1d9] tabular-nums">{fmt(summary.totalImpressions)}</p>
                        <p className="text-[10px] text-[#6e7681]">Impressions</p>
                    </div>
                    <div>
                        <p className="text-[16px] font-bold text-[#c9d1d9] tabular-nums">{summary.page1Pct}%</p>
                        <p className="text-[10px] text-[#6e7681]">Page 1 rate</p>
                    </div>
                </div>
                {visibilityScore && (
                    <div className="mt-4 pt-3 border-t border-[#161b22]">
                        <div className="flex items-center gap-2">
                            <Eye className="w-3.5 h-3.5 text-[#6e7681]" />
                            <span className="text-[10px] text-[#6e7681]">Visibility</span>
                            <span className="text-[14px] font-bold text-[#e6edf3] ml-auto tabular-nums">{visibilityScore.score}</span>
                        </div>
                        <p className="text-[10px] text-[#6e7681] mt-0.5 text-right">{visibilityScore.top10Pct}% in top 10</p>
                    </div>
                )}
            </div>
            <a href="#analytics" className="flex items-center justify-center gap-1 px-5 py-2 border-t border-[#161b22] text-[11px] font-semibold text-[#388bfd] hover:bg-[#0f1318] transition-colors">
                View full analytics ↓
            </a>
        </div>
    );
}

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
    const session = await getServerSession(authOptions);
    const resolvedParams = await searchParams;
    let siteId = resolvedParams.siteId || "";

    let competitors: Awaited<ReturnType<typeof getCompetitors>>["competitors"] = [];
    let userSites: SiteRow[] = [];
    let userTier = "FREE";

    if (session?.user?.email) {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true, subscriptionTier: true },
        });
        if (user) {
            userSites = await prisma.site.findMany({
                where: { userId: user.id },
                select: { id: true, domain: true },
                orderBy: { createdAt: "desc" },
            });
            userTier = user.subscriptionTier ?? "FREE";
            const site = siteId ? userSites.find(s => s.id === siteId) : userSites[0];
            if (site) {
                siteId = site.id;
                const compRes = await getCompetitors(site.id);
                if (compRes.success && compRes.competitors) competitors = compRes.competitors;
            }
        }
    }

    const rankingsRes = await getKeywordRankingsFast(siteId);

    let trackedKeywordsData: TrackedKwRow[] = [];
    let visibilityScore: VisibilityRow = null;
    const maxTracked = getPlan(userTier).limits.keywordsTracked;

    if (siteId) {
        const [tkRes, visRes] = await Promise.allSettled([
            getTrackedKeywords(siteId),
            getVisibilityScore(siteId),
        ]);
        if (tkRes.status === "fulfilled" && tkRes.value.success && "keywords" in tkRes.value) {
            trackedKeywordsData = tkRes.value.keywords as TrackedKwRow[];
        }
        if (visRes.status === "fulfilled") {
            visibilityScore = visRes.value as VisibilityRow;
        }
    }

    if (!rankingsRes.success || !rankingsRes.data) {
        const isGscNotConnected =
            rankingsRes.error?.includes("Connect Google") ||
            rankingsRes.error?.includes("reconnect GSC");

        return (
            <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">Keyword Performance</h1>
                    <p className="text-[13px] text-[#8b949e]">Track rankings, find opportunities and grow organic traffic.</p>
                </div>
                {isGscNotConnected ? (
                    <div className="relative rounded-xl overflow-hidden border border-[#30363d]">
                        <div className="blur-sm pointer-events-none opacity-50 p-6">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                                {[
                                    { label: "Tracked Keywords", val: "247" },
                                    { label: "Page 1 Rankings", val: "38" },
                                    { label: "Need Attention", val: "61" },
                                    { label: "Clicks", val: "1.2k" },
                                ].map(s => (
                                    <div key={s.label} className="p-4 rounded-xl border border-[#21262d] bg-[#0d1117]">
                                        <p className="text-[10px] text-[#6e7681] uppercase tracking-wider mb-1">{s.label}</p>
                                        <p className="text-[26px] font-black text-[#e6edf3]">{s.val}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 bg-[#0d1117]/80 backdrop-blur-[2px]">
                            <Search className="w-10 h-10 text-[#6e7681]" />
                            <div className="text-center">
                                <p className="font-bold text-[18px] text-[#e6edf3] mb-1">Connect Google Search Console</p>
                                <p className="text-[13px] text-[#6e7681] max-w-md mx-auto">
                                    Connect your Google account to see real keyword rankings, positions, and click data.
                                </p>
                            </div>
                            <ConnectGSCButton callbackUrl="/dashboard/keywords" />
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
                        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                        <p className="text-red-400 font-medium mb-1">Failed to load keywords</p>
                        <p className="text-[13px] text-[#6e7681]">{rankingsRes.error}</p>
                    </div>
                )}
            </div>
        );
    }

    const { keywords, categorised, summary, opportunities, siteId: resolvedSiteId } = rankingsRes.data!;
    const activeSiteId = siteId || resolvedSiteId;
    const activeSite = userSites.find(s => s.id === activeSiteId);
    const needAttention = summary.criticalCount + summary.weakCount;
    const needPct = summary.total > 0 ? Math.round((needAttention / summary.total) * 100) : 0;

    return (
        <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto">

            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">Keyword Performance</h1>
                    <p className="text-[13px] text-[#8b949e] mb-1.5">Track rankings, find opportunities and grow organic traffic.</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#6e7681] flex-wrap">
                        <span>Last 90 days</span>
                        <span className="text-[#30363d]">·</span>
                        <span>Google Search Console + GA4</span>
                        {activeSite && (
                            <>
                                <span className="text-[#30363d]">·</span>
                                <span className="text-[#c9d1d9] font-medium">{activeSite.domain}</span>
                            </>
                        )}
                    </div>
                </div>
                {userSites.length > 0 && (
                    <KeywordSiteSwitcher
                        sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                        activeSiteId={activeSiteId}
                    />
                )}
            </div>

            {summary.total === 0 && <GscConnectCard siteDomain={activeSite?.domain} />}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Tracked Keywords" value={fmt(summary.total)} sub={`${summary.page1Count} on page 1`}>
                    <BarChart3 className="w-3.5 h-3.5 text-[#30363d]" />
                </KpiCard>
                <KpiCard label="Page 1 Rankings" value={String(summary.page1Count)} sub={`${summary.top3Count} in top 3`}>
                    <TrendingUp className="w-3.5 h-3.5 text-[#2ea043]" />
                </KpiCard>
                <KpiCard label="Need Attention" value={String(needAttention)} sub={`${needPct}% of keywords`} warn>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#f85149]" />
                </KpiCard>
                <KpiCard label="Clicks" value={fmt(summary.totalClicks)} sub="last 90 days">
                    <Target className="w-3.5 h-3.5 text-[#30363d]" />
                </KpiCard>
            </div>

            <HealthBar summary={summary} />

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3">
                    <PanelErrorBoundary fallbackTitle="Priority Actions">
                        <PriorityActions keywords={keywords} siteId={activeSiteId} />
                    </PanelErrorBoundary>
                </div>
                <div className="lg:col-span-2">
                    <TrafficMini summary={summary} visibilityScore={visibilityScore} />
                </div>
            </div>

            {activeSiteId && (
                <KeywordTabPanels
                    siteId={activeSiteId}
                    categorised={categorised}
                    opportunities={opportunities}
                    summary={summary}
                    domain={activeSite?.domain ?? ""}
                    userTier={userTier}
                    maxTracked={maxTracked}
                    trackedKeywordsData={trackedKeywordsData}
                    competitors={competitors}
                    hasRankTracking={hasFeature(userTier, "rankTracking")}
                    hasShareOfVoice={trackedKeywordsData.length > 0}
                    competitorCount={(competitors as unknown[]).length}
                    trackedCount={trackedKeywordsData.length}
                    keywords={keywords}
                />
            )}

            {activeSiteId && (
                <div id="analytics">
                    <PanelErrorBoundary fallbackTitle="Traffic & Search Performance">
                        <CollapsibleAnalytics siteId={activeSiteId} />
                    </PanelErrorBoundary>
                </div>
            )}

        </div>
    );
}