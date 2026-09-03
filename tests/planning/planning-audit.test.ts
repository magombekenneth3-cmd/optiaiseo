/**
 * Phase D.3 — Planning Audit Tests (Static Boundary Enforcement)
 *
 * Tests 11, 12, 13 from certification gates:
 *   11. No mutation imports
 *   12. No Phase C authorization imports
 *   13. D.3 cannot authorize itself
 *
 * Plus: draft-proposal boundary verification, event chain integrity.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../");
const PLANNING_DIR = join(ROOT, "src/lib/planning");
const DRAFT_PROPOSAL = join(ROOT, "src/lib/proposals/draft-proposal.ts");
const INNGEST_PLANNING = join(ROOT, "src/lib/inngest/functions/autonomous-planning.ts");
const PROMOTER = join(ROOT, "src/lib/scoring/promoter.ts");

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

const planningFiles = getAllTsFiles(PLANNING_DIR);
const allPlanningSources = planningFiles.map((f) => ({
  path: f,
  content: readSource(f),
  name: f.replace(PLANNING_DIR + "/", ""),
}));

// ── §11 — planning/ NEVER imports from mutations/ ───────────────────────────

describe("§11 — planning/ NEVER imports from mutations/", () => {
  it.each(allPlanningSources.map((f) => [f.name, f]))(
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

// ── §12 — planning/ NEVER imports Phase C execution/budget/claim ────────────

describe("§12 — planning/ NEVER imports Phase C code", () => {
  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import execution-claim",
    (_name, file) => {
      // Check import lines only to avoid false positives from variable names
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/^import\s/) || l.match(/from\s+["']/));
      for (const line of importLines) {
        expect(line).not.toContain("execution-claim");
      }
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import budget-enforcer",
    (_name, file) => {
      expect(file.content).not.toContain("budget-enforcer");
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import concurrency-lease",
    (_name, file) => {
      expect(file.content).not.toContain("concurrency-lease");
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import autonomous-executor",
    (_name, file) => {
      expect(file.content).not.toContain("autonomous-executor");
    }
  );
});

// ── §13 — D.3 cannot authorize itself ───────────────────────────────────────

describe("§13 — D.3 cannot authorize itself", () => {
  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not write APPROVED status",
    (_name, file) => {
      // No planning file should set status to APPROVED
      expect(file.content).not.toMatch(/status.*["']APPROVED["']/);
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import transitionOpportunity",
    (_name, file) => {
      expect(file.content).not.toContain("transitionOpportunity");
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not use approvedBy or approvedAt",
    (_name, file) => {
      expect(file.content).not.toContain("approvedBy");
      expect(file.content).not.toContain("approvedAt");
    }
  );
});

// ── §13b — D.3 does not use LLM modules ────────────────────────────────────

describe("§13b — No LLM/AI modules in planning", () => {
  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not import LLM/AI modules",
    (_name, file) => {
      // Check import lines only to avoid false positives from variable names like 'expectedHash'
      const importLines = file.content
        .split("\n")
        .filter((l: string) => l.match(/^import\s/) || l.match(/from\s+["']/));
      for (const line of importLines) {
        expect(line).not.toMatch(/openai|anthropic|generative.?ai/i);
      }
    }
  );

  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not use Math.random",
    (_name, file) => {
      expect(file.content).not.toContain("Math.random");
    }
  );
});

// ── Draft Proposal Boundary ─────────────────────────────────────────────────

describe("Draft proposal boundary invariants", () => {
  const draftSource = readSource(DRAFT_PROPOSAL);

  it("draft-proposal.ts always creates DRAFT status", () => {
    expect(draftSource).toContain('status: "DRAFT"');
  });

  it("draft-proposal.ts never creates APPROVED status", () => {
    expect(draftSource).not.toMatch(/status:\s*["']APPROVED["']/);
  });

  it("draft-proposal.ts never creates READY status", () => {
    expect(draftSource).not.toMatch(/status:\s*["']READY["']/);
  });

  it("draft-proposal.ts sets requiresApproval: true always", () => {
    expect(draftSource).toContain("requiresApproval: true");
  });

  it("draft-proposal.ts never calls transitionOpportunity", () => {
    expect(draftSource).not.toContain("transitionOpportunity");
  });

  it("draft-proposal.ts never imports from mutations/", () => {
    const importLines = draftSource
      .split("\n")
      .filter((l) => l.match(/^import\s/) || l.match(/from\s+["']/));
    for (const line of importLines) {
      expect(line).not.toMatch(/mutations\//);
    }
  });

  it("draft-proposal.ts never imports execution-claim", () => {
    expect(draftSource).not.toContain("execution-claim");
  });

  it("draft-proposal.ts defines ACTIVE_PROPOSAL_STATUSES for idempotency", () => {
    expect(draftSource).toContain("ACTIVE_PROPOSAL_STATUSES");
  });

  it("draft-proposal.ts checks for existing active proposal (concurrency)", () => {
    expect(draftSource).toContain("existingActive");
    expect(draftSource).toContain("ACTIVE_PROPOSAL_STATUSES");
  });

  it("draft-proposal.ts handles P2002 unique constraint violation", () => {
    expect(draftSource).toContain("P2002");
  });
});

// ── Planner → Draft Proposal Dependency ─────────────────────────────────────

describe("Planner uses draft-proposal boundary (not generator)", () => {
  const plannerSource = readSource(join(PLANNING_DIR, "planner.ts"));

  it("planner.ts imports from draft-proposal", () => {
    expect(plannerSource).toContain("draft-proposal");
  });

  it("planner.ts calls createDraftProposal", () => {
    expect(plannerSource).toContain("createDraftProposal");
  });

  it("planner.ts does NOT import from generator.ts", () => {
    expect(plannerSource).not.toContain("from \"@/lib/proposals/generator\"");
    expect(plannerSource).not.toContain('from "@/lib/proposals/generator"');
  });

  it("planner.ts does NOT call generateProposal", () => {
    expect(plannerSource).not.toContain("generateProposal");
  });
});

// ── Event Chain Integrity ───────────────────────────────────────────────────

describe("Event chain: promoter → opportunity.opened → planning", () => {
  it("D.2 promoter emits opportunity.opened", () => {
    const promoterSource = readSource(PROMOTER);
    expect(promoterSource).toContain("opportunity.opened");
  });

  it("D.3 Inngest function listens for opportunity.opened", () => {
    const inngestSource = readSource(INNGEST_PLANNING);
    expect(inngestSource).toContain("opportunity.opened");
  });

  it("D.3 reconciliation runs every 30 minutes", () => {
    const inngestSource = readSource(INNGEST_PLANNING);
    expect(inngestSource).toContain("*/30 * * * *");
  });

  it("D.3 Inngest does NOT directly invoke Phase C executor", () => {
    const inngestSource = readSource(INNGEST_PLANNING);
    expect(inngestSource).not.toContain("autonomous-executor");
    expect(inngestSource).not.toContain("execution-claim");
  });
});

