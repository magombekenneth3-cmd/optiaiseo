export type Tier = "FREE" | "STARTER" | "PRO" | "AGENCY"

export const PLANS = {
    FREE: {
        name: "Free",
        tier: "FREE" as Tier,
        priceId: null as string | null,
        price: 0,
        limits: {
            sites: 1,
            auditsPerMonth: 5,
            blogsPerMonth: 3,
            aeoAuditsPerMonth: 3,
            keywordsTracked: 10,
            competitorsPerSite: 0,
        },
        features: {
            gsc: true,
            ahrefs: false,
            ubersuggest: false,
            onPage: false,
            rankTracking: false,
            backlinks: false,
            competitor: false,
            emailReports: false,
            whiteLabel: false,
            clientPortal: false,
            developerApi: false,
        },
        monthlyCredits: 50,
    },

    STARTER: {
        name: "Starter",
        tier: "STARTER" as Tier,
        priceId:       process.env.STRIPE_STARTER_PRICE_ID        ?? null,
        annualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID ?? null,
        price: { monthly: 19, annual: 15 },
        limits: {
            sites: 3,
            auditsPerMonth: 15,
            blogsPerMonth: 30,
            aeoAuditsPerMonth: 10,
            keywordsTracked: 100,
            competitorsPerSite: 2,
        },
        features: {
            gsc: true,
            ahrefs: false,
            ubersuggest: true,
            onPage: true,
            rankTracking: true,
            backlinks: false,
            competitor: true,
            emailReports: true,
            whiteLabel: false,
            clientPortal: false,
            developerApi: false,
        },
        monthlyCredits: 150,
    },

    PRO: {
        name: "Pro",
        tier: "PRO" as Tier,
        priceId:       process.env.STRIPE_PRO_PRICE_ID        ?? null,
        annualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? null,
        price: { monthly: 49, annual: 39 },
        limits: {
            sites: 10,
            auditsPerMonth: 50,
            blogsPerMonth: 300,
            aeoAuditsPerMonth: 50,
            keywordsTracked: 1000,
            competitorsPerSite: 10,
        },
        features: {
            gsc: true,
            ahrefs: true,
            ubersuggest: true,
            onPage: true,
            rankTracking: true,
            backlinks: true,
            competitor: true,
            emailReports: true,
            whiteLabel: false,
            clientPortal: false,
            developerApi: true,
        },
        monthlyCredits: 500,
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
            ahrefs: true,
            ubersuggest: true,
            onPage: true,
            rankTracking: true,
            backlinks: true,
            competitor: true,
            emailReports: true,
            whiteLabel: true,
            clientPortal: true,
            developerApi: true,
        },
        monthlyCredits: 2000,
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

export function withinLimit(tier: string, limitKey: LimitKey, currentUsage: number): boolean {
    const limit = getPlan(tier).limits[limitKey]
    return limit === -1 || currentUsage < limit
}

export function displayLimit(tier: string, limitKey: LimitKey): string {
    const limit = getPlan(tier).limits[limitKey]
    return limit === -1 ? "Unlimited" : String(limit)
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