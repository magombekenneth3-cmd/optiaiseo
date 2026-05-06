import { Metadata } from "next";
import { getKeywordRankingsFast, generateBlogForKeyword } from "@/app/actions/keywords";
import { AlertCircle, Zap, ArrowRight, TrendingUp, Search } from "lucide-react";
import { ConnectGSCButton } from "@/components/ConnectGSCButton";

// ─── Next step banner ─────────────────────────────────────────────────────────
function NextStep({
    icon: Icon,
    title,
    description,
    actionLabel,
    actionHref,
    color = "emerald",
}: {
    icon: React.ElementType;
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
    color?: "emerald" | "blue" | "amber" | "purple" | "rose";
}) {
    const palettes = {
        emerald: "bg-emerald-500/5 border-emerald-500/20 text-emerald-400",
        blue: "bg-blue-500/5 border-blue-500/20 text-blue-400",
        amber: "bg-amber-500/5 border-amber-500/20 text-amber-400",
        purple: "bg-purple-500/5 border-purple-500/20 text-purple-400",
        rose: "bg-rose-500/5 border-rose-500/20 text-rose-400",
    };
    const p = palettes[color];
    return (
        <div className={`flex items-start gap-4 p-4 rounded-xl border ${p} mt-1`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${p}`}>
                <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-0.5">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            </div>
            {actionLabel && actionHref && (
                <a
                    href={actionHref}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border ${p} hover:opacity-80 transition-opacity`}
                >
                    {actionLabel}
                    <ArrowRight className="w-3.5 h-3.5" />
                </a>
            )}
        </div>
    );
}

export const metadata: Metadata = {
    title: "Keywords | OptiAISEO",
    description: "Monitor keyword rankings and generate targeted blog content.",
};

// ─── Position badge ───────────────────────────────────────────────────────────
function PositionBadge({ position }: { position: number }) {
    if (position <= 3)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                #{position}
            </span>
        );
    if (position <= 10)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-xs font-bold border border-blue-500/20">
                #{position}
            </span>
        );
    if (position <= 20)
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20">
                #{position}
            </span>
        );
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20">
            #{position}
        </span>
    );
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getCompetitors } from "@/app/actions/competitors";
import { CompetitorManager } from "./CompetitorManager";
import { GenerateBlogButton } from "./GenerateBlogButton";
import { CannibalizationPanel } from "./CannibalizationPanel";
import { KeywordDiscovery } from "./KeywordDiscovery";
import { SeoResearchPanel } from "./SeoResearchPanel";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordClustersPanel } from "./KeywordClustersPanel";
import { KeywordSparkline } from "@/components/dashboard/KeywordSparkline";
import { KeywordSiteSwitcher } from "@/components/dashboard/KeywordSiteSwitcher";
import { TrackedKeywordsPanel } from "./TrackedKeywordsPanel";
import { ShareOfVoiceChart } from "./ShareOfVoiceChart";
import { DifficultyBadge } from "@/components/dashboard/DifficultyBadge";
import { IntentBadge } from "@/components/dashboard/IntentBadge";
import { getTrackedKeywords } from "@/app/actions/trackedKeywords";
import { estimateKeywordRoi } from "@/lib/keywords/roi";
import { getVisibilityScore } from "@/lib/keywords/visibility-score";
import { hasFeature } from "@/lib/stripe/plans";
import { RevenueSimulator } from "@/components/dashboard/RevenueSimulator";
import { CtrDiagnosisBanner } from "@/components/dashboard/CtrDiagnosisBanner";
import { KeywordPlaybookPanel } from "@/components/dashboard/KeywordPlaybookPanel";
// PATCH: import the new filterable client table
import { AllKeywordsTable } from "./AllKeywordsTable";
// PATCH: import the tabbed panel wrapper
import { KeywordTabPanels } from "./KeywordTabPanels";

// ─── Page ─────────────────────────────────────────────────────────────────────
type SiteRow = { id: string; domain: string };
type TrackedKwRow = { id: string; keyword: string; snapshots: { position: number; recordedAt: Date; searchVolume: number | null; cpc: number | null }[]; roi: ReturnType<typeof estimateKeywordRoi> | null; opportunityGapUsd: number };
type VisibilityRow = { score: number; trend: string; top10Pct: number } | null;

