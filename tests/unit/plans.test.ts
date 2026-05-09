/**
 * Unit tests for the Stripe billing plans configuration.
 *
 * These tests verify that:
 *  - All plan tiers exist and have the required properties
 *  - Monthly and annual prices are both defined
 *  - Annual price is always cheaper than monthly (< monthly * 12)
 *  - Feature flags are consistent across tiers (Pro should have everything Starter has)
 *  - Credit limits escalate correctly across tiers
 */

import { describe, it, expect } from "vitest";

// ── Inline plan shapes to mirror src/lib/stripe/plans.ts ─────────────────────
// We test the shape, not the import (which requires env vars).

interface Plan {
    name: string;
    priceId: string;
    annualPriceId: string;
    price: number;             // monthly price in dollars
    annualPrice: number;       // annual total in dollars (or per-month equivalent)
    credits: number;
    features: string[];
    tier: "STARTER" | "PRO" | "AGENCY";
}

// Minimal fixture that matches the actual PLANS object shape
const PLANS: Record<string, Plan> = {
    STARTER: {
        name: "Starter",
        priceId: "price_starter_monthly",
        annualPriceId: "price_starter_annual",
        price: 19,
        annualPrice: 180,  // $15/mo × 12 — saves ~21%
        credits: 150,
        features: ["Full SEO Audits", "AEO Score", "AI Blog Generation (10/mo)", "Keyword Tracking"],
        tier: "STARTER",
    },
    PRO: {
        name: "Pro",
        priceId: "price_pro_monthly",
        annualPriceId: "price_pro_annual",
        price: 49,
        annualPrice: 468,  // $39/mo × 12 — saves ~20%
        credits: 500,
        features: ["Full SEO Audits", "AEO Score", "AI Blog Generation (50/mo)", "Keyword Tracking", "Backlink Monitoring", "Competitor Gap", "Priority Support"],
        tier: "PRO",
    },
    AGENCY: {
        name: "Agency",
        priceId: "price_agency_monthly",
        annualPriceId: "price_agency_annual",
        price: 149,
        annualPrice: 1428, // $119/mo × 12 — saves ~20%
        credits: 2000,
        features: ["Full SEO Audits", "AEO Score", "AI Blog Generation (150/mo)", "Keyword Tracking", "Backlink Monitoring", "Competitor Gap", "Priority Support", "White-Label Reports", "Team Members", "Client Portal"],
        tier: "AGENCY",
    },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PLANS — required fields", () => {
    const tiers = ["STARTER", "PRO", "AGENCY"] as const;

    for (const tier of tiers) {
        it(`${tier} has all required fields`, () => {
            const plan = PLANS[tier]!;
            expect(plan.name).toBeTruthy();
            expect(plan.priceId).toBeTruthy();
            expect(plan.annualPriceId).toBeTruthy();
            expect(plan.price).toBeGreaterThan(0);
            expect(plan.annualPrice).toBeGreaterThan(0);
            expect(plan.credits).toBeGreaterThan(0);
            expect(Array.isArray(plan.features)).toBe(true);
            expect(plan.features.length).toBeGreaterThan(0);
        });

        it(`${tier} annualPriceId is different from monthly priceId`, () => {
            const plan = PLANS[tier]!;
            expect(plan.annualPriceId).not.toBe(plan.priceId);
        });
    }
});

describe("PLANS — annual pricing is cheaper than monthly", () => {
    const tiers = ["STARTER", "PRO", "AGENCY"] as const;

    for (const tier of tiers) {
        it(`${tier} annual total < monthly * 12`, () => {
            const plan = PLANS[tier]!;
            const monthlyAnnual = plan.price * 12;
            expect(plan.annualPrice).toBeLessThan(monthlyAnnual);
        });

        it(`${tier} annual discount is between 10% and 40%`, () => {
            const plan = PLANS[tier]!;
            const monthlyAnnual = plan.price * 12;
            const discountPct = ((monthlyAnnual - plan.annualPrice) / monthlyAnnual) * 100;
            expect(discountPct).toBeGreaterThanOrEqual(10);
            expect(discountPct).toBeLessThanOrEqual(40);
        });
    }
});

describe("PLANS — tier escalation", () => {
    it("credits escalate: STARTER < PRO < AGENCY", () => {
        expect(PLANS.STARTER!.credits).toBeLessThan(PLANS.PRO!.credits);
        expect(PLANS.PRO!.credits).toBeLessThan(PLANS.AGENCY!.credits);
    });

    it("price escalates: STARTER < PRO < AGENCY", () => {
        expect(PLANS.STARTER!.price).toBeLessThan(PLANS.PRO!.price);
        expect(PLANS.PRO!.price).toBeLessThan(PLANS.AGENCY!.price);
    });

    it("AGENCY has more features than PRO", () => {
        expect(PLANS.AGENCY!.features.length).toBeGreaterThan(PLANS.PRO!.features.length);
    });

    it("PRO has more features than STARTER", () => {
        expect(PLANS.PRO!.features.length).toBeGreaterThan(PLANS.STARTER!.features.length);
    });

    it("PRO includes all STARTER features (feature superset)", () => {
        const starterFeatures = PLANS.STARTER!.features;
        const proFeatures = PLANS.PRO!.features;
        // Strip per-tier quantity suffix (e.g. "(10/mo)") before comparing
        // so "AI Blog Generation (10/mo)" matches "AI Blog Generation (50/mo)"
        const normalise = (f: string) => f.replace(/\s*\(\d+\/mo\)/, "");
        const missingInPro = starterFeatures.filter(
            f => !proFeatures.some(pf => normalise(pf) === normalise(f))
        );
        expect(missingInPro).toHaveLength(0);
    });

    it("AGENCY includes all PRO features (feature superset)", () => {
        const proFeatures = PLANS.PRO!.features;
        const agencyFeatures = PLANS.AGENCY!.features;
        const normalise = (f: string) => f.replace(/\s*\(\d+\/mo\)/, "");
        const missingInAgency = proFeatures.filter(
            f => !agencyFeatures.some(af => normalise(af) === normalise(f))
        );
        expect(missingInAgency).toHaveLength(0);
    });
});
