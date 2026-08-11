import { GrowthAction } from "@/lib/opportunity-engine/types";

export interface InterventionEvidence {
    actionType: GrowthAction;
    siteId: string;
    attempts: number;
    successes: number;
    failures: number;
    inconclusive: number;
    medianTrafficDeltaPct: number;
    medianRankingDelta: number;
    medianTimeToEffectDays: number;
    confidenceInterval95: [number, number];
    lastObservedAt: string;
}

export interface CalibrationResult {
    calibratedConfidence: number; // 0–100 scale
    evidenceTier: "NONE" | "WEAK" | "MEANINGFUL" | "STRONG";
    evidenceWeight: number; // 0.0 - 1.0
    winRate: number; // 0.0 - 1.0
}

/**
 * Calculates sample-weighted empirical confidence for an intervention type.
 * 
 * Sample Size Tier Policy:
 * - N < 5   : NONE (weight = 0.10, fall back to baseline heuristic)
 * - 5 <= N < 20 : WEAK (weight = 0.40)
 * - 20 <= N < 50: MEANINGFUL (weight = 0.75)
 * - N >= 50 : STRONG (weight = 1.00)
 */
export function calculateSampleWeightedConfidence(
    baseConfidence: number, // 0-100 heuristic baseline
    evidence: InterventionEvidence | null,
    dataQuality = 1.0 // 0.0 - 1.0 data freshness/integrity multiplier
): CalibrationResult {
    if (!evidence || evidence.attempts === 0) {
        return {
            calibratedConfidence: Math.round(baseConfidence * dataQuality),
            evidenceTier: "NONE",
            evidenceWeight: 0.10,
            winRate: 0.0,
        };
    }

    const { attempts, successes } = evidence;
    const winRate = Number((successes / attempts).toFixed(2));

    let evidenceTier: "NONE" | "WEAK" | "MEANINGFUL" | "STRONG" = "NONE";
    let evidenceWeight = 0.10;

    if (attempts >= 50) {
        evidenceTier = "STRONG";
        evidenceWeight = 1.00;
    } else if (attempts >= 20) {
        evidenceTier = "MEANINGFUL";
        evidenceWeight = 0.75;
    } else if (attempts >= 5) {
        evidenceTier = "WEAK";
        evidenceWeight = 0.40;
    }

    // Blend static baseline confidence with empirical win rate based on evidenceWeight
    const empiricalConfidence = winRate * 100;
    const blendedConfidence = baseConfidence * (1 - evidenceWeight) + empiricalConfidence * evidenceWeight;
    const calibratedConfidence = Math.round(Math.max(1, Math.min(100, blendedConfidence * dataQuality)));

    return {
        calibratedConfidence,
        evidenceTier,
        evidenceWeight,
        winRate,
    };
}
