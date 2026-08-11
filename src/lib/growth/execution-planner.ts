import { GrowthAction, ConsolidatedOpportunity, OpportunityIntelligence } from "@/lib/opportunity-engine/types";

export function buildExecutionPlan(
    action: GrowthAction,
    opp: ConsolidatedOpportunity,
    intelligence?: OpportunityIntelligence
): Array<{ step: number; action: string; expectedOutcome: string }> {
    switch (action) {
        case "REFRESH_CONTENT":
            return [
                { step: 1, action: "Audit and rewrite outdated sections with current 2026 data & insights", expectedOutcome: "Recover lost relevance and freshness score" },
                { step: 2, action: "Inject 2+ primary academic or authoritative external citations", expectedOutcome: "Validate E-E-A-T and LLM citation potential" },
                { step: 3, action: "Resubmit URL via IndexNow / Google Search Console", expectedOutcome: "Accelerate re-indexing" },
            ];

        case "BUILD_INTERNAL_LINKS":
            return [
                { step: 1, action: "Identify top 3 high-authority pillar articles in the same topic cluster", expectedOutcome: "Locate link source opportunities" },
                { step: 2, action: "Run Vector Linker to inject contextual internal links with target anchor text", expectedOutcome: "Elevate internal link density to >= 3" },
            ];

        case "CONSOLIDATE_CONTENT":
            return [
                { step: 1, action: "Identify cannibalizing URLs competing for the same target keyword", expectedOutcome: "Map duplicate intent pages" },
                { step: 2, action: "Select primary canonical page and merge unique content from secondary pages", expectedOutcome: "Create single authoritative pillar" },
                { step: 3, action: "Setup 301 redirects from secondary URLs to primary canonical URL", expectedOutcome: "Consolidate page authority and eliminate cannibalization" },
            ];

        case "IMPROVE_SEARCH_INTENT":
            const dominant = intelligence?.serpConsensus?.dominantType ?? "COMPARISON_PAGE";
            return [
                { step: 1, action: `Restructure page layout to match SERP dominant format (${dominant})`, expectedOutcome: "Eliminate search intent mismatch" },
                { step: 2, action: "Add quick answer card or comparison matrix above the fold", expectedOutcome: "Satisfy NavBoost intent requirements and reduce bounce rate" },
            ];

        case "OPTIMIZE_TITLE":
            return [
                { step: 1, action: "Rewrite Title tag & Meta description to include primary keyword and click hook", expectedOutcome: "Lift CTR to expected SERP baseline" },
            ];

        case "DEINDEX_OR_REDIRECT":
            return [
                { step: 1, action: "Verify page has 0 traffic and 0 referring domains over 90 days", expectedOutcome: "Confirm dead weight status" },
                { step: 2, action: "Apply 301 redirect to primary category hub or add noindex tag", expectedOutcome: "Prune dead pages to elevate sitewide domain authority" },
            ];

        default:
            return [
                { step: 1, action: "Monitor position and CTR performance over next 14 days", expectedOutcome: "Establish baseline trends" },
            ];
    }
}
