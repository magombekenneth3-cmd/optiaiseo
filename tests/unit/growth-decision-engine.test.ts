import { describe, it, expect } from "vitest";
import { consolidateOpportunities } from "@/lib/opportunity-engine/deduplicator";
import { rankGrowthDecisions } from "@/lib/opportunity-engine/decision-ranker";
import { analyzeSerpConsensus } from "@/lib/intelligence/intent-profiler";
import { normalizeUrl } from "@/lib/opportunity-engine/detector";
import { RawOpportunitySignal } from "@/lib/opportunity-engine/types";

describe("AISEO Growth Decision Engine Unit Tests", () => {
    describe("URL Normalization (normalizeUrl)", () => {
        it("should normalize raw URLs to canonical path", () => {
            expect(normalizeUrl("https://optiaiseo.com/blog/test-page/", "optiaiseo.com")).toBe("/blog/test-page");
            expect(normalizeUrl("https://www.optiaiseo.com/blog/test-page?utm=1", "optiaiseo.com")).toBe("/blog/test-page");
        });
    });

    describe("Opportunity Deduplicator (consolidateOpportunities)", () => {
        it("should merge multiple raw signals for the same URL into a single record", () => {
            const rawSignals: RawOpportunitySignal[] = [
                {
                    url: "/blog/seo-tools",
                    keyword: "best seo tools",
                    category: "STALE",
                    impressions: 1200,
                    clicks: 45,
                    position: 8.7,
                    inboundInternalLinksCount: 1,
                    evidenceText: "Stale content",
                },
                {
                    url: "/blog/seo-tools",
                    keyword: "best seo tools",
                    category: "ORPHANED",
                    impressions: 1200,
                    clicks: 45,
                    position: 8.7,
                    inboundInternalLinksCount: 1,
                    evidenceText: "Orphaned page",
                },
                {
                    url: "/blog/seo-tools",
                    keyword: "best seo tools",
                    category: "QUICK_WIN",
                    impressions: 1200,
                    clicks: 45,
                    position: 8.7,
                    inboundInternalLinksCount: 1,
                    evidenceText: "Quick win striking distance",
                },
            ];

            const consolidated = consolidateOpportunities(rawSignals);

            expect(consolidated).toHaveLength(1);
            expect(consolidated[0].url).toBe("/blog/seo-tools");
            expect(consolidated[0].primaryCategory).toBe("QUICK_WIN"); // QUICK_WIN has higher priority than STALE/ORPHANED
            expect(consolidated[0].categories).toEqual(["QUICK_WIN", "STALE", "ORPHANED"]);
        });
    });

    describe("SERP Consensus Profiler (analyzeSerpConsensus)", () => {
        it("should calculate SERP consensus distribution and depth requirements", () => {
            const intel = analyzeSerpConsensus("best aeo software", {
                keyword: "best aeo software",
                results: [
                    { title: "Top 10 Best AEO Software Comparison", link: "https://example.com/1", snippet: "Comparison of top tools" },
                    { title: "Best AEO Software vs Alternatives", link: "https://example.com/2", snippet: "VS review" },
                    { title: "AEO Calculator Tool", link: "https://example.com/3", snippet: "Calculate your score" },
                ],
                peopleAlsoAsk: [],
                featuredSnippet: null,
                relatedSearches: [],
                formattedContext: "",
            });


            expect(intel.keyword).toBe("best aeo software");
            expect(intel.serpConsensus).toBeDefined();
            expect(intel.serpConsensus?.dominantType).toBe("COMPARISON_PAGE");
            expect(intel.serpConsensus?.confidence).toBeGreaterThanOrEqual(60);
        });
    });

    describe("Decision Ranker & Scoring (rankGrowthDecisions)", () => {
        it("should compute explainable bounded 0-100 scores and deterministic whyNow signals", () => {
            const consolidated = consolidateOpportunities([
                {
                    url: "/blog/semrush-alt",
                    keyword: "semrush alternative",
                    category: "QUICK_WIN",
                    impressions: 3400,
                    clicks: 120,
                    position: 7.2,
                    previousPosition: 4.8,
                    inboundInternalLinksCount: 1,
                    evidenceText: "Position dropped",
                },
            ]);

            const decisions = rankGrowthDecisions("site-123", consolidated);

            expect(decisions).toHaveLength(1);
            const decision = decisions[0];

            expect(decision.url).toBe("/blog/semrush-alt");
            expect(decision.score.final).toBeGreaterThan(0);
            expect(decision.score.final).toBeLessThanOrEqual(100);
            expect(decision.score.components).toBeDefined();
            expect(decision.whyNow.signals.some(s => s.signal === "POSITION_DECLINE")).toBe(true);
            expect(decision.executionPlan.length).toBeGreaterThan(0);
        });
    });
});
