import {
    ConsolidatedOpportunity,
    GrowthDecision,
    GrowthAction,
    ExplainableScore,
    DeterministicWhyNowSignal,
    OpportunityIntelligence
} from "./types";
import { buildExecutionPlan } from "@/lib/growth/execution-planner";

export function rankGrowthDecisions(
    siteId: string,
    consolidated: ConsolidatedOpportunity[],
    intelligenceMap: Map<string, OpportunityIntelligence> = new Map()
): GrowthDecision[] {
    const decisions: GrowthDecision[] = [];

    for (const opp of consolidated) {
        const intel = intelligenceMap.get(opp.keyword);

        // 1. Component Scores (All 0–100 scale)
        const rankingOpp = opp.position >= 4 && opp.position <= 15 ? 90 : opp.position >= 16 ? 60 : 40;
        const trafficOpp = Math.min(100, Math.round((opp.impressions / 2000) * 100));
        const intentAlignment = intel?.intentAlignment ?? 80;
        const businessValue = intel?.commercialValueScore ?? 75;
        const freshnessOpp = opp.categories.includes("STALE") ? 95 : 40;
        const linkOpp = opp.inboundInternalLinksCount < 2 ? 85 : 20;

        const impact = Math.round((rankingOpp + trafficOpp) / 2);
        const confidence = 88; // 0-100 scale
        const effort = opp.categories.includes("STALE") ? 35 : 20;

        // Normalized weighted formula (0-100 scale)
        const weightedScore = (
            impact * 0.25 +
            confidence * 0.20 +
            trafficOpp * 0.20 +
            businessValue * 0.20 +
            intentAlignment * 0.10 +
            freshnessOpp * 0.05
        );

        const finalScore = Math.round(Math.min(100, Math.max(1, weightedScore)));

        const score: ExplainableScore = {
            final: finalScore,
            impact,
            confidence,
            trafficPotential: trafficOpp,
            businessValue,
            effort,
            components: {
                rankingOpportunity: rankingOpp,
                trafficOpportunity: trafficOpp,
                intentAlignment,
                businessAlignment: businessValue,
                freshness: freshnessOpp,
                internalLinkOpportunity: linkOpp,
            }
        };

        // 2. Action Mapping based on all evidence
        let action: GrowthAction = "REFRESH_CONTENT";
        if (opp.categories.includes("CANNIBALIZATION")) {
            action = "CONSOLIDATE_CONTENT";
        } else if (opp.categories.includes("ORPHANED") && !opp.categories.includes("STALE") && !opp.categories.includes("DECLINING")) {
            action = "BUILD_INTERNAL_LINKS";
        } else if (intel?.serpConsensus && intel.serpConsensus.confidence >= 70 && intel.serpConsensus.dominantType === "INTERACTIVE_TOOL") {
            action = "IMPROVE_SEARCH_INTENT";
        }

        // 3. Deterministic whyNow Signal Triggers
        const whyNowSignals: DeterministicWhyNowSignal[] = [];

        if (opp.previousPosition && opp.position - opp.previousPosition >= 2) {
            whyNowSignals.push({
                signal: "POSITION_DECLINE",
                severity: "HIGH",
                evidence: `Average position declined from ${opp.previousPosition.toFixed(1)} to ${opp.position.toFixed(1)}.`
            });
        }

        if (opp.previousClicks && opp.clicks < opp.previousClicks * 0.7) {
            whyNowSignals.push({
                signal: "TRAFFIC_LOSS",
                severity: "HIGH",
                evidence: `Clicks dropped from ${opp.previousClicks} to ${opp.clicks}.`
            });
        }

        if (opp.position >= 4 && opp.position <= 15 && opp.impressions >= 500) {
            whyNowSignals.push({
                signal: "HIGH_IMPRESSION_STRIKING_DISTANCE",
                severity: "HIGH",
                evidence: `${opp.impressions.toLocaleString()} impressions at position ${opp.position.toFixed(1)}.`
            });
        }

        if (opp.categories.includes("STALE")) {
            whyNowSignals.push({
                signal: "STALE_CONTENT",
                severity: "MEDIUM",
                evidence: "Article has not been updated in over 180 days."
            });
        }

        if (opp.inboundInternalLinksCount < 2) {
            whyNowSignals.push({
                signal: "LOW_INTERNAL_LINK_DENSITY",
                severity: "MEDIUM",
                evidence: `Only ${opp.inboundInternalLinksCount} internal link points to this URL.`
            });
        }

        const executionPlan = buildExecutionPlan(action, opp, intel);

        decisions.push({
            id: `dec:${siteId}:${encodeURIComponent(opp.url)}`,
            siteId,
            url: opp.url,
            primaryKeyword: opp.keyword,
            primaryCategory: opp.primaryCategory,
            opportunityCategories: opp.categories,
            action,
            score,
            whyNow: {
                signals: whyNowSignals,
                urgency: whyNowSignals.some(s => s.severity === "HIGH") ? "HIGH" : "MEDIUM"
            },
            impact: {
                trafficPotential: {
                    low: Math.round(opp.impressions * 0.04),
                    expected: Math.round(opp.impressions * 0.12),
                    high: Math.round(opp.impressions * 0.22),
                    confidence: 85
                }
            },
            executionPlan
        });
    }

    return decisions.sort((a, b) => b.score.final - a.score.final);
}
