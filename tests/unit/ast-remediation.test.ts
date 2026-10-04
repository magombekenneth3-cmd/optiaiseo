import { describe, it, expect } from "vitest";
import { applyAstFixPlan, generateDisplayUnifiedDiff } from "@/lib/ast/executor";
import type { AstFixPlan } from "@/lib/ast/types";
import { tryDeterministicFix } from "@/lib/seo-audit/deterministic-fixes";
import { createAutoFixPR } from "@/lib/github";

describe("Canonical AST Remediation Engine", () => {
  it("applies setObjectProperty AST mutation on TypeScript metadata export", () => {
    const originalTsx = `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Old Title",
  description: "Old Description",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_test_1",
      filePath: "src/app/layout.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setObjectProperty",
          target: "metadata",
          property: "title",
          value: "Updated Title for SEO",
        },
      ],
      rationale: "Update meta title",
      risk: "LOW",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalTsx, plan);
    expect(prepared.serializedContent).toContain('"Updated Title for SEO"');
    expect(prepared.serializedContent).not.toContain('"Old Title"');
    expect(prepared.serializedContent).toContain('"Old Description"');
    expect(prepared.serializedContent).toContain('export default function RootLayout');
    expect(prepared.serializedContent).toContain('import type { Metadata } from "next";');
    expect(prepared.appliedOperationsCount).toBe(1);
    expect(prepared.unifiedDiff).toContain('+  title: "Updated Title for SEO"');
  });

  it("applies HTML AST operations (setHtmlAttribute and insertHtmlElement)", () => {
    const originalHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_html_1",
      filePath: "index.html",
      language: "html",
      operations: [
        {
          kind: "setHtmlAttribute",
          selector: "html",
          attributeName: "lang",
          value: "en",
        },
        {
          kind: "insertHtmlElement",
          parentSelector: "head",
          position: "append",
          htmlSnippet: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        },
      ],
      rationale: "Add lang and viewport",
      risk: "SAFE",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalHtml, plan);
    expect(prepared.serializedContent).toContain('<html lang="en">');
    expect(prepared.serializedContent).toContain('name="viewport"');
    expect(prepared.serializedContent).toContain('content="width=device-width, initial-scale=1"');
  });

  it("aborts execution if expected current value does not match (STALE_FIX_ABORTED)", () => {
    const originalTsx = `export const metadata = {
  title: "Actual Current Title",
};
`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_stale_1",
      filePath: "src/app/layout.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setObjectProperty",
          target: "metadata",
          property: "title",
          value: "New Title",
          expectedCurrentValue: "Different Expected Title",
        },
      ],
      rationale: "Stale fix test",
      risk: "MEDIUM",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/STALE_FIX_ABORTED/);
  });

  it("fails execution if target node does not exist in AST", () => {
    const originalTsx = `export const config = { runtime: "nodejs" };`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_missing_node",
      filePath: "src/app/layout.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setObjectProperty",
          target: "metadata",
          property: "title",
          value: "New Title",
        },
      ],
      rationale: "Target missing test",
      risk: "MEDIUM",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/AST_MUTATION_FAILED/);
  });

  it("fails execution if AstFixPlan contains zero operations", () => {
    const originalTsx = `export const metadata = {};`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_zero_ops",
      filePath: "src/app/layout.tsx",
      language: "tsx",
      operations: [],
      rationale: "Empty ops test",
      risk: "LOW",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/zero operations/);
  });

  it("generates presentation unified diffs for UI display", () => {
    const orig = "line1\nline2\nline3";
    const mod = "line1\nline2_modified\nline3";
    const diff = generateDisplayUnifiedDiff(orig, mod, "test.txt");

    expect(diff).toContain("--- a/test.txt");
    expect(diff).toContain("+++ b/test.txt");
    expect(diff).toContain("-line2");
    expect(diff).toContain("+line2_modified");
  });

  it("ensures deterministic fix generators emit structured astOperations", () => {
    const fixResult = tryDeterministicFix("canonical_missing", {
      url: "https://example.com/page",
      domain: "example.com",
    });

    expect(fixResult).not.toBeNull();
    expect(fixResult?.astLanguage).toBe("html");
    expect(fixResult?.astOperations).toBeDefined();
    expect(fixResult?.astOperations?.length).toBeGreaterThan(0);
    expect(fixResult?.astOperations?.[0].kind).toBe("insertHtmlElement");
  });

  it("rejects PR creation when PreparedAstChange content hash mismatches", async () => {
    const fakePreparedChange = {
      findingFingerprint: "fp_123",
      filePath: "src/app/layout.tsx",
      language: "tsx" as const,
      serializedContent: "valid content",
      contentHash: "tampered_hash_that_does_not_match",
      unifiedDiff: "--- a\n+++ b",
      astFingerprintBefore: "hash1",
      astFingerprintAfter: "hash2",
      appliedOperationsCount: 1,
    };

    const res = await createAutoFixPR(
      "https://github.com/owner/repo",
      [
        {
          path: "src/app/layout.tsx",
          content: "valid content",
          description: "Test description",
          astPreparedChange: fakePreparedChange,
        },
      ],
      "example.com",
      "gho_dummy_token",
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("AST_INTEGRITY_FAILED");
  });
});
