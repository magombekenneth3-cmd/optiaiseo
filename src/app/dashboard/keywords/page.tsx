import type { Metadata } from "next";
import { AlertCircle, Search, Eye } from "lucide-react";
import { ConnectGSCButton } from "@/components/ConnectGSCButton";
import { GscConnectCard } from "@/components/dashboard/GscConnectCard";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCompetitors } from "@/app/actions/competitors";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordSiteSwitcher } from "@/components/dashboard/KeywordSiteSwitcher";
import { getKeywordRankingsFast, getKeywordRankingsByDateRange } from "@/app/actions/keywords";
import { getTrackedKeywords } from "@/app/actions/trackedKeywords";
import { estimateKeywordRoi } from "@/lib/keywords/roi";
import { getVisibilityScore } from "@/lib/keywords/visibility-score";
import { hasFeature, getPlan } from "@/lib/stripe/plans";
import { KeywordTabPanels } from "./KeywordTabPanels";
import { CollapsibleAnalytics } from "./CollapsibleAnalytics";
import { PriorityActions } from "./OpportunitiesList";
import { GscDateRangePicker } from "./components/GscDateRangePicker";
import { normalizeKeywordDateRange, isDefaultRange } from "@/lib/gsc/gsc-date-range";
import { PageHeader } from "@/components/ui/design-system/PageHeader";

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

const HEALTH_BUCKETS = [
    { label: "Critical", key: "criticalCount" as const, color: "var(--destructive)" },
    { label: "Weak",     key: "weakCount"    as const, color: "var(--warning)" },
    { label: "Improving",key: "improvingCount" as const, color: "var(--info)" },
    { label: "Strong",  key: "strongCount"   as const, color: "var(--brand)" },
];

