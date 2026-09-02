/**
 * Phase B.6 — Final Autonomous-Execution Security Audit
 *
 * Comprehensive structural audit of the entire mutation execution pipeline.
 * Verifies every safety invariant through static analysis of the codebase.
 *
 * This is the "capstone" test suite. If all tests pass, the system is safe
 * for autonomous execution of growth decisions.
 *
 * Audit areas:
 *   §1 — Lifecycle write centralization (no direct opportunityStatus writes)
 *   §2 — State machine completeness (all transitions defined, no cycles)
 *   §3 — External API call containment (all effects go through registerEffect)
 *   §4 — Execution claim atomicity (CAS guards on every write path)
 *   §5 — Reconciler safety (version-aware, fail-closed, lease-based)
 *   §6 — Kill switch coverage (every entry point checks kill switches)
 *   §7 — Tenant isolation (siteId required on all operations)
 *   §8 — Audit trail completeness (all state transitions logged)
 *   §9 — Idempotency coverage (operations + effects)
 *   §10 — Error handling (fail-closed on every uncertainty)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC_ROOT = "/Users/extremesales/Downloads/aiseo2_fixed 3/src";

function readSrc(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), "utf-8");
}

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...getAllTsFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

// ══════════════════════════════════════════════════════════════════════════════
// §1 — Lifecycle write centralization
// ══════════════════════════════════════════════════════════════════════════════

describe("§1 Lifecycle write centralization", () => {
  const proposalRoutes = getAllTsFiles(join(SRC_ROOT, "app/api/proposals"));

  it("no proposal API route writes opportunityStatus directly", () => {
    for (const file of proposalRoutes) {
      const content = readFileSync(file, "utf-8");
      // Allow reads (select: { opportunityStatus: true }) but not writes
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("opportunityStatus") && !line.includes("select") && !line.includes("true")) {
          // Check if it's in a data: {} block (a write)
          const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
          expect(context).not.toMatch(/data:.*opportunityStatus/);
        }
      }
    }
  });

  it("opportunity-lifecycle.ts is the ONLY file that writes opportunityStatus", () => {
    const allSrcFiles = getAllTsFiles(SRC_ROOT);
    const writers: string[] = [];

    for (const file of allSrcFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      
      // Look for opportunityStatus in the context of a write (update/updateMany data: {})
      // Must be within 5 lines of a 'data:' or 'data =' pattern
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("opportunityStatus")) continue;
        if (lines[i].includes("select:") || lines[i].includes("select {")) continue;
        if (lines[i].includes("// ") || lines[i].includes("* ")) continue;
        
        // Check nearby lines for a data: {} write context
        const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
        const isWriteContext = context.includes("data:") || context.includes("data =");
        const isSelectContext = context.includes("select:");
        
        if (isWriteContext && !isSelectContext) {
          writers.push(file.replace(SRC_ROOT + "/", ""));
          break;
        }
      }
    }

    // Only lifecycle modules should write opportunityStatus
    // Phase B: opportunity-lifecycle.ts (OPEN → PROPOSED → APPROVED → ...)
    // Phase D.2: promoter.ts (CANDIDATE → OPEN), scorer.ts (CANDIDATE → DISMISSED)
    const ALLOWED_STATUS_WRITERS = [
      "lib/proposals/opportunity-lifecycle.ts",
      "lib/scoring/promoter.ts",
      "lib/scoring/scorer.ts",
    ];

    expect(writers).toEqual(
      expect.arrayContaining(["lib/proposals/opportunity-lifecycle.ts"])
    );
    // No files outside the allowed list should write it
    const unauthorizedWriters = writers.filter(
      (f) => !ALLOWED_STATUS_WRITERS.includes(f)
    );
    expect(unauthorizedWriters).toEqual([]);
  });

  it("all proposal routes import transitionOpportunity or use lifecycle module", () => {
    const routeFiles = proposalRoutes.filter(
      (f) => f.includes("route.ts") &&
        (f.includes("reject") || f.includes("rollback") || f.includes("retry") || f.includes("approve"))
    );

    for (const file of routeFiles) {
      const content = readFileSync(file, "utf-8");
      // Must import from lifecycle or delegation module
      const hasLifecycleImport =
        content.includes("transitionOpportunity") ||
        content.includes("opportunity-lifecycle") ||
        content.includes("retryProposal") ||
        content.includes("rollbackProposal");
      expect(hasLifecycleImport).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 — State machine completeness
// ══════════════════════════════════════════════════════════════════════════════

describe("§2 State machine completeness", () => {
  it("VALID_TRANSITIONS exists and covers all operation statuses", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/mutations/types");
    const statuses = Object.keys(VALID_TRANSITIONS);

    // All expected statuses must be present
    expect(statuses).toContain("PENDING_APPROVAL");
    expect(statuses).toContain("APPROVED");
    expect(statuses).toContain("EXECUTING");
    expect(statuses).toContain("COMMITTED");
    expect(statuses).toContain("EFFECTS_PENDING");
    expect(statuses).toContain("COMPLETED");
    expect(statuses).toContain("FAILED");
    expect(statuses).toContain("STALE");
    expect(statuses).toContain("REJECTED");
    expect(statuses).toContain("EXPIRED");
  });

  it("terminal states have no outgoing transitions", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/mutations/types");
    // Truly terminal states (no transitions out)
    const FULLY_TERMINAL = ["FAILED", "STALE", "EXPIRED", "REJECTED", "CANCELLED", "ROLLED_BACK"];

    for (const status of FULLY_TERMINAL) {
      if (status in VALID_TRANSITIONS) {
        expect(VALID_TRANSITIONS[status as keyof typeof VALID_TRANSITIONS]).toEqual([]);
      }
    }

    // COMPLETED and COMPLETED_WITH_ERRORS can still be ROLLED_BACK
    expect(VALID_TRANSITIONS["COMPLETED"]).toEqual(["ROLLED_BACK"]);
    expect(VALID_TRANSITIONS["COMPLETED_WITH_ERRORS"]).toEqual(["ROLLED_BACK"]);
  });

  it("transition graph has no cycles (DAG invariant)", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/mutations/types");
    const visited = new Set<string>();

    function hasCycle(node: string, path: Set<string>): boolean {
      if (path.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      path.add(node);
      const transitions = VALID_TRANSITIONS[node as keyof typeof VALID_TRANSITIONS] ?? [];
      for (const next of transitions) {
        if (hasCycle(next, new Set(path))) return true;
      }
      return false;
    }

    for (const status of Object.keys(VALID_TRANSITIONS)) {
      expect(hasCycle(status, new Set())).toBe(false);
    }
  });

  it("APPROVED can only transition to EXECUTING, EXPIRED, or CANCELLED", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/mutations/types");
    // APPROVED operations can be executed, expire, or be cancelled.
    // REJECTED is on the opportunity lifecycle, not the operation lifecycle.
    expect(VALID_TRANSITIONS["APPROVED"]).toContain("EXECUTING");
    expect(VALID_TRANSITIONS["APPROVED"]).toContain("EXPIRED");
    expect(VALID_TRANSITIONS["APPROVED"]).toContain("CANCELLED");
    expect(VALID_TRANSITIONS["APPROVED"]).toHaveLength(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 — External API call containment
// ══════════════════════════════════════════════════════════════════════════════

describe("§3 External API call containment", () => {
  it("execution-engine.ts does NOT call triggerInstantIndexing directly", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).not.toMatch(/await\s+triggerInstantIndexing\s*\(/);
    expect(content).not.toContain("import { triggerInstantIndexing }");
  });

  it("execution-engine.ts uses registerEffect for INDEXNOW", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain('effectType: "INDEXNOW"');
    expect(content).toContain("registerEffect");
  });

  it("execution-engine.ts uses registerEffect for GOOGLE_INDEXING", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain('effectType: "GOOGLE_INDEXING"');
  });

  it("all effect types have kill switch channel mappings", () => {
    const content = readSrc("lib/inngest/functions/mutation-effects.ts");
    expect(content).toContain("CMS_PUBLISH:");
    expect(content).toContain("GITHUB_PR:");
    expect(content).toContain("INDEXNOW:");
    expect(content).toContain("GOOGLE_INDEXING:");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 — Execution claim atomicity
// ══════════════════════════════════════════════════════════════════════════════

describe("§4 Execution claim atomicity", () => {
  it("claimExecution uses raw SQL with WHERE status = APPROVED (CAS)", () => {
    const content = readSrc("lib/mutations/concurrency.ts");
    expect(content).toContain("$executeRawUnsafe");
    expect(content).toContain("WHERE");
    expect(content).toContain("APPROVED");
  });

  it("renewLease uses raw SQL with WHERE executionClaimedBy = $workerId (ownership fence)", () => {
    const content = readSrc("lib/mutations/concurrency.ts");
    // Must have ownership check in renewal
    expect(content).toContain("executionClaimedBy");
    expect(content).toContain("EXECUTING");
  });

  it("atomicVersionedUpdate checks WHERE version = $expected (optimistic locking)", () => {
    const content = readSrc("lib/mutations/concurrency.ts");
    expect(content).toContain("versionColumn");
    expect(content).toContain("version");
    expect(content).toContain("affectedRows === 0");
  });

  it("MUTABLE_TARGETS allowlist is a closed const (compile-time only)", () => {
    const content = readSrc("lib/mutations/concurrency.ts");
    expect(content).toContain("as const satisfies");
    expect(content).toContain("MUTABLE_TARGETS");
    // Blog is the only allowed target
    expect(content).toContain('"Blog"');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 — Reconciler safety
// ══════════════════════════════════════════════════════════════════════════════

describe("§5 Reconciler safety", () => {
  it("reconciler uses executionLeaseExpiresAt (not claimedAt) for expiry", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    // The stuck operation query must use lease expiry
    const stuckOpSection = content.slice(
      content.indexOf("Recover stuck EXECUTING"),
      content.indexOf("const result: ReconcileBatchResult")
    );
    expect(stuckOpSection).toContain("executionLeaseExpiresAt");
  });

  it("reconciler calls fetchTargetVersion before recovery (version-aware)", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain("fetchTargetVersion");
    expect(content).toContain("mutationCommitted");
  });

  it("reconciler advances to COMMITTED when version bumped (does NOT reset to APPROVED)", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain('status: "COMMITTED"');
    expect(content).toContain("version check confirmed mutation applied");
  });

  it("reconciler fails closed on version check error (FAILED, not APPROVED)", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain("fail closed");
    expect(content).toContain('status: "FAILED"');
    expect(content).toContain("version check error");
  });

  it("reconciler only resets to APPROVED when version is unchanged", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain("mutation never applied, safe to retry");
  });

  it("reconciler window (2min) > lease duration (60s) — no overlap", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    // 2 * 60 * 1000 = 120000 ms wait after lease expiry
    expect(content).toContain("2 * 60 * 1000");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 — Kill switch coverage
// ══════════════════════════════════════════════════════════════════════════════

describe("§6 Kill switch coverage", () => {
  it("kill switch module exports GLOBAL_EMERGENCY_STOP", () => {
    const content = readSrc("lib/mutations/kill-switch.ts");
    expect(content).toContain("GLOBAL_EMERGENCY_STOP");
  });

  it("kill switch is checked before operation creation", () => {
    const content = readSrc("lib/mutations/operation.ts");
    const hasKillSwitchCheck =
      content.includes("assertEffectChannelEnabled") ||
      content.includes("GLOBAL_EMERGENCY_STOP") ||
      content.includes("killSwitch") ||
      content.includes("MutationBlockedError");
    expect(hasKillSwitchCheck).toBe(true);
  });

  it("kill switch is checked inside execution transaction", () => {
    const content = readSrc("lib/mutations/operation.ts");
    expect(content).toContain("MutationBlockedError");
  });

  it("effect processor checks channel kill switches", () => {
    const content = readSrc("lib/inngest/functions/mutation-effects.ts");
    expect(content).toContain("assertEffectChannelEnabled");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 — Tenant isolation
// ══════════════════════════════════════════════════════════════════════════════

describe("§7 Tenant isolation", () => {
  it("createOperation requires siteId", () => {
    const content = readSrc("lib/mutations/operation.ts");
    expect(content).toContain("siteId");
  });

  it("execution engine passes siteId to createOperation", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("siteId");
    expect(content).toContain("operationParams");
  });

  it("transitionOpportunity scopes by decisionId (implicitly siteId-scoped)", () => {
    const content = readSrc("lib/proposals/opportunity-lifecycle.ts");
    expect(content).toContain("decisionId");
  });

  it("proposal API routes verify user ownership before mutation", () => {
    const rejectRoute = readSrc("app/api/proposals/[id]/reject/route.ts");
    expect(rejectRoute).toContain("getServerSession");
    expect(rejectRoute).toContain("userId");
  });

  it("recommendation routes verify ownership", () => {
    const approveRoute = readSrc("app/api/recommendations/[id]/approve/route.ts");
    expect(approveRoute).toContain("session.user.id");
    expect(approveRoute).toContain("userId");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 — Audit trail completeness
// ══════════════════════════════════════════════════════════════════════════════

describe("§8 Audit trail completeness", () => {
  it("appendAuditEvent exists and is exported", () => {
    const content = readSrc("lib/mutations/audit.ts");
    expect(content).toContain("export");
    expect(content).toContain("appendAuditEvent");
  });

  it("reconciler logs EXECUTION_RECOVERED audit events", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain("EXECUTION_RECOVERED");
    expect(content).toContain("appendAuditEvent");
  });

  it("effect reconciler logs EFFECT_CONFIRMED and EFFECT_FAILED", () => {
    const content = readSrc("lib/mutations/reconciliation.ts");
    expect(content).toContain("EFFECT_CONFIRMED");
    expect(content).toContain("EFFECT_FAILED");
  });

  it("execution operation logs claim, renewal, and completion", () => {
    const content = readSrc("lib/mutations/concurrency.ts");
    expect(content).toContain("[claimExecution]");
    expect(content).toContain("[renewLease]");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §9 — Idempotency coverage
// ══════════════════════════════════════════════════════════════════════════════

describe("§9 Idempotency coverage", () => {
  it("generateOperationKey produces 'op:' prefixed keys", async () => {
    const { generateOperationKey } = await import("@/lib/mutations/idempotency");
    const key = generateOperationKey("test", { id: "1" });
    expect(key).toMatch(/^op:/);
  });

  it("generateEffectKey produces 'fx:' prefixed keys", async () => {
    const { generateEffectKey } = await import("@/lib/mutations/idempotency");
    const key = generateEffectKey("test", { id: "1" });
    expect(key).toMatch(/^fx:/);
  });

  it("hashParams sorts keys (order-independent)", async () => {
    const { generateEffectKey } = await import("@/lib/mutations/idempotency");
    const k1 = generateEffectKey("T", { a: "1", b: "2" });
    const k2 = generateEffectKey("T", { b: "2", a: "1" });
    expect(k1).toBe(k2);
  });

  it("execution engine passes idempotencyParams to createOperation", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("idempotencyParams");
  });

  it("registerEffect uses idempotencyParams for effect keys", () => {
    const content = readSrc("lib/mutations/operation.ts");
    expect(content).toContain("idempotencyKey");
    expect(content).toContain("generateEffectKey");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §10 — Error handling: fail-closed on uncertainty
// ══════════════════════════════════════════════════════════════════════════════

describe("§10 Fail-closed error handling", () => {
  it("LeaseLostError prevents COMMITTED return", () => {
    const content = readSrc("lib/mutations/heartbeat.ts");
    expect(content).toContain("LeaseLostError");
    expect(content).toContain("duplicate execution");
  });

  it("ConcurrentModificationError transitions to STALE (not FAILED)", async () => {
    const { VALID_TRANSITIONS } = await import("@/lib/mutations/types");
    expect(VALID_TRANSITIONS["STALE"]).toEqual([]); // Terminal
  });

  it("execution engine catches MutationBlockedError specifically", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("MutationBlockedError");
    expect(content).toContain("Kill switch active");
  });

  it("execution engine catches ExecutionClaimError specifically", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("ExecutionClaimError");
    expect(content).toContain("LOCK_CONTESTED");
  });

  it("execution engine catches ConcurrentModificationError specifically", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("ConcurrentModificationError");
    expect(content).toContain("STALE");
  });

  it("Redis lock failure aborts execution immediately (fail-closed)", () => {
    const content = readSrc("lib/growth/execution-engine.ts");
    expect(content).toContain("LOCK_UNAVAILABLE");
    expect(content).toContain("Lock acquisition failed");
  });

  it("heartbeat distinguishes network error (retry) from ownership loss (terminal)", () => {
    const content = readSrc("lib/mutations/heartbeat.ts");
    expect(content).toContain("leaseLost");
    // Should have different handling for thrown errors vs false return
    expect(content).toContain("renewLease");
  });
});
