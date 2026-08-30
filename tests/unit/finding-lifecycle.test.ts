// =============================================================================
// FINDING LIFECYCLE INTEGRATION TEST
//
// Tests finding lifecycle transitions in runner.ts:
// Run #1 → issue present → OPEN
// Run #2 → issue present → remains OPEN (deduplicated)
// Run #3 → issue resolved → RESOLVED
// Run #4 → issue reoccurs → REOPENED
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAgent } from "@/lib/agents/runner";
import type { AgentExecution } from "@/lib/agents/types";

describe("Finding Lifecycle Integration Test", () => {
  let testSiteId: string;

  const testUserId = `user-${Date.now()}`;

  beforeEach(async () => {
    // Upsert a test user first to satisfy foreign key constraint
    await prisma.user.upsert({
      where: { id: testUserId },
      update: {},
      create: {
        id: testUserId,
        email: `user-${Date.now()}@example.com`,
      },
    });

    // Create a temporary site for test isolation
    const site = await prisma.site.create({
      data: {
        domain: `lifecycle-test-${Date.now()}.com`,
        userId: testUserId,
      },
    });
    testSiteId = site.id;
  });

  afterEach(async () => {
    // Clean up created site and user
    if (testSiteId) {
      await prisma.site.delete({ where: { id: testSiteId } }).catch(() => { });
    }
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => { });
  });

  it("transitions findings through OPEN -> RESOLVED -> REOPENED lifecycle", async () => {
    // ── Run #1: Issue Present (Missing Meta Description) ────────────────────
    const run1 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_META_DESCRIPTION",
            severity: "MEDIUM",
            title: "Missing Meta Description",
            description: "https://example.com/page-1 has no meta description",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/page-1" },
            evidence: [],
          },
        ],
        itemsProcessed: 1,
      }),
    );

    expect(run1.status).toBe("COMPLETED");
    expect(run1.findings).toHaveLength(1);

    // Verify finding in DB is OPEN
    const finding1 = await prisma.agentFinding.findFirst({
      where: { fingerprint: run1.findings[0].fingerprint },
    });
    expect(finding1).toBeDefined();
    expect(finding1?.status).toBe("OPEN");

    // ── Run #2: Same Issue Present (Should maintain same fingerprint) ───────
    const run2 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_META_DESCRIPTION",
            severity: "MEDIUM",
            title: "Missing Meta Description",
            description: "https://example.com/page-1 has no meta description",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/page-1" },
            evidence: [],
          },
        ],
        itemsProcessed: 1,
      }),
    );

    expect(run2.findings[0].fingerprint).toBe(run1.findings[0].fingerprint);

    // ── Run #3: Issue Fixed (0 findings returned) ─────────────────────────
    const run3 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [],
        itemsProcessed: 1,
      }),
    );

    expect(run3.status).toBe("COMPLETED");

    // Verify original finding is now RESOLVED by reconciliation
    const finding3 = await prisma.agentFinding.findFirst({
      where: { id: finding1!.id },
    });
    expect(finding3?.status).toBe("RESOLVED");

    // ── Run #4: Issue Reoccurs (Should create new entry with status REOPENED)
    const run4 = await runAgent(
      "TECHNICAL_SEO",
      testSiteId,
      async (): Promise<AgentExecution<unknown>> => ({
        data: {},
        findings: [
          {
            type: "MISSING_META_DESCRIPTION",
            severity: "MEDIUM",
            title: "Missing Meta Description",
            description: "https://example.com/page-1 has no meta description",
            confidence: 1.0,
            affectedResource: { type: "PAGE", id: "https://example.com/page-1" },
            evidence: [],
          },
        ],
        itemsProcessed: 1,
      }),
    );

    expect(run4.status).toBe("COMPLETED");
    const finding4 = await prisma.agentFinding.findFirst({
      where: { id: { not: finding1!.id }, fingerprint: run1.findings[0].fingerprint },
      orderBy: { createdAt: "desc" },
    });
    expect(finding4).toBeDefined();
    expect(finding4?.status).toBe("REOPENED");
  });
});
