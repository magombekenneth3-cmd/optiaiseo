/**
 * Shared helpers for extracting typed metrics from audit records.
 * Eliminates duplicate `as any` extraction logic spread across pages.
 */

export interface AuditMetrics {
    seoScore: number;
    issueCount: number;
}

export interface AuditRecord {
    categoryScores: Record<string, unknown> | null;
    issueList: unknown;
}

/**
 * Extracts the SEO score and issue count from a raw audit DB record.
 * Handles legacy schemas where the score may be stored differently.
 */
export function extractAuditMetrics(audit: AuditRecord): AuditMetrics {
    const scores = audit.categoryScores as Record<string, unknown> | null;
    const issueList = audit.issueList as Record<string, unknown> | null;

    let issueCount = 0;
    if (Array.isArray(audit.issueList)) {
        issueCount = (audit.issueList as unknown[]).length;
    } else if (issueList && Array.isArray(issueList.recommendations)) {
        issueCount = (issueList.recommendations as unknown[]).length;
    }

    // Priority 1: explicit `seo` key in categoryScores
    let seoScore = typeof scores?.seo === "number" ? (scores.seo as number) : null;

    if (seoScore === null) {
        // Priority 2: overallScore stored on the issueList object
        if (issueList && typeof issueList.overallScore === "number") {
            seoScore = issueList.overallScore as number;
        } else if (scores && Object.keys(scores).length > 0) {
            // Priority 3: average of all numeric category scores
            const vals = Object.values(scores).filter(
                (v): v is number => typeof v === "number"
            );
            if (vals.length > 0) {
                seoScore = Math.round(vals.reduce((sum, v) => sum + v, 0) / vals.length);
            }
        }
    }

    return {
        seoScore: seoScore ?? 0,
        issueCount,
    };
}
