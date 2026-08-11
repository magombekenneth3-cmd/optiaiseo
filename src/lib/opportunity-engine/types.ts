export type OpportunityCategory = 
    | "DECLINING"           // Traffic dropped >15% over 90 days
    | "QUICK_WIN"            // Positions 4–15 with high impressions
    | "ALMOST_RANKING"       // Positions 11–20
    | "STALE"                // Not updated in 180+ days
    | "CANNIBALIZATION"      // Multiple pages competing for same intent
    | "ORPHANED"             // <2 internal links in topic cluster
    | "DEAD_WEIGHT";         // 0 traffic over 90 days & 0 referring domains

export type GrowthAction =
    | "REFRESH_CONTENT"
    | "BUILD_INTERNAL_LINKS"
    | "CREATE_NEW_CONTENT"
    | "CONSOLIDATE_CONTENT"
    | "IMPROVE_SEARCH_INTENT"
    | "OPTIMIZE_TITLE"
    | "OPTIMIZE_CONTENT_DEPTH"
    | "DEINDEX_OR_REDIRECT"
    | "MONITOR";

export interface GscPageMetric {
    url: string;
    keyword: string;
    clicks: number;
    impressions: number;
    position: number;
    previousClicks?: number;
    previousImpressions?: number;
    previousPosition?: number;
}

export interface RawOpportunitySignal {
    url: string;
    keyword: string;
    category: OpportunityCategory;
    impressions: number;
    clicks: number;
    position: number;
    previousPosition?: number;
    previousClicks?: number;
    lastUpdated?: Date;
    inboundInternalLinksCount: number;
    evidenceText: string;
}

export interface ConsolidatedOpportunity {
    url: string;
    keyword: string;
    primaryCategory: OpportunityCategory;
    categories: OpportunityCategory[];
    impressions: number;
    clicks: number;
    position: number;
    previousPosition?: number;
    previousClicks?: number;
    lastUpdated?: Date;
    inboundInternalLinksCount: number;
    signals: RawOpportunitySignal[];
}

export interface ExplainableScore {
    final: number; // 0-100 normalized
    impact: number;
    confidence: number; // 0-100 scale
    trafficPotential: number;
    businessValue: number; // 0-100 scale based on commercial intent
    effort: number;
    components: {
        rankingOpportunity: number;
        trafficOpportunity: number;
        intentAlignment: number;
        businessAlignment: number;
        freshness: number;
        internalLinkOpportunity: number;
    };
}

export interface DeterministicWhyNowSignal {
    signal: "POSITION_DECLINE" | "TRAFFIC_LOSS" | "LOW_INTERNAL_LINK_DENSITY" | "STALE_CONTENT" | "HIGH_IMPRESSION_STRIKING_DISTANCE";
    severity: "HIGH" | "MEDIUM" | "LOW";
    evidence: string;
}

export interface SerpConsensus {
    dominantType: "COMPARISON_PAGE" | "PRODUCT_PAGE" | "INTERACTIVE_TOOL" | "DEEP_EXPLAINER";
    confidence: number; // 0-100 scale
    distribution: {
        comparison: number;
        product: number;
        tool: number;
        explainer: number;
    };
    depth: {
        required: "LIGHT" | "MEDIUM" | "DEEP";
    };
    evidence: Array<{
        url: string;
        type: string;
        reason: string;
    }>;
}

export interface OpportunityIntelligence {
    keyword: string;
    serpConsensus?: SerpConsensus;
    intentAlignment: number; // 0-100
    commercialValueScore: number; // 0-100
}

export interface DecisionTraceability {
    decisionId: string;
    siteId: string;
    actionType: GrowthAction;
    rankerVersion: string;
    weightsVersion: string;
    featureSetVersion: string;
    evidenceSnapshotId: string;
    generatedAt: string;
}

export interface GrowthDecision {
    id: string;
    siteId: string;
    url: string;
    primaryKeyword: string;
    primaryCategory: OpportunityCategory;
    opportunityCategories: OpportunityCategory[];
    action: GrowthAction;
    score: ExplainableScore;
    whyNow: {
        signals: DeterministicWhyNowSignal[];
        urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    };
    impact: {
        trafficPotential: { low: number; expected: number; high: number; confidence: number };
    };
    executionPlan: Array<{
        step: number;
        action: string;
        expectedOutcome: string;
    }>;
    traceability: DecisionTraceability;
}
