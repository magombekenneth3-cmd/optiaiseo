/**
 * scoring/confidence.ts — Audit confidence computation.
 *
 * Measures how reliable the overall audit result is, based on how many
 * AI providers responded successfully. A high confidence means we heard
 * from most engines; low confidence means several providers failed and
 * the score may not be representative.
 *
 * Confidence feeds into:
 * - UI badges ("High confidence" / "Low confidence — some providers unavailable")
 * - Snapshot persistence (so historical trends can filter by confidence)
 * - Future: weighted scoring where low-confidence dimensions carry less weight
 */

import type { AeoConfidence } from "../index";
import type { MentionResult } from "../multi-model";

/**
 * Computes audit confidence from the multi-model results.
 *
 * A provider counts as "successful" if it returned SUCCESS or NO_RESULT
 * (meaning the API responded but didn't mention the brand — that's still
 * valid data). Only PROVIDER_ERROR is a failure.
 *
 * @param results       - Array of MentionResult from auditMultiModelMentions
 * @param queryCount    - Number of distinct queries run (will increase with Phase 4)
 */
export function computeAuditConfidence(
    results: MentionResult[],
    queryCount = 1
): AeoConfidence {
    const total = results.length;
    const successful = results.filter(
        (r) =>
            r.providerStatus === "SUCCESS" || r.providerStatus === "NO_RESULT"
    ).length;

    const score = total > 0 ? Math.round((successful / total) * 100) : 0;

    return {
        level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
        score,
        successfulProviders: successful,
        totalProviders: total,
        successfulQueries: queryCount,
        totalQueries: queryCount,
    };
}

/**
 * Returns a human-readable confidence label for UI display.
 */
export function confidenceLabel(confidence: AeoConfidence): string {
    switch (confidence.level) {
        case "high":
            return `High confidence (${confidence.successfulProviders}/${confidence.totalProviders} engines responded)`;
        case "medium":
            return `Medium confidence (${confidence.successfulProviders}/${confidence.totalProviders} engines responded)`;
        case "low":
            return `Low confidence (${confidence.successfulProviders}/${confidence.totalProviders} engines responded) — results may not be representative`;
    }
}

/**
 * Returns true if the audit confidence is high enough to trigger alerts.
 * We don't want to send score-drop emails when the score is unreliable
 * because half the providers were down.
 */
export function isConfidenceSufficientForAlerts(
    confidence: AeoConfidence
): boolean {
    return confidence.level !== "low" && confidence.successfulProviders >= 2;
}
