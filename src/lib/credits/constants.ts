/**
 * src/lib/credits/constants.ts
 *
 * Pure client-safe credit constants — NO Prisma, NO server imports.
 * Import from here in any "use client" component.
 *
 * Server-side logic (consumeCredits, resetMonthlyCredits, etc.)
 * lives in credits/index.ts which may only be imported from server code.
 */

export const CREDIT_COSTS = {
    quick_seo_check:     0,   // Acquisition — always free
    full_site_audit:    10,   // Compute-heavy
    aeo_check:           5,   // Multiple API calls
    blog_generation:    10,   // Long-form — reduced from 15 so free users get 5 blogs/month
    competitor_analysis: 8,   // External API calls
    github_pr_fix:       3,   // Low compute
    voice_session:       2,   // Per 30 min, LiveKit cost
    citation_gap_check:  8,   // AEO citation gap analysis
    repurpose_format:    3,   // Content repurposing
    serp_gap_analysis:   5,   // SERP gap + implementation plan
    serp_analysis:       5,   // Keyword vs SERP analysis panel
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export const ACTION_LABELS: Record<CreditAction, string> = {
    quick_seo_check:     "Quick SEO Check",
    full_site_audit:     "Full Site Audit",
    aeo_check:           "AEO Check",
    blog_generation:     "Blog Generation",
    competitor_analysis: "Competitor Analysis",
    github_pr_fix:       "GitHub Auto-fix",
    voice_session:       "Voice Session",
    citation_gap_check:  "Citation Gap Check",
    repurpose_format:    "Content Repurpose",
    serp_gap_analysis:   "SERP Gap Analysis",
    serp_analysis:       "Keyword SERP Analysis",
};

export const FREE_MONTHLY_CREDITS    =   50;
export const STARTER_MONTHLY_CREDITS =  150;
export const PRO_MONTHLY_CREDITS     =  500;
export const AGENCY_MONTHLY_CREDITS  = 2000;

export function monthlyCreditsForTier(tier: string): number {
    switch (tier) {
        case "STARTER": return STARTER_MONTHLY_CREDITS;
        case "PRO":     return PRO_MONTHLY_CREDITS;
        case "AGENCY":  return AGENCY_MONTHLY_CREDITS;
        default:        return FREE_MONTHLY_CREDITS;
    }
}
