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
import { RevenueSimulator } from "@/components/dashboard/RevenueSimulator";
import { KeywordClustersPanel } from "./KeywordClustersPanel";
import { estimateKeywordRoi } from "@/lib/keywords/roi";

const TABS = [
    { id: "playbook",    label: "Playbook",    desc: "AI-ranked quick wins & fixes"       },
    { id: "research",    label: "Research",    desc: "Discover new keyword opportunities"  },
    { id: "competitors", label: "Competitors", desc: "Benchmark against rivals"            },
    { id: "tracked",     label: "Tracked",     desc: "Position history & rank tracking"    },
    { id: "revenue",     label: "Revenue",     desc: "Simulate ranking revenue impact"     },
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
    revenueKeywords: { id: string; keyword: string; position: number; searchVolume: number; cpc: number }[];
    competitorCount?: number;
    trackedCount?: number;
}

export function KeywordTabPanels({
    siteId, categorised, opportunities, summary, domain,
    userTier, maxTracked, trackedKeywordsData, competitors,
    hasRankTracking, hasShareOfVoice, revenueKeywords,
    competitorCount = 0, trackedCount = 0,
}: Props) {
    const [activeTab, setActiveTab] = useState<TabId>("playbook");

    return (
        <div className="rounded-2xl border border-[#30363d] bg-[#0d1117] overflow-hidden">
            {/* Tab bar */}
            <div className="flex overflow-x-auto border-b border-[#21262d] scrollbar-none bg-[#0a0d11]">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const badge =
                        tab.id === "competitors" && competitorCount > 0 ? competitorCount :
                        tab.id === "tracked"     && trackedCount    > 0 ? trackedCount    : undefined;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                "shrink-0 flex items-center gap-2 px-5 py-3.5 text-[13px] font-medium transition-colors whitespace-nowrap border-b-2 -mb-px",
                                isActive
                                    ? "border-[#388bfd] text-[#e6edf3]"
                                    : "border-transparent text-[#6e7681] hover:text-[#c9d1d9] hover:border-[#30363d]",
                            ].join(" ")}
                        >
                            {tab.label}
                            {badge !== undefined && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-[#388bfd]/20 text-[#388bfd]" : "bg-[#21262d] text-[#6e7681]"}`}>
                                    {badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Description sub-line */}
            <div className="px-5 py-2 border-b border-[#161b22]">
                <p className="text-[11px] text-[#6e7681]">
                    {TABS.find(t => t.id === activeTab)?.desc}
                </p>
            </div>

            {/* Panel content */}
            <div className="p-1">
                {activeTab === "playbook" && (
                    <PanelErrorBoundary fallbackTitle="Playbook panel failed to load">
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
                                <div className="py-12 text-center text-[#6e7681] text-sm">Rank tracking is available on the Pro plan and above.</div>
                            )}
                            {hasShareOfVoice && <ShareOfVoiceChart siteId={siteId} />}
                        </div>
                    </PanelErrorBoundary>
                )}
                {activeTab === "revenue" && (
                    <PanelErrorBoundary fallbackTitle="Revenue panel failed to load">
                        <div className="p-5">
                            {revenueKeywords.length >= 2 ? (
                                <RevenueSimulator keywords={revenueKeywords} />
                            ) : (
                                <div className="py-12 text-center text-[#6e7681] text-sm">Track at least 2 keywords with search volume and CPC data to unlock the Revenue Simulator.</div>
                            )}
                        </div>
                    </PanelErrorBoundary>
                )}
            </div>
        </div>
    );
}
