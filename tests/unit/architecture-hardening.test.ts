import { describe, it, expect, vi } from "vitest";
import { assertSiteAccess } from "@/lib/auth/require-user";
import { JobBudgetTracker, BudgetExceededError } from "@/lib/guardrails/budget";

describe("Architecture Hardening Unit Tests", () => {
    describe("Site Permission Guard (assertSiteAccess)", () => {
        it("should return null for invalid siteId format", async () => {
            const result = await assertSiteAccess("", "user-123", "VIEW");
            expect(result).toBeNull();
        });

        it("should return null for excessively long siteId", async () => {
            const longId = "a".repeat(51);
            const result = await assertSiteAccess(longId, "user-123", "VIEW");
            expect(result).toBeNull();
        });
    });

    describe("AI Job Budget Controller (JobBudgetTracker)", () => {
        it("should allow calls within budget limit", () => {
            const tracker = new JobBudgetTracker({
                maxCredits: 10,
                maxLlmCalls: 2,
                maxSearchCalls: 5,
                maxRuntimeMs: 10000,
            });

            expect(() => tracker.recordLlmCall()).not.toThrow();
            expect(() => tracker.recordSearchCall()).not.toThrow();
        });

        it("should throw BudgetExceededError when LLM calls exceed budget limit", () => {
            const tracker = new JobBudgetTracker({
                maxCredits: 10,
                maxLlmCalls: 1,
                maxSearchCalls: 5,
                maxRuntimeMs: 10000,
            });

            tracker.recordLlmCall();
            expect(() => tracker.recordLlmCall()).toThrow(BudgetExceededError);
        });

        it("should throw BudgetExceededError when search calls exceed budget limit", () => {
            const tracker = new JobBudgetTracker({
                maxCredits: 10,
                maxLlmCalls: 5,
                maxSearchCalls: 1,
                maxRuntimeMs: 10000,
            });

            tracker.recordSearchCall();
            expect(() => tracker.recordSearchCall()).toThrow(BudgetExceededError);
        });
    });
});
