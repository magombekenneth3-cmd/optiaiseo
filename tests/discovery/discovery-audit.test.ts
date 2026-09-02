/**
 * Phase D.1 — Discovery Boundary Audit Tests
 *
 * Static analysis tests that enforce the architectural invariants
 * of the discovery system:
 *
 * §1 — discovery/ NEVER imports from mutations/
 * §2 — discovery/ NEVER imports from proposals/
 * §3 — discovery-runner creates CANDIDATE, never OPEN
 * §4 — All detectors include sourceRunId provenance
 * §5 — Validator uses source-specific evidence age
 * §6 — Conflict resolution is deterministic (no random/LLM)
 * §7 — discoveryConfidence semantic bounds
 * §8 — Discovery module dependency direction
 * §9 — Inngest discovery functions emit correct events
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { createHash } from "node:crypto";
import { validateSignal } from "@/lib/discovery/validators";

const ROOT = resolve(__dirname, "../../");
const DISCOVERY_DIR = join(ROOT, "src/lib/discovery");
const INNGEST_DISCOVERY = join(ROOT, "src/lib/inngest/functions/autonomous-discovery.ts");

// ── Helpers ─────────────────────────────────────────────────────────────────

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist in some test environments
  }
  return files;
}

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ── Collect all discovery source files ──────────────────────────────────────

const discoveryFiles = getAllTsFiles(DISCOVERY_DIR);
const allDiscoverySources = discoveryFiles.map((f) => ({
  path: f,
  content: readSource(f),
  name: f.replace(DISCOVERY_DIR + "/", ""),
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("§1 — discovery/ NEVER imports from mutations/", () => {
  it.each(allDiscoverySources.map((f) => [f.name, f]))(
    "%s does not import from mutations/",
    (_name, file) => {
      // Check for any import path containing "mutations"
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/^import\s/) || l.match(/from\s+["']/));

      for (const line of importLines) {
        expect(line).not.toMatch(/mutations\//);
      }
    }
  );
});

describe("§2 — discovery/ NEVER imports from proposals/", () => {
  it.each(allDiscoverySources.map((f) => [f.name, f]))(
    "%s does not import from proposals/",
    (_name, file) => {
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/^import\s/) || l.match(/from\s+["']/));

      for (const line of importLines) {
        expect(line).not.toMatch(/proposals\//);
      }
    }
  );
});

describe("§3 — Discovery creates CANDIDATE, never OPEN", () => {
  it("discovery-runner.ts contains CANDIDATE status", () => {
    const runnerSource = readSource(join(DISCOVERY_DIR, "discovery-runner.ts"));
    expect(runnerSource).toContain('"CANDIDATE"');
  });

  it("discovery-runner.ts does NOT create OPEN status", () => {
    const runnerSource = readSource(join(DISCOVERY_DIR, "discovery-runner.ts"));
    // Look for opportunityStatus: "OPEN" — should NOT exist
    expect(runnerSource).not.toMatch(/opportunityStatus:\s*["']OPEN["']/);
  });

  it("no discovery file creates OPEN status", () => {
    for (const file of allDiscoverySources) {
      // Check for opportunityStatus being set to OPEN
      const matches = file.content.match(/opportunityStatus:\s*["']OPEN["']/g);
      expect(matches).toBeNull();
    }
  });
});

describe("§4 — All detectors include sourceRunId provenance", () => {
  const detectorDir = join(DISCOVERY_DIR, "source-detectors");
  const detectorFiles = getAllTsFiles(detectorDir).map((f) => ({
    path: f,
    content: readSource(f),
    name: f.replace(detectorDir + "/", ""),
  }));

  it.each(detectorFiles.map((f) => [f.name, f]))(
    "%s includes sourceRunId in output signals",
    (_name, file) => {
      expect(file.content).toContain("sourceRunId");
    }
  );

  it.each(detectorFiles.map((f) => [f.name, f]))(
    "%s accepts sourceRunId as parameter",
    (_name, file) => {
      // Should have sourceRunId in the function signature
      expect(file.content).toMatch(/sourceRunId:\s*string/);
    }
  );
});

describe("§5 — Validator uses source-specific evidence age", () => {
  it("validator imports isEvidenceFresh from freshness", () => {
    const validatorSource = readSource(join(DISCOVERY_DIR, "validators.ts"));
    expect(validatorSource).toContain("isEvidenceFresh");
    expect(validatorSource).toMatch(/from\s+["']\.\/freshness["']/);
  });

  it("validator does NOT use a hardcoded 30-day constant", () => {
    const validatorSource = readSource(join(DISCOVERY_DIR, "validators.ts"));
    // Should not have a line like MAX_EVIDENCE_AGE = 30
    expect(validatorSource).not.toMatch(/MAX_EVIDENCE_AGE\s*=\s*30/);
  });
});

describe("§6 — Conflict resolution is deterministic", () => {
  it("conflict-resolution.ts does not use Math.random", () => {
    const source = readSource(join(DISCOVERY_DIR, "conflict-resolution.ts"));
    expect(source).not.toContain("Math.random");
  });

  it("conflict-resolution.ts does not import LLM/AI modules", () => {
    const source = readSource(join(DISCOVERY_DIR, "conflict-resolution.ts"));
    expect(source).not.toMatch(/openai|anthropic|llm|generat.*ai/i);
  });

  it("CATEGORY_PRIORITY is a readonly array", () => {
    const source = readSource(join(DISCOVERY_DIR, "conflict-resolution.ts"));
    expect(source).toMatch(/CATEGORY_PRIORITY.*readonly/);
  });
});

describe("§7 — Discovery confidence semantic bounds", () => {
  it("types.ts documents confidence as probability condition exists", () => {
    const typesSource = readSource(join(DISCOVERY_DIR, "types.ts"));
    expect(typesSource).toContain("probability");
    expect(typesSource).toContain("condition");
    expect(typesSource).toContain("EXISTS");
  });

  it("types.ts explicitly states confidence is NOT impact", () => {
    const typesSource = readSource(join(DISCOVERY_DIR, "types.ts"));
    // These appear on separate lines, so check each individually
    expect(typesSource).toContain("This is NOT");
    expect(typesSource).toContain("impact");
  });

  it("validator rejects confidence > 1.0", () => {
    const result = validateSignal({
      siteId: "s1",
      source: "GSC",
      sourceRunId: "r1",
      fingerprint: createHash("sha256").update("test").digest("hex"),
      category: "QUICK_WIN",
      suggestedAction: "OPTIMIZE_TITLE",
      resourceType: "PAGE",
      resourceId: "/test",
      confidence: 1.01,
      evidence: [{ sourceType: "GSC", observedAt: new Date() }],
    });
    expect(result.valid).toBe(false);
  });
});

describe("§8 — Discovery module dependency direction", () => {
  it("discovery/ does NOT import from autonomy/ (except operating-modes)", () => {
    for (const file of allDiscoverySources) {
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/from\s+["'].*autonomy/));

      for (const line of importLines) {
        // Only operating-modes is allowed
        expect(line).toMatch(/operating-modes/);
      }
    }
  });

  it("discovery/ does NOT import from execution-claim", () => {
    for (const file of allDiscoverySources) {
      expect(file.content).not.toContain("execution-claim");
    }
  });

  it("discovery/ does NOT import from budget-enforcer", () => {
    for (const file of allDiscoverySources) {
      expect(file.content).not.toContain("budget-enforcer");
    }
  });
});

describe("§9 — Inngest discovery events", () => {
  const inngestSource = readSource(INNGEST_DISCOVERY);

  it("emits discovery.run-source events", () => {
    expect(inngestSource).toContain("discovery.run-source");
  });

  it("does NOT emit opportunity.scored directly", () => {
    // Discovery should NOT bypass D.2 by emitting scored events
    expect(inngestSource).not.toMatch(/["']opportunity\.scored["']/);
  });

  it("reconciliation is weekly, not daily", () => {
    // Cron should be weekly (day-of-week specified)
    expect(inngestSource).toMatch(/cron:\s*["']0 4 \* \* 3["']/);
  });

  it("includes event bridges for GSC and audit", () => {
    expect(inngestSource).toContain("gsc.sync.completed");
    expect(inngestSource).toContain("audit.completed");
  });
});
