import { Metadata } from "next";
import { getKeywordRankingsFast } from "@/app/actions/keywords";
import { AlertCircle, Zap, Search } from "lucide-react";
import { ConnectGSCButton } from "@/components/ConnectGSCButton";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCompetitors } from "@/app/actions/competitors";
import { GenerateBlogButton } from "./GenerateBlogButton";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordSiteSwitcher } from "@/components/dashboard/KeywordSiteSwitcher";
import { getTrackedKeywords } from "@/app/actions/trackedKeywords";
import { estimateKeywordRoi } from "@/lib/keywords/roi";
import { getVisibilityScore } from "@/lib/keywords/visibility-score";
import { hasFeature } from "@/lib/stripe/plans";
import { CtrDiagnosisBanner } from "@/components/dashboard/CtrDiagnosisBanner";
import { AllKeywordsTable } from "./AllKeywordsTable";
import { KeywordTabPanels } from "./KeywordTabPanels";

export const metadata: Metadata = {
    title: "Keywords | OptiAISEO",
    description: "Monitor keyword rankings and generate targeted blog content.",
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

const MAX_TRACKED_MAP: Record<string, number> = { FREE: 0, STARTER: 10, PRO: 100, AGENCY: -1 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function posColor(pos: number) {
    if (pos <= 3)  return { text: "#2ea043", bg: "#0d2818", border: "rgba(46,160,67,0.3)"   };
    if (pos <= 10) return { text: "#388bfd", bg: "#0d1f3c", border: "rgba(56,139,253,0.3)"  };
    if (pos <= 20) return { text: "#d29922", bg: "#2d2208", border: "rgba(210,153,34,0.3)"  };
    return         { text: "#f85149", bg: "#2c1417", border: "rgba(248,81,73,0.3)"          };
}

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

// ── Sub-components (server-side, no "use client") ─────────────────────────────

function OverviewStrip({
    summary,
    visibilityScore,
}: {
    summary: {
        total: number; avgPosition: number; totalClicks: number;
        totalImpressions: number; page1Count: number; page1Pct: number;
        top3Count: number; criticalCount: number; weakCount: number;
        improvingCount: number; strongCount: number;
    };
    visibilityScore: VisibilityRow;
}) {
    const avgPosColor =
        summary.avgPosition <= 10 ? "#2ea043" :
        summary.avgPosition <= 30 ? "#d29922" : "#f85149";

    const visColor =
        !visibilityScore || visibilityScore.score === 0 ? "#f85149" :
        visibilityScore.score < 30 ? "#f85149" :
        visibilityScore.score < 60 ? "#d29922" : "#388bfd";

    const stats = [
        { label: "Keywords",    value: fmt(summary.total),            sub: `${summary.page1Count} on page 1`,   color: "#e6edf3" },
        { label: "Avg Position",value: String(summary.avgPosition),   sub: `${summary.top3Count} in top 3`,     color: avgPosColor },
        { label: "Clicks",      value: fmt(summary.totalClicks),      sub: "last 90 days",                      color: "#2ea043" },
        visibilityScore
            ? { label: "Visibility", value: String(visibilityScore.score), sub: visibilityScore.trend === "improving" ? "↑ Improving" : visibilityScore.trend === "declining" ? "↓ Declining" : `${visibilityScore.top10Pct}% in top 10`, color: visColor }
            : { label: "Need Fix",   value: String(summary.criticalCount + summary.weakCount), sub: `${summary.criticalCount} critical`, color: "#f85149" },
    ];

    const buckets = [
        { label: "Strong",    count: summary.strongCount,    color: "#2ea043" },
        { label: "Improving", count: summary.improvingCount, color: "#388bfd" },
        { label: "Weak",      count: summary.weakCount,      color: "#d29922" },
        { label: "Critical",  count: summary.criticalCount,  color: "#f85149" },
    ];
    const bucketTotal = buckets.reduce((s, b) => s + b.count, 0) || 1;

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#21262d]">
                {stats.map(s => (
                    <div key={s.label} className="px-5 py-4 flex flex-col gap-0.5">
                        <span className="text-[26px] font-black tabular-nums leading-none" style={{ color: s.color }}>
                            {s.value}
                        </span>
                        <span className="text-[12px] font-medium text-[#c9d1d9] mt-1">{s.label}</span>
                        <span className="text-[11px] text-[#6e7681]">{s.sub}</span>
                    </div>
                ))}
            </div>

            {/* Health distribution bar */}
            <div className="px-5 py-3 border-t border-[#21262d] flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-semibold text-[#6e7681] uppercase tracking-[0.08em] shrink-0">
                    Keyword health
                </span>
                <div className="flex-1 flex h-[6px] rounded-full overflow-hidden gap-[2px] min-w-[120px]">
                    {buckets.map(b => (
                        <div
                            key={b.label}
                            className="h-full rounded-full"
                            style={{ width: `${(b.count / bucketTotal) * 100}%`, background: b.color }}
                        />
                    ))}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    {buckets.map(b => (
                        <div key={b.label} className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                            <span className="text-[10px] text-[#6e7681]">
                                {b.label}{" "}
                                <span className="font-semibold" style={{ color: b.color }}>{b.count}</span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

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
    const maxTracked = MAX_TRACKED_MAP[userTier] ?? 0;

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

    // ── Error / no GSC state ───────────────────────────────────────────────────
    if (!rankingsRes.success || !rankingsRes.data) {
        const isGscNotConnected =
            rankingsRes.error?.includes("Connect Google") ||
            rankingsRes.error?.includes("reconnect GSC");

        return (
            <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
                {/* Header */}
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">Keyword Rankings</h1>
                    <p className="text-[13px] text-[#6e7681]">Powered by Google Search Console</p>
                </div>

                {isGscNotConnected ? (
                    <div className="relative rounded-2xl overflow-hidden border border-[#30363d]">
                        {/* Blurred preview */}
                        <div className="blur-sm pointer-events-none opacity-50 rounded-2xl border border-[#30363d] bg-[#0d1117] p-6">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                                {[
                                    { label: "Total Keywords", val: "247" },
                                    { label: "Avg Position",   val: "14.2" },
                                    { label: "On Page 1",      val: "38%" },
                                    { label: "Need Fix",       val: "61" },
                                ].map(s => (
                                    <div key={s.label} className="p-5 rounded-xl border border-[#21262d] bg-[#161b22]">
                                        <p className="text-[10px] text-[#6e7681] uppercase tracking-wider mb-1">{s.label}</p>
                                        <p className="text-3xl font-bold text-[#e6edf3]">{s.val}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Overlay CTA */}
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
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
                        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                        <p className="text-red-400 font-medium mb-1">Failed to load keywords</p>
                        <p className="text-[13px] text-[#6e7681]">{rankingsRes.error}</p>
                    </div>
                )}
            </div>
        );
    }

    // ── Data available ─────────────────────────────────────────────────────────
    const { keywords, categorised, summary, opportunities, siteId: resolvedSiteId } = rankingsRes.data!;
    const activeSiteId = siteId || resolvedSiteId;
    const activeSite   = userSites.find(s => s.id === activeSiteId);

    const revenueKeywords = trackedKeywordsData
        .filter(kw => {
            const snap = kw.snapshots?.at(-1);
            return snap && snap.searchVolume && snap.searchVolume > 0 && snap.cpc && snap.cpc > 0;
        })
        .slice(0, 10)
        .map(kw => {
            const snap = kw.snapshots.at(-1)!;
            return { id: kw.id, keyword: kw.keyword, position: snap.position, searchVolume: snap.searchVolume!, cpc: snap.cpc! };
        });

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">

            {/* ── Page header ── */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#e6edf3] mb-1">Keyword Rankings</h1>
                    <p className="text-[13px] text-[#6e7681]">
                        Google Search Console · last 90 days
                        {activeSite && <> · <span className="text-[#c9d1d9] font-medium">{activeSite.domain}</span></>}
                        {" "}· {summary.total} keywords
                    </p>
                </div>
                {userSites.length > 0 && (
                    <KeywordSiteSwitcher
                        sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                        activeSiteId={activeSiteId}
                    />
                )}
            </div>

            {/* ── Unified overview strip ── */}
            <OverviewStrip summary={summary} visibilityScore={visibilityScore} />

            {/* ── Opportunities ── */}
            <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#21262d]">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <Zap className="w-4 h-4 text-[#d29922]" />
                            <h2 className="text-[15px] font-semibold text-[#e6edf3]">Top Keyword Opportunities</h2>
                        </div>
                        <p className="text-[12px] text-[#6e7681]">
                            High-impression keywords with poor rankings — generate a blog post to rank higher.
                        </p>
                    </div>
                    {opportunities.length > 0 && (
                        <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#d29922]/10 text-[#d29922] border border-[#d29922]/20">
                            {opportunities.length} found
                        </span>
                    )}
                </div>

                {/* CTR diagnosis — contextual, not a page-wide banner */}
                <div className="px-5 py-3 border-b border-[#21262d]">
                    <PanelErrorBoundary fallbackTitle="">
                        <CtrDiagnosisBanner keywords={keywords} domain={activeSite?.domain ?? ""} />
                    </PanelErrorBoundary>
                </div>

                {/* Opportunities list — single unified list, no mobile/desktop duplicate */}
                {opportunities.length === 0 ? (
                    <div className="px-6 py-10 text-center text-[13px] text-[#6e7681]">
                        No clear opportunities found yet. Check back after more data accumulates in Search Console.
                    </div>
                ) : (
                    <div className="divide-y divide-[#161b22]">
                        {opportunities.map((opp, i) => {
                            const pc = posColor(opp.avgPosition);
                            return (
                                <div key={i} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#0f1318] transition-colors">
                                    {/* Position badge */}
                                    <span
                                        className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-md border"
                                        style={{ color: pc.text, background: pc.bg, borderColor: pc.border }}
                                    >
                                        #{opp.avgPosition}
                                    </span>

                                    {/* Keyword + reason */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-semibold text-[#e6edf3] truncate">{opp.keyword}</p>
                                        <p className="text-[11px] text-[#6e7681] mt-0.5 line-clamp-1">{opp.reason}</p>
                                    </div>

                                    {/* Metrics */}
                                    <div className="hidden sm:flex items-center gap-4 shrink-0 text-[11px] text-[#6e7681]">
                                        <span>{fmt(opp.impressions)} impr</span>
                                        <span>{opp.ctr}% CTR</span>
                                        <span className="font-bold text-[#d29922]">Score {opp.opportunityScore}</span>
                                    </div>

                                    {/* CTA */}
                                    <div className="shrink-0">
                                        <GenerateBlogButton
                                            keyword={opp.keyword}
                                            position={opp.avgPosition}
                                            impressions={opp.impressions}
                                            siteId={activeSiteId}
                                            siteDomain={activeSite?.domain ?? ""}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Secondary panels (tabbed) ── */}
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
                    revenueKeywords={revenueKeywords}
                    competitorCount={(competitors as unknown[]).length}
                    trackedCount={trackedKeywordsData.length}
                />
            )}

            {/* ── Full keywords table ── */}
            <AllKeywordsTable keywords={keywords} siteId={activeSiteId} />

        </div>
    );
}