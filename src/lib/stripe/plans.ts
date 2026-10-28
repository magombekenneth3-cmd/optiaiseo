export type Tier = "FREE" | "STARTER" | "PRO" | "AGENCY"
import { PUBLIC_PLAN_SUMMARIES } from "@/lib/marketing/plan-summary"

export const PLANS = {
    FREE: {
        name: "Free",
        tier: "FREE" as Tier,
        priceId: null as string | null,
        price: 0,
        limits: {
            sites: PUBLIC_PLAN_SUMMARIES.FREE.limits.sites,
            auditsPerMonth: PUBLIC_PLAN_SUMMARIES.FREE.limits.audits,
            blogsPerMonth: PUBLIC_PLAN_SUMMARIES.FREE.limits.blogs,
            aeoAuditsPerMonth: PUBLIC_PLAN_SUMMARIES.FREE.limits.aeoChecks,
            keywordsTracked: 10,
            competitorsPerSite: 0,
        },
        features: {
            gsc: true,
            measuredKeywordMetrics: false,
            keywordIdeas: false,
            onPage: false,
            rankTracking: false,
            backlinks: false,
            competitor: false,
            emailReports: false,
            whiteLabelReports: false,
            clientPortal: false,
            developerApi: false,
        },
        monthlyCredits: PUBLIC_PLAN_SUMMARIES.FREE.monthlyCredits,
    },

    STARTER: {
        name: "Starter",
        tier: "STARTER" as Tier,
        priceId:       process.env.STRIPE_STARTER_PRICE_ID        ?? null,
        annualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? null,
        price: { monthly: 19, annual: 15 },
        limits: {
            sites: PUBLIC_PLAN_SUMMARIES.STARTER.limits.sites,
            auditsPerMonth: PUBLIC_PLAN_SUMMARIES.STARTER.limits.audits,
            blogsPerMonth: PUBLIC_PLAN_SUMMARIES.STARTER.limits.blogs,
            aeoAuditsPerMonth: PUBLIC_PLAN_SUMMARIES.STARTER.limits.aeoChecks,
            keywordsTracked: 100,
            competitorsPerSite: 2,
        },
        features: {
            gsc: true,
            measuredKeywordMetrics: false,
            keywordIdeas: true,
            onPage: true,
            rankTracking: true,
            backlinks: false,
            competitor: true,
            emailReports: true,
            whiteLabelReports: false,
            clientPortal: false,
            developerApi: false,
        },
        monthlyCredits: PUBLIC_PLAN_SUMMARIES.STARTER.monthlyCredits,
    },

    PRO: {
        name: "Pro",
        tier: "PRO" as Tier,
        priceId:       process.env.STRIPE_PRO_PRICE_ID        ?? null,
        annualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? null,
        price: { monthly: 49, annual: 39 },
        limits: {
            sites: PUBLIC_PLAN_SUMMARIES.PRO.limits.sites,
            auditsPerMonth: PUBLIC_PLAN_SUMMARIES.PRO.limits.audits,
            blogsPerMonth: PUBLIC_PLAN_SUMMARIES.PRO.limits.blogs,
            aeoAuditsPerMonth: PUBLIC_PLAN_SUMMARIES.PRO.limits.aeoChecks,
            keywordsTracked: 1000,
            competitorsPerSite: 10,
        },
        features: {
            gsc: true,
            measuredKeywordMetrics: true,
            keywordIdeas: true,
            onPage: true,
            rankTracking: true,
            backlinks: true,
            competitor: true,
            emailReports: true,
            whiteLabelReports: true,
            clientPortal: false,
            developerApi: true,
        },
        monthlyCredits: PUBLIC_PLAN_SUMMARIES.PRO.monthlyCredits,
    },

    AGENCY: {
        name: "Agency",
        tier: "AGENCY" as Tier,
        priceId:       process.env.STRIPE_AGENCY_PRICE_ID        ?? null,
        annualPriceId: process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID ?? null,
        price: { monthly: 149, annual: 119 },
        limits: {
            sites: -1,
            auditsPerMonth: -1,
            blogsPerMonth: -1,
            aeoAuditsPerMonth: -1,
            keywordsTracked: -1,
            competitorsPerSite: -1,
        },
        features: {
            gsc: true,
            measuredKeywordMetrics: true,
            keywordIdeas: true,
            onPage: true,
            rankTracking: true,
            backlinks: true,
            competitor: true,
            emailReports: true,
            whiteLabelReports: true,
            clientPortal: true,
            developerApi: true,
        },
        monthlyCredits: PUBLIC_PLAN_SUMMARIES.AGENCY.monthlyCredits,
    },
} as const

export const CREDIT_PACK = {
    name: "Credit Pack",
    priceId: process.env.STRIPE_CREDIT_PACK_PRICE_ID ?? null,
    price: 9,
    credits: 50,
} as const

type LimitKey = keyof typeof PLANS.FREE.limits
type FeatureKey = keyof typeof PLANS.FREE.features

export function getPlan(tier: string) {
    return PLANS[tier as Tier] ?? PLANS.FREE
}

export function hasFeature(tier: string, feature: FeatureKey): boolean {
    return getPlan(tier).features[feature]
}

export const AGENCY_FAIR_USE_LIMITS: Record<LimitKey, number> = {
    sites: 100,
    auditsPerMonth: 500,
    blogsPerMonth: 1000,
    aeoAuditsPerMonth: 1000,
    keywordsTracked: 5000,
    competitorsPerSite: 100,
};

export function isFairUseExceeded(tier: string, limitKey: LimitKey, currentUsage: number): boolean {
    if (tier !== "AGENCY") return false;
    const fairUseLimit = AGENCY_FAIR_USE_LIMITS[limitKey];
    return fairUseLimit !== undefined && currentUsage >= fairUseLimit;
}

export function withinLimit(tier: string, limitKey: LimitKey, currentUsage: number): boolean {
    if (isFairUseExceeded(tier, limitKey, currentUsage)) {
        return false;
    }
    const limit = getPlan(tier).limits[limitKey];
    return limit === -1 || currentUsage < limit;
}

export function displayLimit(tier: string, limitKey: LimitKey): string {
    const limit = getPlan(tier).limits[limitKey];
    return limit === -1 ? "Unlimited" : String(limit);
}

export function nextTier(tier: string): Tier | null {
    const progression: Record<string, Tier> = {
        FREE: "STARTER",
        STARTER: "PRO",
        PRO: "AGENCY",
    }
    return progression[tier] ?? null
}

export function isPaidTier(tier: string): boolean {
    return tier === "STARTER" || tier === "PRO" || tier === "AGENCY"
}

export const getFeaturesForTier = (tier?: string | null) => getPlan(tier ?? "FREE")

// canAccessFeature alias removed — use hasFeature() directly
