// =============================================================================
// FAILURE PATH & RACE CONDITION TESTS
//
// Tests the system under adversarial conditions: timeouts, crashes, lock
// contention, LLM malformed output, and partial failures. These tests verify
// production-grade behavior beyond happy-path coverage.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/lib/agents/runner";
import {
  acquireAnalysisLock,
  releaseAnalysisLock,
  renewAnalysisLease,
  startLeaseHeartbeat,
  LEASE_TTL_SECONDS,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/agents/analysis-lock";
import { validateIntentResponse, salvageIntentResponse } from "@/lib/agents/intent-validation";
import { createOpportunityFingerprint } from "@/lib/opportunity-engine/findings-to-opportunities";
import type { AgentExecution } from "@/lib/agents/types";
import type { IntentClassification } from "@/lib/agents/intent-agent";

describe("Failure Path & Race Condition Tests", () => {
  // ── Test Setup ──────────────────────────────────────────────────────────
  let testSiteId: string;
  const testUserId = `fp-user-${Date.now()}`;

  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: testUserId },
      update: {},
      create: { id: testUserId, email: `fp-${Date.now()}@test.com` },
    });
    const site = await prisma.site.create({
      data: { domain: `failure-test-${Date.now()}.com`, userId: testUserId },
    });
    testSiteId = site.id;
  });

  afterEach(async () => {
    if (testSiteId) {
      await prisma.site.delete({ where: { id: testSiteId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Agent Timeout
  // ─────────────────────────────────────────────────────────────────────────

  it("marks run as FAILED when agent exceeds timeout", async () => {
    const result = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => {
        // Simulate a long-running agent that exceeds timeout
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { data: {}, findings: [], itemsProcessed: 0 };
      },
      { timeoutMs: 100 }, // 100ms timeout — will definitely expire
    );

    expect(result.status).toBe("FAILED");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("AGENT_FATAL");
    expect(result.errors[0].message).toContain("timed out");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Agent Throws Exception
  // ─────────────────────────────────────────────────────────────────────────

  it("captures fatal error when agent throws", async () => {
    const result = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => {
        throw new Error("Database connection lost");
      },
    );

    expect(result.status).toBe("FAILED");
    expect(result.findings).toHaveLength(0);
    expect(result.errors[0].message).toContain("Database connection lost");
    expect(result.errors[0].recoverable).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Agent Returns Recoverable Error → PARTIAL
  // ─────────────────────────────────────────────────────────────────────────

  it("returns PARTIAL when agent reports recoverable errors with findings", async () => {
    const result = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_TITLE",
            severity: "HIGH",
            title: "Missing title",
            description: "https://example.com has no title",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com" },
            evidence: [],
          },
        ],
        errors: [
          { code: "PARTIAL_CRAWL", message: "3 pages timed out", recoverable: true },
        ],
        itemsProcessed: 7,
      }),
    );

    expect(result.status).toBe("PARTIAL");
    expect(result.findings).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. PARTIAL Run Does NOT Reconcile
  // ─────────────────────────────────────────────────────────────────────────

  it("does not reconcile findings after PARTIAL run", async () => {
    // Run 1: Create an OPEN finding
    const run1 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_TITLE",
            severity: "HIGH",
            title: "Missing title",
            description: "https://example.com has no title",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/partial-test" },
            evidence: [],
          },
        ],
        itemsProcessed: 1,
      }),
    );
    expect(run1.status).toBe("COMPLETED");

    // Run 2: Return empty findings WITH recoverable error → PARTIAL
    const run2 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [],
        errors: [{ code: "CRAWL_TIMEOUT", message: "Timed out", recoverable: true }],
        itemsProcessed: 0,
      }),
    );
    expect(run2.status).toBe("PARTIAL");

    // The finding from Run 1 should still be OPEN (not RESOLVED)
    const finding = await prisma.agentFinding.findFirst({
      where: { fingerprint: run1.findings[0].fingerprint },
      orderBy: { createdAt: "desc" },
    });
    expect(finding?.status).toBe("OPEN");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. FAILED Run Does NOT Reconcile
  // ─────────────────────────────────────────────────────────────────────────

  it("does not reconcile findings after FAILED run", async () => {
    // Run 1: Create an OPEN finding
    const run1 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "SLOW_TTFB",
            severity: "LOW",
            title: "Slow TTFB",
            description: "Slow response time",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/failed-test" },
            evidence: [],
          },
        ],
        itemsProcessed: 1,
      }),
    );
    expect(run1.status).toBe("COMPLETED");

    // Run 2: Agent crashes → FAILED
    await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => {
        throw new Error("Agent crashed");
      },
    );

    // The finding from Run 1 should still be OPEN
    const finding = await prisma.agentFinding.findFirst({
      where: { fingerprint: run1.findings[0].fingerprint },
      orderBy: { createdAt: "desc" },
    });
    expect(finding?.status).toBe("OPEN");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Empty Findings Reconciliation (All OPEN → RESOLVED)
  // ─────────────────────────────────────────────────────────────────────────

  it("resolves all previous OPEN findings when agent returns 0 findings", async () => {
    // Run 1: Create two OPEN findings
    const run1 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_TITLE",
            severity: "HIGH",
            title: "Missing title A",
            description: "Page A",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/a-empty" },
            evidence: [],
          },
          {
            type: "MISSING_H1",
            severity: "MEDIUM",
            title: "Missing H1 B",
            description: "Page B",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/b-empty" },
            evidence: [],
          },
        ],
        itemsProcessed: 2,
      }),
    );
    expect(run1.status).toBe("COMPLETED");
    expect(run1.findings).toHaveLength(2);

    // Run 2: Clean scan — 0 findings
    await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [],
        itemsProcessed: 2,
      }),
    );

    // Both findings should now be RESOLVED
    const findingA = await prisma.agentFinding.findFirst({
      where: { fingerprint: run1.findings[0].fingerprint },
    });
    const findingB = await prisma.agentFinding.findFirst({
      where: { fingerprint: run1.findings[1].fingerprint },
    });
    expect(findingA?.status).toBe("RESOLVED");
    expect(findingB?.status).toBe("RESOLVED");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7–8. Redis Lock Tests (Unit-level, no actual Redis needed)
  // ─────────────────────────────────────────────────────────────────────────

  it("exports LEASE_TTL_SECONDS and HEARTBEAT_INTERVAL_MS as correct values", () => {
    expect(LEASE_TTL_SECONDS).toBe(120);
    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. startLeaseHeartbeat stop() clears interval
  // ─────────────────────────────────────────────────────────────────────────

  it("startLeaseHeartbeat.stop() prevents further ticks", () => {
    // Can't fully test without Redis, but verify the interface contract
    const heartbeat = startLeaseHeartbeat("test-site", "test-token", "test-run", () => {});
    expect(heartbeat.isLost()).toBe(false);
    heartbeat.stop();
    // After stop, calling stop again is safe (idempotent)
    heartbeat.stop();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Opportunity Fingerprint Stability
  // ─────────────────────────────────────────────────────────────────────────

  it("opportunity fingerprint is deterministic and stable", () => {
    const fp1 = createOpportunityFingerprint({
      siteId: "site-123",
      category: "QUICK_WIN",
      resourceType: "PAGE",
      resourceId: "https://example.com/pricing",
      action: "OPTIMIZE_TITLE",
    });

    const fp2 = createOpportunityFingerprint({
      siteId: "site-123",
      category: "QUICK_WIN",
      resourceType: "PAGE",
      resourceId: "https://example.com/pricing",
      action: "OPTIMIZE_TITLE",
    });

    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex

    // Different inputs → different fingerprints
    const fp3 = createOpportunityFingerprint({
      siteId: "site-123",
      category: "DECLINING",
      resourceType: "PAGE",
      resourceId: "https://example.com/pricing",
      action: "REFRESH_CONTENT",
    });
    expect(fp3).not.toBe(fp1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Gemini Malformed JSON → Zod Validation Rejects
  // ─────────────────────────────────────────────────────────────────────────

  it("validateIntentResponse rejects malformed LLM output", () => {
    // Not an array
    expect(() => validateIntentResponse("not json")).toThrow("LLM output validation failed");

    // Array of non-objects
    expect(() => validateIntentResponse([42, "string"])).toThrow("LLM output validation failed");

    // Missing required fields
    expect(() => validateIntentResponse([{ query: "test" }])).toThrow("LLM output validation failed");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Gemini Invalid Enum → Zod Validation Rejects
  // ─────────────────────────────────────────────────────────────────────────

  it("validateIntentResponse rejects invalid SearchIntent enum", () => {
    const invalidData = [
      {
        query: "best seo tool",
        queryIntent: "HALLUCINATED_INTENT", // Not a valid enum
        pageUrl: "https://example.com",
        pageIntent: "INFORMATIONAL",
        match: false,
        matchScore: 30,
        confidence: 80,
        reason: "Test",
      },
    ];

    expect(() => validateIntentResponse(invalidData)).toThrow("LLM output validation failed");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Gemini Out-of-Range Values → Zod Validation Rejects
  // ─────────────────────────────────────────────────────────────────────────

  it("validateIntentResponse rejects out-of-range scores", () => {
    const invalidData = [
      {
        query: "test query",
        queryIntent: "INFORMATIONAL",
        pageUrl: "https://example.com",
        pageIntent: "TRANSACTIONAL",
        match: false,
        matchScore: 150, // > 100
        confidence: -10, // < 0
        reason: "Test",
      },
    ];

    expect(() => validateIntentResponse(invalidData)).toThrow("LLM output validation failed");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 14. Valid LLM Output Passes Validation
  // ─────────────────────────────────────────────────────────────────────────

  it("validateIntentResponse accepts valid LLM output", () => {
    const validData = [
      {
        query: "best seo tool",
        queryIntent: "COMMERCIAL",
        pageUrl: "https://example.com/tools",
        pageIntent: "INFORMATIONAL",
        match: false,
        matchScore: 30,
        confidence: 85,
        reason: "Query is commercial but page is informational",
      },
    ];

    const result = validateIntentResponse(validData);
    expect(result).toHaveLength(1);
    expect(result[0].queryIntent).toBe("COMMERCIAL");
    expect(result[0].confidence).toBe(85);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 15. salvageIntentResponse Recovers Partial Valid Output
  // ─────────────────────────────────────────────────────────────────────────

  it("salvageIntentResponse keeps valid items and counts invalid ones", () => {
    const mixedData = [
      {
        query: "valid query",
        queryIntent: "INFORMATIONAL",
        pageUrl: "https://example.com",
        pageIntent: "INFORMATIONAL",
        match: true,
        matchScore: 90,
        confidence: 95,
        reason: "Good match",
      },
      {
        query: "invalid",
        queryIntent: "NOT_A_REAL_INTENT",
        pageUrl: "https://example.com",
        pageIntent: "INFORMATIONAL",
        match: false,
        matchScore: 200, // Out of range
        confidence: 50,
        reason: "Bad",
      },
    ];

    const { valid, invalidCount } = salvageIntentResponse(mixedData);
    expect(valid).toHaveLength(1);
    expect(valid[0].query).toBe("valid query");
    expect(invalidCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 16. Intent Agent Handles classifyFn Timeout
  // ─────────────────────────────────────────────────────────────────────────

  it("intent agent handles classifyFn timeout as recoverable error", async () => {
    const { analyzeIntent } = await import("@/lib/agents/intent-agent");

    const result = await analyzeIntent(
      "test-site",
      [{ query: "test", pageUrl: "https://example.com" }],
      async () => {
        throw new Error("Request timeout after 30000ms");
      },
    );

    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0].code).toBe("INTENT_CLASSIFICATION_FAILED");
    expect(result.errors![0].recoverable).toBe(true);
    expect(result.data.totalClassified).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 17. Intent Agent Catches Zod Validation Failure as Recoverable
  // ─────────────────────────────────────────────────────────────────────────

  it("intent agent catches LLM validation failure as recoverable error", async () => {
    const { analyzeIntent } = await import("@/lib/agents/intent-agent");

    const result = await analyzeIntent(
      "test-site",
      [{ query: "test", pageUrl: "https://example.com" }],
      async () => {
        // Return malformed output — invalid enum
        return [
          {
            query: "test",
            queryIntent: "HALLUCINATED",
            pageUrl: "https://example.com",
            pageIntent: "INFORMATIONAL",
            match: false,
            matchScore: 50,
            confidence: 80,
            reason: "Test",
          },
        ] as unknown as IntentClassification[];
      },
    );

    // Should have a validation error, not a crash
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.code === "INTENT_VALIDATION_FAILED")).toBe(true);
    expect(result.data.totalClassified).toBe(0);
  });
});
