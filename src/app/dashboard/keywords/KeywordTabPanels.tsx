"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordPlaybookPanel } from "@/components/dashboard/KeywordPlaybookPanel";
import { CannibalizationPanel } from "./CannibalizationPanel";
import { DeviceCtrGapPanel } from "@/components/dashboard/DeviceCtrGapPanel";
import { SeoResearchPanel } from "./SeoResearchPanel";
import { KeywordDiscovery } from "./KeywordDiscovery";
import { CompetitorManager } from "./CompetitorManager";
import { ShareOfVoiceChart } from "./ShareOfVoiceChart";
import { TrackedKeywordsPanel } from "./TrackedKeywordsPanel";
import { KeywordClustersPanel } from "./KeywordClustersPanel";
import { AllKeywordsTable } from "./AllKeywordsTable";
import { estimateKeywordRoi } from "@/lib/keywords/roi";
import { SerpFeatureHistoryPanel } from "./SerpFeatureHistoryPanel";
import { TopicalAuthorityPanel } from "./TopicalAuthorityPanel";
import { PositionDistributionChart } from "./components/PositionDistributionChart";
import { BiggestMovers } from "./components/BiggestMovers";

const TABS = [
    { id: "keywords",      label: "Keywords",      desc: "Full keyword rankings from Search Console", needsGsc: true },
    { id: "opportunities", label: "Opportunities", desc: "AI-ranked actions to improve rankings",      needsGsc: true },
    { id: "research",      label: "Research",      desc: "Discover new keyword opportunities",         needsGsc: false },
    { id: "competitors",   label: "Competitors",   desc: "Benchmark against rivals",                   needsGsc: true },
    { id: "tracked",       label: "Tracked",       desc: "Position history & rank tracking",           needsGsc: true },
    { id: "authority",     label: "Authority Map",  desc: "Topical clusters, pillar/spoke coverage",    needsGsc: true },
] as const;

type TabId = typeof TABS[number]["id"];

interface Props {
    siteId: string;
    categorised: unknown;
    opportunities: unknown;
    summary: unknown;
    domain: string;
    userTier: string;
    maxTracked: number;
    trackedKeywordsData: {
        id: string;
        keyword: string;
        snapshots: { position: number; recordedAt: Date; searchVolume: number | null; cpc: number | null }[];
        roi: ReturnType<typeof estimateKeywordRoi> | null;
        opportunityGapUsd: number;
    }[];
    competitors: unknown;
    hasRankTracking: boolean;
    hasShareOfVoice: boolean;
    competitorCount?: number;
    trackedCount?: number;
    keywords?: { keyword: string; position: number; clicks: number; impressions: number; ctr: number; url: string; intent?: string | null; difficulty?: number | null; positionHistory?: { date: string; position: number }[] }[];
    /** FIX #5: When false, GSC-dependent tabs show inline connect prompts */
    gscAvailable?: boolean;
}

/** Inline banner shown inside GSC-dependent tabs when GSC is not connected */
function GscRequiredBanner({ tabLabel }: { tabLabel: string }) {
    return (
        <div className="py-16 px-6 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-info/10 flex items-center justify-center">
                <Search className="w-6 h-6 text-info" />
            </div>
            <div>
                <p className="font-semibold text-foreground mb-1">
                    {tabLabel} requires Google Search Console
                </p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Connect your Google Search Console to view {tabLabel.toLowerCase()} data.
                    Use the <strong>Research</strong> tab for keyword discovery without GSC.
                </p>
            </div>
        </div>
    );
}

