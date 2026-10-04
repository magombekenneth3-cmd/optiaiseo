"use client";

import { useState } from "react";
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
    { id: "keywords", label: "Keywords", desc: "Full keyword rankings from Search Console" },
    { id: "opportunities", label: "Opportunities", desc: "AI-ranked actions to improve rankings" },
    { id: "research", label: "Research", desc: "Discover new keyword opportunities" },
    { id: "competitors", label: "Competitors", desc: "Benchmark against rivals" },
    { id: "tracked", label: "Tracked", desc: "Position history & rank tracking" },
    { id: "authority", label: "Authority Map", desc: "Topical clusters, pillar/spoke coverage, internal link detection" },
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
}

export function KeywordTabPanels({
    siteId, categorised, opportunities, summary, domain,
    userTier, maxTracked, trackedKeywordsData, competitors,
    hasRankTracking, hasShareOfVoice,
    competitorCount = 0, trackedCount = 0, keywords = [],
}: Props) {
    const [activeTab, setActiveTab] = useState<TabId>("keywords");

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
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                "shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                                isActive
                                    ? "border-info text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            ].join(" ")}
                        >
                            {tab.label}
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
                        <AllKeywordsTable keywords={keywords} siteId={siteId} />
                        {/* Step 7: Position distribution + biggest movers below the table */}
                        {keywords.length > 0 && (
                            <div className="flex flex-col gap-4 p-5 border-t border-border/60">
                                <PositionDistributionChart keywords={keywords} />
                                <BiggestMovers keywords={keywords} />
                            </div>
                        )}
                    </PanelErrorBoundary>
                )}
                {activeTab === "opportunities" && (
                    <PanelErrorBoundary fallbackTitle="Opportunities panel failed to load">
                        <div className="flex flex-col gap-4 p-5">
                            <KeywordPlaybookPanel categorised={categorised as never} opportunities={opportunities as never} summary={summary as never} domain={domain} siteId={siteId} />
                            <CannibalizationPanel siteId={siteId} />
                            <DeviceCtrGapPanel siteId={siteId} />
                        </div>
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
                        <div className="p-5">
                            <CompetitorManager siteId={siteId} initialCompetitors={competitors as never} />
                        </div>
                    </PanelErrorBoundary>
                )}
                {activeTab === "tracked" && (
                    <PanelErrorBoundary fallbackTitle="Tracked Keywords panel failed to load">
                        <div className="flex flex-col gap-4 p-5">
                            {hasRankTracking ? (
                                <TrackedKeywordsPanel siteId={siteId} initialData={trackedKeywordsData} tier={userTier} maxTracked={maxTracked} />
                            ) : (
                                <div className="py-12 text-center text-muted-foreground text-sm">Rank tracking is available on the Pro plan and above.</div>
                            )}
                            {hasShareOfVoice && <ShareOfVoiceChart siteId={siteId} />}
                            <SerpFeatureHistoryPanel siteId={siteId} />
                        </div>
                    </PanelErrorBoundary>
                )}
                {activeTab === "authority" && (
                    <PanelErrorBoundary fallbackTitle="Authority Map failed to load">
                        <div className="p-5">
                            <TopicalAuthorityPanel siteId={siteId} />
                        </div>
                    </PanelErrorBoundary>
                )}
            </div>
        </div>
    );
}