// ── Lifecycle Allowlist Integrity ────────────────────────────────────────────

describe("D.3 does NOT write opportunityStatus", () => {
  it.each(allPlanningSources.map((f) => [f.name, f]))(
    "%s does not write opportunityStatus",
    (_name, file) => {
      // Check for opportunityStatus in write context
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("opportunityStatus")) continue;
        if (lines[i].includes("//") || lines[i].includes("*")) continue;
        if (lines[i].includes("select:")) continue;

        const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
        const isWriteContext = context.includes("data:") || context.includes("data =");

        expect(
          isWriteContext,
          `${_name}:${i + 1} writes opportunityStatus in data context`
        ).toBe(false);
      }
    }
  );

  it("draft-proposal.ts does not write opportunityStatus in data context", () => {
    const source = readSource(DRAFT_PROPOSAL);
    // draft-proposal may reference opportunityStatus in WHERE/select clauses
    // for checking active proposals — that's fine. It must NOT set it in data: {}
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("opportunityStatus")) continue;
      if (lines[i].includes("//") || lines[i].includes("*")) continue;
      const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      const isWriteContext = context.includes("data:") && !context.includes("where:") && !context.includes("select:");
      expect(isWriteContext, `draft-proposal.ts:${i+1} writes opportunityStatus`).toBe(false);
    }
  });
});
