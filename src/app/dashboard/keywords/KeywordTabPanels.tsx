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

const TABS = [
    { id: "keywords", label: "Keywords", desc: "Full keyword rankings from Search Console" },
    { id: "opportunities", label: "Opportunities", desc: "AI-ranked actions to improve rankings" },
    { id: "research", label: "Research", desc: "Discover new keyword opportunities" },
    { id: "competitors", label: "Competitors", desc: "Benchmark against rivals" },
    { id: "tracked", label: "Tracked", desc: "Position history & rank tracking" },
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
        <div id="workspace" className="rounded-xl border border-[#21262d] bg-[#0d1117] overflow-hidden">
            <div className="px-5 pt-4 pb-0">
                <h2 className="text-[14px] font-semibold text-[#e6edf3] mb-3">Keyword Workspace</h2>
            </div>
            <div className="flex overflow-x-auto border-b border-[#21262d] scrollbar-none px-5">
                {TABS.map(tab => {
                    const isActive = activeTab === tab.id;
                    const badge = badges[tab.id];
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                "shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                                isActive
                                    ? "border-[#388bfd] text-[#e6edf3]"
                                    : "border-transparent text-[#6e7681] hover:text-[#c9d1d9]",
                            ].join(" ")}
                        >
                            {tab.label}
                            {badge !== undefined && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    isActive ? "bg-[#388bfd]/20 text-[#388bfd]" : "bg-[#21262d] text-[#6e7681]"
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
                                <div className="py-12 text-center text-[#6e7681] text-[12px]">Rank tracking is available on the Pro plan and above.</div>
                            )}
                            {hasShareOfVoice && <ShareOfVoiceChart siteId={siteId} />}
                            <SerpFeatureHistoryPanel siteId={siteId} />
                        </div>
                    </PanelErrorBoundary>
                )}
            </div>
        </div>
    );
}