export function KeywordTabPanels({
    siteId, categorised, opportunities, summary, domain,
    userTier, maxTracked, trackedKeywordsData, competitors,
    hasRankTracking, hasShareOfVoice,
    competitorCount = 0, trackedCount = 0, keywords = [],
    gscAvailable = true,
}: Props) {
    // FIX #5: Default to Research tab when GSC is unavailable
    const [activeTab, setActiveTab] = useState<TabId>(gscAvailable ? "keywords" : "research");

    const needAttention = keywords.filter(k => k.position > 10).length;
    const badges: Partial<Record<TabId, number>> = {};
    if (keywords.length > 0) badges.keywords = keywords.length;
    if (needAttention > 0) badges.opportunities = needAttention;
    if (competitorCount > 0) badges.competitors = competitorCount;
    if (trackedCount > 0) badges.tracked = trackedCount;

    return (
        <div id="workspace" className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 pt-4 pb-0">
                <h2 className="text-sm font-semibold text-foreground mb-3">Keyword Workspace</h2>
            </div>
            <div className="flex overflow-x-auto border-b border-border scrollbar-none px-5">
                {TABS.map(tab => {
                    const isActive = activeTab === tab.id;
                    const badge = badges[tab.id];
                    const isDisabledByGsc = tab.needsGsc && !gscAvailable;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                "shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                                isActive
                                    ? "border-info text-foreground"
                                    : isDisabledByGsc
                                        ? "border-transparent text-muted-foreground/50 hover:text-muted-foreground/70"
                                        : "border-transparent text-muted-foreground hover:text-foreground",
                            ].join(" ")}
                            title={isDisabledByGsc ? `${tab.label} requires GSC connection` : tab.desc}
                        >
                            {tab.label}
                            {isDisabledByGsc && !isActive && (
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" title="Needs GSC" />
                            )}
                            {badge !== undefined && (
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                                    isActive ? "bg-info/20 text-info" : "bg-muted text-muted-foreground"
                                }`}>
                                    {badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div>
                {activeTab === "keywords" && (
                    <PanelErrorBoundary fallbackTitle="Keywords table failed to load">
                        {gscAvailable ? (
                            <>
                                <AllKeywordsTable keywords={keywords} siteId={siteId} />
                                {keywords.length > 0 && (
                                    <div className="flex flex-col gap-4 p-5 border-t border-border/60">
                                        <PositionDistributionChart keywords={keywords} />
                                        <BiggestMovers keywords={keywords} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <GscRequiredBanner tabLabel="Keywords" />
                        )}
                    </PanelErrorBoundary>
                )}
                {activeTab === "opportunities" && (
                    <PanelErrorBoundary fallbackTitle="Opportunities panel failed to load">
                        {gscAvailable ? (
                            <div className="flex flex-col gap-4 p-5">
                                <KeywordPlaybookPanel categorised={categorised as never} opportunities={opportunities as never} summary={summary as never} domain={domain} siteId={siteId} />
                                <CannibalizationPanel siteId={siteId} />
                                <DeviceCtrGapPanel siteId={siteId} />
                            </div>
                        ) : (
                            <GscRequiredBanner tabLabel="Opportunities" />
                        )}
                    </PanelErrorBoundary>
                )}
                {activeTab === "research" && (
                    <PanelErrorBoundary fallbackTitle="Research panel failed to load">
                        <div className="flex flex-col gap-4 p-5">
                            <SeoResearchPanel siteId={siteId} />
                            <KeywordDiscovery siteId={siteId} />
                            <KeywordClustersPanel siteId={siteId} />
                        </div>
                    </PanelErrorBoundary>
                )}
                {activeTab === "competitors" && (
                    <PanelErrorBoundary fallbackTitle="Competitors panel failed to load">
                        {gscAvailable ? (
                            <div className="p-5">
                                <CompetitorManager siteId={siteId} initialCompetitors={competitors as never} />
                            </div>
                        ) : (
                            <GscRequiredBanner tabLabel="Competitors" />
                        )}
                    </PanelErrorBoundary>
                )}
                {activeTab === "tracked" && (
                    <PanelErrorBoundary fallbackTitle="Tracked Keywords panel failed to load">
                        {gscAvailable ? (
                            <div className="flex flex-col gap-4 p-5">
                                {hasRankTracking ? (
                                    <TrackedKeywordsPanel siteId={siteId} initialData={trackedKeywordsData} tier={userTier} maxTracked={maxTracked} />
                                ) : (
                                    <div className="py-12 text-center text-muted-foreground text-sm">Rank tracking is available on the Pro plan and above.</div>
                                )}
                                {hasShareOfVoice && <ShareOfVoiceChart siteId={siteId} />}
                                <SerpFeatureHistoryPanel siteId={siteId} />
                            </div>
                        ) : (
                            <GscRequiredBanner tabLabel="Tracked Keywords" />
                        )}
                    </PanelErrorBoundary>
                )}
                {activeTab === "authority" && (
                    <PanelErrorBoundary fallbackTitle="Authority Map failed to load">
                        {gscAvailable ? (
                            <div className="p-5">
                                <TopicalAuthorityPanel siteId={siteId} />
                            </div>
                        ) : (
                            <GscRequiredBanner tabLabel="Authority Map" />
                        )}
                    </PanelErrorBoundary>
                )}
            </div>
        </div>
    );
}
