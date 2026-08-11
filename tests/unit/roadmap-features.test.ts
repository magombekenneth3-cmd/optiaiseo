import { describe, it, expect } from "vitest";
import React from "react";

import { ExecutionProgressStepper } from "@/components/dashboard/ExecutionProgressStepper";
import { findBestInternalLinkMatch, computeSimpleTextSimilarity } from "@/lib/growth/vector-linker";
import { dispatchWhiteLabelExecutiveDigest } from "@/lib/agency/email-dispatcher";

describe("Roadmap Feature Enhancements Unit Tests", () => {
    it("should instantiate ExecutionProgressStepper component", () => {
        const el = React.createElement(ExecutionProgressStepper, {
            currentPhase: 2,
            phaseTitle: "Injecting FAQ Schema",
            details: "Processing canonical & FAQPage schema...",
        });
        expect(el).toBeDefined();
        expect(el.props.currentPhase).toBe(2);
    });

    it("should compute text similarity correctly", () => {
        const score = computeSimpleTextSimilarity("best saas tools 2026", "top saas software tools");
        expect(score).toBeGreaterThan(0);
    });

    it("should find best internal link candidate match", () => {
        const target = { id: "b1", title: "Guide to AI SEO", slug: "guide-ai-seo", content: "..." };
        const candidates = [
            { id: "b2", title: "Top Generative AI SEO Software", slug: "top-ai-seo-software", content: "..." },
            { id: "b3", title: "Unrelated Cooking Recipes", slug: "cooking-recipes", content: "..." },
        ];

        const match = findBestInternalLinkMatch(target, candidates, "AI SEO");
        expect(match).not.toBeNull();
        expect(match?.sourceBlogId).toBe("b2");
        expect(match?.targetUrl).toBe("/blog/guide-ai-seo");
    });

    it("should dispatch white-label executive email digest cleanly", async () => {
        const res = await dispatchWhiteLabelExecutiveDigest({
            recipientEmail: "client@test.com",
            clientSiteName: "Test Client",
            agencyName: "Apex Agency",
            customDomain: "seo.apex.com",
            pdfBufferLength: 8500,
        });

        expect(res).toBeDefined();
        expect(res.success).toBe(true);
    });
});
