/**
 * Phase D.2 — Scoring Audit Tests (Static Boundary Enforcement)
 *
 * Tests 1, 2, 9, 10, 11, 12, 13, 15, 16 from certification gates:
 *   1.  CANDIDATE can become OPEN only through scorer promotion
 *   2.  OPEN/PROPOSED/etc. cannot be rescored through candidate path
 *   11. D.2 imports no Phase B mutations
 *   12. D.2 imports no Phase C execution/budget/claim code
 *   13. LLM output cannot directly set opportunityStatus
 *
 * Static analysis of source files to enforce architectural invariants.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../");
const SCORING_DIR = join(ROOT, "src/lib/scoring");
const INNGEST_SCORING = join(ROOT, "src/lib/inngest/functions/autonomous-scoring.ts");

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
    // Directory may not exist
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

const scoringFiles = getAllTsFiles(SCORING_DIR);
const allScoringSources = scoringFiles.map((f) => ({
  path: f,
  content: readSource(f),
  name: f.replace(SCORING_DIR + "/", ""),
}));

// ── §1 — CANDIDATE → OPEN only through promoter.ts ─────────────────────────

describe("§1 — CANDIDATE → OPEN only through promoter.ts", () => {
  it("only promoter.ts writes OPEN status", () => {
    for (const file of allScoringSources) {
      if (file.name === "promoter.ts") continue; // Allowed

      // No other scoring file should set opportunityStatus to OPEN
      expect(file.content).not.toMatch(/opportunityStatus.*["']OPEN["']/);
    }
  });

  it("promoter.ts uses atomic WHERE on CANDIDATE status", () => {
    const promoterSource = readSource(join(SCORING_DIR, "promoter.ts"));
    expect(promoterSource).toContain('opportunityStatus: "CANDIDATE"');
    expect(promoterSource).toContain("updateMany");
  });

  it("promoter.ts sets OPEN status", () => {
    const promoterSource = readSource(join(SCORING_DIR, "promoter.ts"));
    expect(promoterSource).toContain('opportunityStatus: "OPEN"');
  });
});

// ── §2 — Non-CANDIDATE cannot be rescored ───────────────────────────────────

describe("§2 — Only CANDIDATE records can be scored", () => {
  it("scorer.ts checks opportunityStatus is CANDIDATE", () => {
    const scorerSource = readSource(join(SCORING_DIR, "scorer.ts"));
    expect(scorerSource).toContain('opportunityStatus !== "CANDIDATE"');
  });

  it("scorer.ts returns null for non-CANDIDATE", () => {
    const scorerSource = readSource(join(SCORING_DIR, "scorer.ts"));
    expect(scorerSource).toContain("return null");
  });
});

// ── §9 — Concurrent scorers cannot double-promote ───────────────────────────

describe("§9 — Concurrent scorer protection", () => {
  it("promoter uses updateMany with WHERE CANDIDATE", () => {
    const source = readSource(join(SCORING_DIR, "promoter.ts"));
    expect(source).toContain("updateMany");
    expect(source).toContain('opportunityStatus: "CANDIDATE"');
  });

  it("promoter checks result.count for concurrent detection", () => {
    const source = readSource(join(SCORING_DIR, "promoter.ts"));
    expect(source).toContain("result.count === 0");
  });
});

// ── §10 — Every promotion has durable scoring record ────────────────────────

describe("§10 — Durable scoring record", () => {
  it("scorer.ts persists OpportunityScoreRecord before promotion", () => {
    const source = readSource(join(SCORING_DIR, "scorer.ts"));
    // Search for function CALLS (with parens), not imports
    const persistIdx = source.indexOf("await persistScoreRecord(");
    const promoteIdx = source.indexOf("await promoteCandidateToOpen(");

    expect(persistIdx).toBeGreaterThan(-1);
    expect(promoteIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeLessThan(promoteIdx);
  });

  it("score record includes evidenceHash", () => {
    const source = readSource(join(SCORING_DIR, "scorer.ts"));
    expect(source).toContain("evidenceHash");
  });
});

// ── §11 — D.2 imports no Phase B mutations ──────────────────────────────────

describe("§11 — scoring/ NEVER imports from mutations/", () => {
  it.each(allScoringSources.map((f) => [f.name, f]))(
    "%s does not import from mutations/",
    (_name, file) => {
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/^import\s/) || l.match(/from\s+["']/));

      for (const line of importLines) {
        expect(line).not.toMatch(/mutations\//);
      }
    }
  );
});

// ── §12 — D.2 imports no Phase C execution/budget/claim code ────────────────

describe("§12 — scoring/ NEVER imports from execution/budget/claim", () => {
  it.each(allScoringSources.map((f) => [f.name, f]))(
    "%s does not import execution-claim",
    (_name, file) => {
      expect(file.content).not.toContain("execution-claim");
    }
  );

  it.each(allScoringSources.map((f) => [f.name, f]))(
    "%s does not import budget-enforcer",
    (_name, file) => {
      expect(file.content).not.toContain("budget-enforcer");
    }
  );

  it.each(allScoringSources.map((f) => [f.name, f]))(
    "%s does not import concurrency-lease",
    (_name, file) => {
      expect(file.content).not.toContain("concurrency-lease");
    }
  );
});

// ── §13 — LLM output cannot directly set opportunityStatus ──────────────────

describe("§13 — No LLM/AI modules in scoring", () => {
  it.each(allScoringSources.map((f) => [f.name, f]))(
    "%s does not import LLM/AI modules",
    (_name, file) => {
      expect(file.content).not.toMatch(/openai|anthropic|generat.*ai/i);
    }
  );

  it("score-calculator.ts does not use Math.random", () => {
    const source = readSource(join(SCORING_DIR, "score-calculator.ts"));
    expect(source).not.toContain("Math.random");
  });

  it("eligibility.ts does not use Math.random", () => {
    const source = readSource(join(SCORING_DIR, "eligibility.ts"));
    expect(source).not.toContain("Math.random");
  });
});

// ── §15 — Fresh candidate check in promoter ─────────────────────────────────

describe("§15 — Promoter checks candidate freshness", () => {
  it("promoter checks expiresAt before promotion", () => {
    const source = readSource(join(SCORING_DIR, "promoter.ts"));
    expect(source).toContain("expiresAt");
    expect(source).toContain("expired");
  });
});

// ── §16 — Phase C executor only sees OPEN ───────────────────────────────────

describe("§16 — Phase C executor queries OPEN, not CANDIDATE", () => {
  it("autonomous-executor queries OPEN opportunities", () => {
    const executorSource = readSource(
      join(ROOT, "src/lib/inngest/functions/autonomous-executor.ts")
    );
    expect(executorSource).toMatch(/opportunityStatus.*OPEN/);
  });

  it("autonomous-executor does NOT query CANDIDATE", () => {
    const executorSource = readSource(
      join(ROOT, "src/lib/inngest/functions/autonomous-executor.ts")
    );
    expect(executorSource).not.toMatch(/opportunityStatus.*CANDIDATE/);
  });
});

// ── §D2 Event Chain ─────────────────────────────────────────────────────────

describe("§D2 — Event chain integrity", () => {
  it("D.1 discovery-runner emits opportunity.candidate.created", () => {
    const runnerSource = readSource(
      join(ROOT, "src/lib/discovery/discovery-runner.ts")
    );
    expect(runnerSource).toContain("opportunity.candidate.created");
  });

  it("D.2 Inngest function listens for opportunity.candidate.created", () => {
    const inngestSource = readSource(INNGEST_SCORING);
    expect(inngestSource).toContain("opportunity.candidate.created");
  });

  it("D.2 scoring does NOT emit opportunity.scored directly", () => {
    const inngestSource = readSource(INNGEST_SCORING);
    expect(inngestSource).not.toMatch(/["']opportunity\.scored["']/);
  });

  it("D.2 scoring reconciliation runs every 30 minutes", () => {
    const inngestSource = readSource(INNGEST_SCORING);
    expect(inngestSource).toContain("*/30 * * * *");
  });
});
