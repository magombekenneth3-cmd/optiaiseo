"use client";

/**
 * KeywordTabPanels
 *
 * PATCH: replaces the 9-panel sequential stack in keywords/page.tsx.
 * Renders a tab bar + one active panel at a time, dramatically reducing
 * scroll depth and cognitive load.
 *
 * Tab order (action-oriented first):
 *   Playbook → Research → Competitors → Tracked → Revenue
 *
 * All panel imports happen here so page.tsx stays a clean server component.
 */

import { useState } from "react";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { KeywordPlaybookPanel } from "@/components/dashboard/KeywordPlaybookPanel";
import { CannibalizationPanel } from "./CannibalizationPanel";
import { SeoResearchPanel } from "./SeoResearchPanel";
import { KeywordDiscovery } from "./KeywordDiscovery";
import { CompetitorManager } from "./CompetitorManager";
import { ShareOfVoiceChart } from "./ShareOfVoiceChart";
import { TrackedKeywordsPanel } from "./TrackedKeywordsPanel";
import { RevenueSimulator } from "@/components/dashboard/RevenueSimulator";
import { KeywordClustersPanel } from "./KeywordClustersPanel";
import { estimateKeywordRoi } from "@/lib/keywords/roi";

const TABS = [
    { id: "playbook",    label: "Playbook"     },
    { id: "research",    label: "Research"     },
    { id: "competitors", label: "Competitors"  },
    { id: "tracked",     label: "Tracked"      },
    { id: "revenue",     label: "Revenue"      },
] as const;

type TabId = typeof TABS[number]["id"];

interface Props {
    siteId:              string;
    categorised:         unknown;
    opportunities:       unknown;
    summary:             unknown;
    domain:              string;
    userTier:            string;
    maxTracked:          number;
    trackedKeywordsData: {
        id:                string;
        keyword:           string;
        snapshots:         { position: number; recordedAt: Date; searchVolume: number | null; cpc: number | null }[];
        roi:               ReturnType<typeof estimateKeywordRoi> | null;
        opportunityGapUsd: number;
    }[];
    competitors:         unknown;
    hasRankTracking:     boolean;
    hasShareOfVoice:     boolean;
    revenueKeywords:     { id: string; keyword: string; position: number; searchVolume: number; cpc: number }[];
}

export function KeywordTabPanels({
    siteId,
    categorised,
    opportunities,
    summary,
    domain,
    userTier,
    maxTracked,
    trackedKeywordsData,
    competitors,
    hasRankTracking,
    hasShareOfVoice,
    revenueKeywords,
}: Props) {
    const [activeTab, setActiveTab] = useState<TabId>("playbook");

    return (
        <div className="card-surface overflow-hidden">
            {/* ── Tab bar ── */}
            <div className="flex overflow-x-auto border-b border-border scrollbar-none">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                            "shrink-0 px-5 py-3.5 text-sm font-medium transition-colors whitespace-nowrap",
                            "border-b-2 -mb-px",
                            activeTab === tab.id
                                ? "border-[var(--brand)] text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                        ].join(" ")}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ── Panel content ── */}
            <div className="p-1">

                {activeTab === "playbook" && (
                    <PanelErrorBoundary fallbackTitle="Playbook panel failed to load">
                        <div className="flex flex-col gap-4 p-5">
                            <KeywordPlaybookPanel
                                categorised={categorised as never}
                                opportunities={opportunities as never}
                                summary={summary as never}
                                domain={domain}
                                siteId={siteId}
                            />
                            <CannibalizationPanel siteId={siteId} />
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
                            <CompetitorManager
                                siteId={siteId}
                                initialCompetitors={competitors as never}
                            />
                        </div>
                    </PanelErrorBoundary>
                )}

                {activeTab === "tracked" && (
                    <PanelErrorBoundary fallbackTitle="Tracked Keywords panel failed to load">
                        <div className="flex flex-col gap-4 p-5">
                            {hasRankTracking ? (
                                <TrackedKeywordsPanel
                                    siteId={siteId}
                                    initialData={trackedKeywordsData}
                                    tier={userTier}
                                    maxTracked={maxTracked}
                                />
                            ) : (
                                <div className="py-12 text-center text-muted-foreground text-sm">
                                    Rank tracking is available on the Pro plan and above.
                                </div>
                            )}
                            {hasShareOfVoice && (
                                <ShareOfVoiceChart siteId={siteId} />
                            )}
                        </div>
                    </PanelErrorBoundary>
                )}

                {activeTab === "revenue" && (
                    <PanelErrorBoundary fallbackTitle="Revenue panel failed to load">
                        <div className="p-5">
                            {revenueKeywords.length >= 2 ? (
                                <RevenueSimulator keywords={revenueKeywords} />
                            ) : (
                                <div className="py-12 text-center text-muted-foreground text-sm">
                                    Track at least 2 keywords with search volume and CPC data to unlock the Revenue Simulator.
                                </div>
                            )}
                        </div>
                    </PanelErrorBoundary>
                )}

            </div>
        </div>
    );
}
