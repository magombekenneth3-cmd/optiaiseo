import { GrowthAction } from "@/lib/opportunity-engine/types";

export interface DateRange {
    start: string;
    end: string;
}

export interface MetricSnapshot {
    clicks: number;
    impressions: number;
    position: number;
    conversions: number;
}

export interface AttributedOutcome {
    decisionId: string;
    siteId: string;
    actionType: GrowthAction;
    baselineWindow: DateRange;
    observationWindow: DateRange;
    rawTrafficDeltaPct: number;
    rawRankingDelta: number;
    seasonalityAdjustmentPct: number;
    algorithmUpdateAdjustmentPct: number;
    attributedTrafficDeltaPct: number;
    attributionConfidence: number; // 0.0 - 1.0
    outcome: "WIN" | "NEUTRAL" | "LOSS" | "INCONCLUSIVE";
}

/**
 * Calculates attributed outcome for a specific intervention.
 * Enforces strict attribution confidence scoring and tag INCONCLUSIVE if confidence < 0.60.
 */
export function attributeFixOutcome(
    decisionId: string,
    siteId: string,
    actionType: GrowthAction,
    baseline: MetricSnapshot,
    observed: MetricSnapshot,
    baselineWindow: DateRange,
    observationWindow: DateRange,
    options?: {
        seasonalityFactorPct?: number; // e.g. +5% for Q4 holiday uplift
        googleAlgUpdateActive?: boolean; // true if core update occurred during window
        controlGroupTrafficDeltaPct?: number; // delta on unfixed pages
    }
): AttributedOutcome {
    const seasonalityAdjustmentPct = options?.seasonalityFactorPct ?? 0;
    const algorithmUpdateAdjustmentPct = options?.googleAlgUpdateActive ? -15 : 0;
    const controlGroupDeltaPct = options?.controlGroupTrafficDeltaPct ?? 0;

    // 1. Raw Traffic & Ranking Deltas
    const rawTrafficDeltaPct = baseline.clicks > 0
        ? Math.round(((observed.clicks - baseline.clicks) / baseline.clicks) * 100)
        : observed.clicks > 0 ? 100 : 0;

    const rawRankingDelta = Number((baseline.position - observed.position).toFixed(1)); // positive means position improved (e.g. #8 -> #4 = +4)

    // 2. Net Attributed Traffic Delta (subtracting control group & seasonality)
    const netTrafficDeltaPct = Math.round(
        rawTrafficDeltaPct - seasonalityAdjustmentPct - algorithmUpdateAdjustmentPct - controlGroupDeltaPct
    );

    // 3. Attribution Confidence Calculation (0.0 - 1.0)
    let attributionConfidence = 0.85; // Base confidence for clean observation window

    if (options?.googleAlgUpdateActive) {
        attributionConfidence -= 0.35; // Severe penalty for core algorithm update overlap
    }
    if (Math.abs(seasonalityAdjustmentPct) > 10) {
        attributionConfidence -= 0.15; // Penalty for high seasonal volatility
    }
    if (baseline.clicks < 30) {
        attributionConfidence -= 0.20; // Penalty for low baseline traffic sample size
    }

    attributionConfidence = Number(Math.max(0.0, Math.min(1.0, attributionConfidence)).toFixed(2));

    // 4. Outcome Categorization
    let outcome: "WIN" | "NEUTRAL" | "LOSS" | "INCONCLUSIVE" = "NEUTRAL";

    if (attributionConfidence < 0.60) {
        outcome = "INCONCLUSIVE"; // High confounder uncertainty
    } else if (netTrafficDeltaPct >= 10 || rawRankingDelta >= 2.0) {
        outcome = "WIN";
    } else if (netTrafficDeltaPct <= -10 || rawRankingDelta <= -2.0) {
        outcome = "LOSS";
    }

    return {
        decisionId,
        siteId,
        actionType,
        baselineWindow,
        observationWindow,
        rawTrafficDeltaPct,
        rawRankingDelta,
        seasonalityAdjustmentPct,
        algorithmUpdateAdjustmentPct,
        attributedTrafficDeltaPct: netTrafficDeltaPct,
        attributionConfidence,
        outcome,
    };
}
