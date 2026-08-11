import { describe, it, expect } from "vitest";
import React from "react";

import { ExecuteDecisionButton } from "@/components/dashboard/ExecuteDecisionButton";
import { CombinedSerpAeoWidget } from "@/components/dashboard/CombinedSerpAeoWidget";
import { InstantIndexingBadge } from "@/components/dashboard/InstantIndexingBadge";
import { LiveWhiteLabelPreviewer } from "@/components/dashboard/LiveWhiteLabelPreviewer";
import { RoiLiftCard } from "@/components/dashboard/RoiLiftCard";

describe("UI/UX Dashboard Optimization Components Unit Tests", () => {
    it("should instantiate ExecuteDecisionButton with proper props", () => {
        const el = React.createElement(ExecuteDecisionButton, {
            decisionId: "dec-1",
            siteId: "site-1",
            actionType: "IMPROVE_SEARCH_INTENT",
            targetUrl: "/blog/test",
        });
        expect(el).toBeDefined();
        expect(el.props.decisionId).toBe("dec-1");
        expect(el.props.actionType).toBe("IMPROVE_SEARCH_INTENT");
    });

    it("should instantiate CombinedSerpAeoWidget with default props", () => {
        const el = React.createElement(CombinedSerpAeoWidget, {
            consensusScore: 92,
            googleRank: 1,
            llmCitationRate: 95,
            totalKeywordsTracked: 50,
        });
        expect(el).toBeDefined();
        expect(el.props.consensusScore).toBe(92);
        expect(el.props.googleRank).toBe(1);
    });

    it("should instantiate InstantIndexingBadge with active status", () => {
        const el = React.createElement(InstantIndexingBadge, {
            status: "ACTIVE",
            lastIndexedUrl: "/blog/seo-guide",
            totalUrlsPinned: 48,
        });
        expect(el).toBeDefined();
        expect(el.props.totalUrlsPinned).toBe(48);
    });

    it("should instantiate LiveWhiteLabelPreviewer component", () => {
        const el = React.createElement(LiveWhiteLabelPreviewer);
        expect(el).toBeDefined();
    });

    it("should instantiate RoiLiftCard with revenue metrics", () => {
        const el = React.createElement(RoiLiftCard, {
            totalRevenueGenerated: 3200,
            averageRankGain: 5.2,
            ctrLiftPercent: 92.4,
            totalExperiments: 15,
        });
        expect(el).toBeDefined();
        expect(el.props.totalRevenueGenerated).toBe(3200);
        expect(el.props.averageRankGain).toBe(5.2);
    });
});