function HealthBar({ summary }: {
    summary: { criticalCount: number; weakCount: number; improvingCount: number; strongCount: number };
}) {
    const total = HEALTH_BUCKETS.reduce((s, b) => s + summary[b.key], 0) || 1;

    return (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border bg-card flex-wrap">
            <span className="text-xs font-semibold text-foreground shrink-0">Keyword Health</span>
            <div className="flex-1 flex h-[5px] rounded-full overflow-hidden gap-[1px] min-w-[80px]">
                {HEALTH_BUCKETS.filter(b => summary[b.key] > 0).map(b => (
                    <div key={b.label} className="h-full rounded-full" style={{ width: `${(summary[b.key] / total) * 100}%`, background: b.color }} />
                ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                {HEALTH_BUCKETS.map(b => (
                    <div key={b.label} className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
                        <span className="text-xs text-muted-foreground">
                            {b.label} <span className="font-semibold" style={{ color: b.color }}>{summary[b.key]}</span>
                        </span>
                    </div>
                ))}
            </div>
            {summary.criticalCount > 0 && (
                <a href="#workspace" className="shrink-0 text-xs font-semibold text-info hover:opacity-80 transition-colors">
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
        <div className="rounded-xl border border-border bg-card overflow-hidden h-full flex flex-col">
            <div className="px-5 py-3 border-b border-border/60">
                <h2 className="text-sm font-semibold text-foreground">Traffic & Search Performance</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Google Search Console + GA4</p>
            </div>
            <div className="flex-1 px-5 py-4">
                <div className="mb-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-[0.06em]">Organic clicks</span>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{fmt(summary.totalClicks)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <p className="text-base font-bold text-foreground/80 tabular-nums">{fmt(summary.totalImpressions)}</p>
                        <p className="text-xs text-muted-foreground">Impressions</p>
                    </div>
                    <div>
                        <p className="text-base font-bold text-foreground/80 tabular-nums">{summary.page1Pct}%</p>
                        <p className="text-xs text-muted-foreground">Page 1 rate</p>
                    </div>
                </div>
                {visibilityScore && (
                    <div className="mt-4 pt-3 border-t border-border/60">
                        <div className="flex items-center gap-2">
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Visibility</span>
                            <span className="text-sm font-bold text-foreground ml-auto tabular-nums">{visibilityScore.score}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 text-right">{visibilityScore.top10Pct}% in top 10</p>
                    </div>
                )}
            </div>
            <a href="#analytics" className="flex items-center justify-center gap-1 px-5 py-2 border-t border-border/60 text-xs font-semibold text-brand hover:bg-accent transition-colors">
                View full analytics ↓
            </a>
        </div>
    );
}

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ siteId?: string; days?: string; startDate?: string; endDate?: string }> }) {
    const session = await getServerSession(authOptions);
    const resolvedParams = await searchParams;
    let siteId = resolvedParams.siteId || "";

    // Resolve date range from URL params
    const dateParams = {
        days: resolvedParams.days,
        startDate: resolvedParams.startDate,
        endDate: resolvedParams.endDate,
    };
    const useCustomRange = !isDefaultRange(dateParams);
    let dateLabel = "Last 90 days";
    try {
        const range = normalizeKeywordDateRange(dateParams);
        dateLabel = range.label;
    } catch {
        // Invalid date params — fall back to default 90d
    }

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

    const rankingsRes = useCustomRange && siteId
        ? await getKeywordRankingsByDateRange(siteId, dateParams)
        : await getKeywordRankingsFast(siteId);

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

    // ── FIX #5: GSC data is optional — Research/Discovery work without it ────
    // Instead of returning early with a full-page wall, we render the page with
    // GSC-dependent panels showing an inline connect banner, while Research,
    // Discovery, and Clusters tabs remain fully accessible.
    const gscAvailable = rankingsRes.success && !!rankingsRes.data;
    const isGscNotConnected =
        !gscAvailable && (
            rankingsRes.error?.includes("Connect Google") ||
            rankingsRes.error?.includes("reconnect GSC")
        );

    // Build safe defaults when GSC data is unavailable
    const gscData = gscAvailable ? rankingsRes.data! : null;
    const keywords = gscData?.keywords ?? [];
    const categorised = gscData?.categorised ?? {};
    const summary = gscData?.summary ?? {
        total: 0, page1Count: 0, top3Count: 0,
        totalClicks: 0, totalImpressions: 0, page1Pct: 0,
        criticalCount: 0, weakCount: 0, improvingCount: 0, strongCount: 0,
    };
    const opportunities = gscData?.opportunities ?? [];
    const activeSiteId = siteId || (gscData as { siteId?: string } | null)?.siteId || "";
    const activeSite = userSites.find(s => s.id === activeSiteId);
    const needAttention = summary.criticalCount + summary.weakCount;
    const needPct = summary.total > 0 ? Math.round((needAttention / summary.total) * 100) : 0;

    return (
        <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto">

            <PageHeader
                title="Keyword Research & Rankings"
                description={
                    gscAvailable
                        ? `Track rankings, find opportunities and grow organic traffic · ${(("dateLabel" in (rankingsRes.data ?? {}) ? (rankingsRes.data as { dateLabel?: string }).dateLabel : null) ?? dateLabel)} · GSC + GA4`
                        : "Discover keyword opportunities, run competitive research, and plan content — no GSC required"
                }
                category="Research"
                metrics={gscAvailable ? [
                    { label: "Tracked", value: fmt(summary.total), color: "text-foreground", sub: `${summary.page1Count} on page 1` },
                    { label: "Page 1", value: String(summary.page1Count), color: "text-brand", sub: `${summary.top3Count} in top 3` },
                    { label: "Need Attention", value: String(needAttention), color: needAttention > 0 ? "text-destructive" : "text-muted-foreground", sub: `${needPct}% of keywords` },
                    { label: "Clicks", value: fmt(summary.totalClicks), color: "text-foreground", sub: dateLabel },
                ] : []}
            />

            {gscAvailable && (
                <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
                    <GscDateRangePicker activeLabel={dateLabel} siteId={activeSiteId} />
                    {userSites.length > 0 && (
                        <KeywordSiteSwitcher
                            sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                            activeSiteId={activeSiteId}
                        />
                    )}
                </div>
            )}

            {/* GSC connection banner — inline, not blocking */}
            {isGscNotConnected && (
                <div className="rounded-xl border border-border/60 bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
                            <Search className="w-5 h-5 text-info" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm text-foreground">Connect Google Search Console for ranking data</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Keyword Research, AI Discovery, and Sitemap Import work without GSC.
                                Connect GSC to unlock ranking tracking, position history, and click data.
                            </p>
                        </div>
                    </div>
                    <ConnectGSCButton callbackUrl="/dashboard/keywords" />
                </div>
            )}

            {!gscAvailable && !isGscNotConnected && rankingsRes.error && (
                <div className="rounded-xl border border-warning/20 bg-warning/5 p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-warning">GSC data temporarily unavailable</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rankingsRes.error}. Keyword research tools below still work.</p>
                    </div>
                </div>
            )}

            {!gscAvailable && userSites.length > 0 && (
                <div className="flex items-center justify-end gap-3 flex-wrap -mt-2">
                    <KeywordSiteSwitcher
                        sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                        activeSiteId={activeSiteId}
                    />
                </div>
            )}

            {summary.total === 0 && gscAvailable && <GscConnectCard siteDomain={activeSite?.domain} />}

            {gscAvailable && <HealthBar summary={summary} />}

            {gscAvailable && (
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
            )}

            {/* Keyword Workspace — ALWAYS rendered, GSC-dependent tabs show inline prompts */}
            {(activeSiteId || userSites.length > 0) && (
                <KeywordTabPanels
                    siteId={activeSiteId || userSites[0]?.id || ""}
                    categorised={categorised}
                    opportunities={opportunities}
                    summary={summary}
                    domain={activeSite?.domain ?? userSites[0]?.domain ?? ""}
                    userTier={userTier}
                    maxTracked={maxTracked}
                    trackedKeywordsData={trackedKeywordsData}
                    competitors={competitors}
                    hasRankTracking={hasFeature(userTier, "rankTracking")}
                    hasShareOfVoice={trackedKeywordsData.length > 0}
                    competitorCount={(competitors as unknown[]).length}
                    trackedCount={trackedKeywordsData.length}
                    keywords={keywords}
                    gscAvailable={gscAvailable}
                />
            )}

            {gscAvailable && activeSiteId && (
                <div id="analytics">
                    <PanelErrorBoundary fallbackTitle="Traffic & Search Performance">
                        <CollapsibleAnalytics siteId={activeSiteId} />
                    </PanelErrorBoundary>
                </div>
            )}

        </div>
    );
}