const MAX_TRACKED_MAP: Record<string, number> = { FREE: 0, STARTER: 10, PRO: 100, AGENCY: -1 };

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
    const session = await getServerSession(authOptions);
    const resolvedParams = await searchParams;
    let siteId = resolvedParams.siteId || "";

    let competitors: Awaited<ReturnType<typeof getCompetitors>>['competitors'] = [];
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
                orderBy: { createdAt: 'desc' },
            });
            userTier  = user.subscriptionTier ?? "FREE";
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
    let maxTracked = MAX_TRACKED_MAP[userTier] ?? 0;

    if (siteId) {
        const [tkRes, visRes] = await Promise.allSettled([
            getTrackedKeywords(siteId),
            getVisibilityScore(siteId),
        ]);
        if (tkRes.status === "fulfilled" && tkRes.value.success && 'keywords' in tkRes.value) {
            trackedKeywordsData = tkRes.value.keywords as TrackedKwRow[];
        }
        if (visRes.status === "fulfilled") {
            visibilityScore = visRes.value as VisibilityRow;
        }
    }

    // ── Error state ──
    if (!rankingsRes.success || !rankingsRes.data) {
        const isGscNotConnected = rankingsRes.error?.includes("Connect Google") ||
            rankingsRes.error?.includes("reconnect GSC");
        return (
            <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1">Keyword Rankings</h1>
                    <p className="text-muted-foreground">Powered by Google Search Console</p>
                </div>
                {isGscNotConnected ? (
                    <div className="relative rounded-2xl overflow-hidden border border-border">
                        <div className="blur-sm pointer-events-none opacity-60 card-surface">
                            <div className="p-6 border-b border-border">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    {[
                                        { label: "Total Keywords", val: "247", sub: "12,840 clicks" },
                                        { label: "Avg Position", val: "14.2", sub: "98,000 impressions" },
                                        { label: "On Page 1", val: "38%", sub: "94 keywords", hi: true },
                                        { label: "Need Fix", val: "61", sub: "23 critical", lo: true },
                                    ].map((s) => (
                                        <div key={s.label} className={`card-surface p-5 flex flex-col gap-1 ${s.hi ? "border-l-4 border-l-emerald-500" : s.lo ? "border-l-4 border-l-red-500" : ""}`}>
                                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{s.label}</p>
                                            <p className={`text-3xl font-bold ${s.hi ? "text-emerald-400" : s.lo ? "text-red-400" : ""}`}>{s.val}</p>
                                            <p className="text-xs text-muted-foreground">{s.sub}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                                        <tr>
                                            <th className="px-6 py-3">Keyword</th>
                                            <th className="px-6 py-3">Position</th>
                                            <th className="px-6 py-3">Clicks</th>
                                            <th className="px-6 py-3">Impressions</th>
                                            <th className="px-6 py-3">CTR</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {[
                                            { kw: "best seo tools 2025", pos: 4, clicks: 312, imp: 4200, ctr: "7.4%" },
                                            { kw: "ai seo platform", pos: 7, clicks: 189, imp: 3800, ctr: "5.0%" },
                                            { kw: "seo audit checklist", pos: 11, clicks: 94, imp: 2900, ctr: "3.2%" },
                                            { kw: "answer engine optimization", pos: 15, clicks: 47, imp: 1800, ctr: "2.6%" },
                                            { kw: "chatgpt seo strategy", pos: 22, clicks: 18, imp: 1400, ctr: "1.3%" },
                                            { kw: "technical seo guide", pos: 6, clicks: 276, imp: 3100, ctr: "8.9%" },
                                            { kw: "keyword ranking tracker", pos: 9, clicks: 143, imp: 2600, ctr: "5.5%" },
                                        ].map((row) => (
                                            <tr key={row.kw} className="hover:bg-card transition-colors">
                                                <td className="px-6 py-3.5 font-medium">{row.kw}</td>
                                                <td className="px-6 py-3.5">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${row.pos <= 3 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : row.pos <= 10 ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : row.pos <= 20 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>#{row.pos}</span>
                                                </td>
                                                <td className="px-6 py-3.5 text-muted-foreground">{row.clicks}</td>
                                                <td className="px-6 py-3.5 text-muted-foreground">{row.imp.toLocaleString()}</td>
                                                <td className="px-6 py-3.5 text-muted-foreground">{row.ctr}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-[2px] gap-4 px-4">
                            <Search className="w-12 h-12 text-muted-foreground" />
                            <div className="text-center">
                                <p className="font-bold text-lg mb-1">Connect Google Search Console</p>
                                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                                    Connect your Google account to see your real keyword rankings, positions, and click data.
                                </p>
                            </div>
                            <ConnectGSCButton callbackUrl="/dashboard/keywords" />
                        </div>
                    </div>
                ) : (
                    <div className="card-surface p-8 text-center border border-red-500/20">
                        <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                        <p className="text-red-400 font-medium mb-1">Failed to load keywords</p>
                        <p className="text-muted-foreground text-sm">{rankingsRes.error}</p>
                    </div>
                )}
            </div>
        );
    }

    const { keywords, categorised, summary, opportunities, cannibalization, siteId: resolvedSiteId } = rankingsRes.data!;
    const activeSiteId = siteId || resolvedSiteId;
    const activeSite = userSites.find(s => s.id === activeSiteId);

    // ── Helpers for stat card semantics ───────────────────────────────────────

    // PATCH: avg position gets a semantic colour — green is good (low pos), red is bad (high pos)
    function avgPositionColor(pos: number) {
        if (pos <= 10) return "text-emerald-400";
        if (pos <= 30) return "text-amber-400";
        return "text-red-400";
    }

    // PATCH: visibility score — blue only when actually scoring, muted/red when 0
    function visScoreColor(score: number) {
        if (score === 0)  return "text-muted-foreground";
        if (score < 30)   return "text-red-400";
        if (score < 60)   return "text-amber-400";
        return "text-blue-400";
    }

    // PATCH: visibility score subtext — was "0% in top 10" with no guidance
    function visScoreSubtext(vis: NonNullable<VisibilityRow>) {
        if (vis.score === 0) return "Not yet visible — fix critical issues";
        if (vis.trend === "improving") return "↑ Improving";
        if (vis.trend === "declining") return "↓ Declining";
        if (vis.trend === "stable")    return "→ Stable";
        return `${vis.top10Pct}% in top 10`;
    }

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">

            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1">Keyword Rankings</h1>
                    <p className="text-muted-foreground">
                        Powered by Google Search Console
                        {activeSite ? (
                            <> &middot; <span className="text-foreground font-medium">{activeSite.domain}</span></>
                        ) : null}
                        {" "}&middot; Last 90 days &middot; {summary.total} keywords tracked
                    </p>
                </div>
                {userSites.length > 0 && (
                    <KeywordSiteSwitcher
                        sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                        activeSiteId={activeSiteId}
                    />
                )}
            </div>

            {/* ── Summary stat cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* 1 — Total Keywords (unchanged) */}
                <div className="card-surface p-5 flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Keywords</p>
                    <p className="text-3xl font-bold">{summary.total}</p>
                    <p className="text-xs text-muted-foreground">{summary.totalClicks.toLocaleString()} clicks</p>
                </div>

                {/* 2 — Avg Position: PATCHED colour + border */}
                <div className={`card-surface p-5 flex flex-col gap-1 ${
                    summary.avgPosition <= 10 ? "border-l-4 border-l-emerald-500"
                    : summary.avgPosition <= 30 ? "border-l-4 border-l-amber-500"
                    : "border-l-4 border-l-red-500"
                }`}>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Avg Position</p>
                    <p className={`text-3xl font-bold ${avgPositionColor(summary.avgPosition)}`}>
                        {summary.avgPosition}
                    </p>
                    <p className="text-xs text-muted-foreground">{summary.totalImpressions.toLocaleString()} impressions</p>
                </div>

                {/* 3 — On Page 1 (unchanged) */}
                <div className="card-surface p-5 flex flex-col gap-1 border-l-4 border-l-emerald-500">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">On Page 1</p>
                    <p className="text-3xl font-bold text-emerald-400">{summary.page1Pct}%</p>
                    <p className="text-xs text-muted-foreground">{summary.page1Count} keywords</p>
                </div>

                {/* 4 — Visibility Score: PATCHED colour + copy */}
                {visibilityScore ? (
                    <div className={`card-surface p-5 flex flex-col gap-1 ${
                        visibilityScore.score === 0 ? "border-l-4 border-l-red-500"
                        : visibilityScore.score < 30 ? "border-l-4 border-l-red-500"
                        : visibilityScore.score < 60 ? "border-l-4 border-l-amber-500"
                        : "border-l-4 border-l-blue-500"
                    }`}>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Visibility Score</p>
                        <p className={`text-3xl font-bold ${visScoreColor(visibilityScore.score)}`}>
                            {visibilityScore.score}
                        </p>
                        <p className="text-xs text-muted-foreground">{visScoreSubtext(visibilityScore)}</p>
                    </div>
                ) : (
                    <div className="card-surface p-5 flex flex-col gap-1 border-l-4 border-l-red-500">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Need Fix</p>
                        <p className="text-3xl font-bold text-red-400">{summary.criticalCount + summary.weakCount}</p>
                        <p className="text-xs text-muted-foreground">{summary.criticalCount} critical, {summary.weakCount} weak</p>
                    </div>
                )}
            </div>

            {/* CTR Diagnosis banner — always above fold */}
            <div className="w-full">
                <CtrDiagnosisBanner keywords={keywords} domain={activeSite?.domain ?? ""} />
            </div>

            {/* Top Keyword Opportunities — always visible, primary action surface */}
            <div className="card-surface overflow-hidden">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center gap-2 mb-1">
                        <Zap className="w-5 h-5 text-amber-400" />
                        <h2 className="text-lg font-semibold">Top Keyword Opportunities</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Keywords with high impressions but poor rankings — generate a blog post to rank higher.
                    </p>
                </div>

                {opportunities.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        No clear opportunities found yet. Check back after more data accumulates in Search Console.
                    </div>
                ) : (
                    <>
                        {/* Mobile card list */}
                        <div className="md:hidden divide-y divide-border">
                            {opportunities.map((opp, i) => (
                                <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                                    <div className="shrink-0 mt-0.5">
                                        <PositionBadge position={opp.avgPosition} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{opp.keyword}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{opp.reason}</p>
                                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                                            <span>{opp.impressions.toLocaleString()} impr.</span>
                                            <span>{opp.ctr}% CTR</span>
                                            <span className="text-amber-400 font-bold">Score {opp.opportunityScore}</span>
                                        </div>
                                    </div>
                                    <div className="shrink-0">
                                        <GenerateBlogButton keyword={opp.keyword} position={opp.avgPosition} impressions={opp.impressions} siteId={activeSiteId} siteDomain={activeSite?.domain ?? ""} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-card/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                                    <tr>
                                        <th className="px-6 py-3">Keyword</th>
                                        <th className="px-6 py-3">Position</th>
                                        <th className="px-6 py-3">Impressions</th>
                                        <th className="px-6 py-3">CTR</th>
                                        <th className="px-6 py-3">Score</th>
                                        <th className="px-6 py-3">Why It Matters</th>
                                        <th className="px-6 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {opportunities.map((opp, i) => (
                                        <tr key={i} className="hover:bg-card transition-colors">
                                            <td className="px-6 py-4 font-medium max-w-[220px] truncate" title={opp.keyword}>{opp.keyword}</td>
                                            <td className="px-6 py-4"><PositionBadge position={opp.avgPosition} /></td>
                                            <td className="px-6 py-4 text-muted-foreground">{opp.impressions.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-muted-foreground">{opp.ctr}%</td>
                                            <td className="px-6 py-4"><span className="text-amber-400 font-bold">{opp.opportunityScore}</span></td>
                                            <td className="px-6 py-4 text-muted-foreground text-xs max-w-[260px] truncate" title={opp.reason}>{opp.reason}</td>
                                            <td className="px-6 py-4 text-right">
                                                <GenerateBlogButton keyword={opp.keyword} position={opp.avgPosition} impressions={opp.impressions} siteId={activeSiteId} siteDomain={activeSite?.domain ?? ""} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/*
                PATCH: All secondary panels are now inside a tabbed client wrapper.
                Previously 9 panels were stacked sequentially = massive scroll depth.
                Now they're grouped into 5 tabs, only one visible at a time.
            */}
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
                    revenueKeywords={(() => {
                        return trackedKeywordsData
                            .filter(kw => {
                                const snap = kw.snapshots?.at(-1);
                                return snap && snap.searchVolume && snap.searchVolume > 0 && snap.cpc && snap.cpc > 0;
                            })
                            .slice(0, 10)
                            .map(kw => {
                                const snap = kw.snapshots.at(-1)!;
                                return {
                                    id:           kw.id,
                                    keyword:      kw.keyword,
                                    position:     snap.position,
                                    searchVolume: snap.searchVolume!,
                                    cpc:          snap.cpc!,
                                };
                            });
                    })()}
                />
            )}

            {/* All keywords table — PATCHED: now uses AllKeywordsTable with search */}
            <AllKeywordsTable keywords={keywords} />

        </div>
    );
}