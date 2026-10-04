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

    if (!rankingsRes.success || !rankingsRes.data) {
        const isGscNotConnected =
            rankingsRes.error?.includes("Connect Google") ||
            rankingsRes.error?.includes("reconnect GSC");

        return (
            <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">Keyword Performance</h1>
                    <p className="text-sm text-muted-foreground">Track rankings, find opportunities and grow organic traffic.</p>
                </div>
                {isGscNotConnected ? (
                    <div className="relative rounded-xl overflow-hidden border border-border">
                        <div className="blur-sm pointer-events-none opacity-50 p-6">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                                {[
                                    { label: "Tracked Keywords", val: "247" },
                                    { label: "Page 1 Rankings", val: "38" },
                                    { label: "Need Attention", val: "61" },
                                    { label: "Clicks", val: "1.2k" },
                                ].map(s => (
                                    <div key={s.label} className="p-4 rounded-xl border border-border bg-muted">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                                        <p className="text-3xl font-semibold tracking-tight text-foreground">{s.val}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 bg-background/80 backdrop-blur-[2px]">
                            <Search className="w-10 h-10 text-muted-foreground" />
                            <div className="text-center">
                                <p className="font-bold text-lg text-foreground mb-1">Connect Google Search Console</p>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                    Connect your Google account to see real keyword rankings, positions, and click data.
                                </p>
                            </div>
                            <ConnectGSCButton callbackUrl="/dashboard/keywords" />
                        </div>
                    </div>
                ) : (
                    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center">
                        <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-3" />
                        <p className="text-destructive font-medium mb-1">Failed to load keywords</p>
                        <p className="text-sm text-muted-foreground">{rankingsRes.error}</p>
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

            <PageHeader
                title="Keyword Rankings"
                description={`Track rankings, find opportunities and grow organic traffic · ${("dateLabel" in (rankingsRes.data ?? {}) ? (rankingsRes.data as { dateLabel?: string }).dateLabel : null) ?? dateLabel} · GSC + GA4`}
                category="Monitor"
                metrics={[
                    { label: "Tracked", value: fmt(summary.total), color: "text-foreground", sub: `${summary.page1Count} on page 1` },
                    { label: "Page 1", value: String(summary.page1Count), color: "text-brand", sub: `${summary.top3Count} in top 3` },
                    { label: "Need Attention", value: String(needAttention), color: needAttention > 0 ? "text-destructive" : "text-muted-foreground", sub: `${needPct}% of keywords` },
                    { label: "Clicks", value: fmt(summary.totalClicks), color: "text-foreground", sub: dateLabel },
                ]}
            />

            <div className="flex items-center justify-between gap-3 flex-wrap -mt-2">
                <GscDateRangePicker activeLabel={dateLabel} siteId={activeSiteId} />
                {userSites.length > 0 && (
                    <KeywordSiteSwitcher
                        sites={userSites.map(s => ({ id: s.id, domain: s.domain }))}
                        activeSiteId={activeSiteId}
                    />
                )}
            </div>

            {summary.total === 0 && <GscConnectCard siteDomain={activeSite?.domain} />}

            {/* Step 1: Duplicate KpiCard grid removed — data is now in PageHeader metrics */}

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