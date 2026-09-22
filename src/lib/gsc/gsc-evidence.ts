/**
 * GSC opportunity evidence — immutable provenance snapshot.
 *
 * This module defines the structured evidence that must accompany any
 * autonomous blog generation decision based on GSC data. The evidence
 * object is:
 *
 * 1. Validated via Zod before persisting (no raw JSON casts)
 * 2. Stored as Blog.gscEvidence (Json?) for forensic traceability
 * 3. Self-describing: includes sourceStatus and generationId
 *
 * Invariant: a GSC_GAP blog must have a non-null, validated gscEvidence.
 * Non-GSC pipelines (USER_KEYWORD, COMPETITOR_GAP, INDUSTRY) have null.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export const GscOpportunityEvidenceSchema = z.object({
    /** Ties this evidence to the specific blog generation operation. */
    generationId: z.string().min(1),

    /** Application site identity (stable across property format changes). */
    siteId: z.string().min(1),

    /** GSC property URL used for the API query (e.g. "https://example.com/" or "sc-domain:example.com"). */
    property: z.string().min(1),

    /** Confirms the GSC data was actually available when captured. */
    sourceStatus: z.literal("AVAILABLE"),

    /** The keyword/query that was identified as an opportunity. */
    query: z.string().min(1),

    /** The existing page URL ranking for this query (if any). */
    url: z.string().optional(),

    /** The exact GSC date range used to produce this observation. */
    dateRange: z.object({
        startDate: z.string().min(8), // YYYY-MM-DD
        endDate: z.string().min(8),
    }),

    /** Average position for this query in the observed period. */
    position: z.number(),

    /** Total impressions for this query in the observed period. */
    impressions: z.number().int().nonnegative(),

    /** Total clicks for this query in the observed period. */
    clicks: z.number().int().nonnegative(),

    /** Click-through rate as a percentage (0-100). */
    ctr: z.number().nonnegative(),

    /** Expected CTR for this position/intent (if computed). */
    expectedCtr: z.number().nonnegative().optional(),

    /** Composite opportunity score from findOpportunities(). */
    opportunityScore: z.number(),

    /** Classification: "quick-win", "new-content", "ctr-optimize", "ranking-optimize". */
    opportunityType: z.string().min(1),

    /** Human-readable explanation of why this is an opportunity. */
    reason: z.string().min(1),

    /** ISO timestamp of when the evidence was captured. */
    capturedAt: z.string().min(1),
});

export type GscOpportunityEvidence = z.infer<typeof GscOpportunityEvidenceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate and parse a GSC opportunity evidence object.
 *
 * Returns the validated evidence, or null if validation fails.
 * Logs a warning on failure — the caller should decide whether
 * to proceed without evidence or abort.
 */
export function validateGscEvidence(
    raw: unknown,
    context?: string,
): GscOpportunityEvidence | null {
    const result = GscOpportunityEvidenceSchema.safeParse(raw);
    if (result.success) {
        return result.data;
    }

    // Import logger lazily to avoid circular deps
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logger } = require("@/lib/logger");
        logger.warn(`[GscEvidence] Validation failed${context ? ` (${context})` : ""}`, {
            errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
    } catch {
        // Swallow — logging is best-effort during validation
    }

    return null;
}
