import { describe, it, expect, vi } from "vitest";
import { applyAstFixPlan, generateDisplayUnifiedDiff } from "@/lib/ast/executor";
import type { AstFixPlan } from "@/lib/ast/types";
import { tryDeterministicFix } from "@/lib/seo-audit/deterministic-fixes";
import { createAutoFixPR } from "@/lib/github";
import * as mutationsModule from "@/lib/mutations";
import { createHash } from "crypto";

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
      baseBlobSha: "sha_mock_123",
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
      baseBlobSha: "sha_mock_123",
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
          tagName: "meta",
          attributes: { name: "viewport", content: "width=device-width, initial-scale=1" },
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
      baseBlobSha: "sha_mock_123",
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
      baseBlobSha: "sha_mock_123",
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

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/AST_TARGET_NOT_FOUND|AST_MUTATION_FAILED/);
  });

  it("fails execution if AstFixPlan contains zero operations", () => {
    const originalTsx = `export const metadata = {};`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_zero_ops",
      filePath: "src/app/layout.tsx",
      baseBlobSha: "sha_mock_123",
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

  it("rejects PR creation when PreparedAstChange artifact is missing (UNTRUSTED_CONTENT_BLOCKED)", async () => {
    const res = await createAutoFixPR(
      "https://github.com/owner/repo",
      [
        {
          path: "src/app/layout.tsx",
          content: "raw content without prepared change",
          description: "Test description",
        },
      ],
      "example.com",
      "gho_dummy_token",
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("UNTRUSTED_CONTENT_BLOCKED");
  });

  it("rejects PR creation when PreparedAstChange content hash mismatches (AST_INTEGRITY_FAILED)", async () => {
    const fakePreparedChange = {
      findingFingerprint: "fp_123",
      filePath: "src/app/layout.tsx",
      baseBlobSha: "sha_mock_123",
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

  it("fails closed when unsupported operation kind is passed (AST_MUTATION_UNSUPPORTED)", () => {
    const originalTsx = `export const metadata = {};`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_unsupported",
      filePath: "src/app/layout.tsx",
      baseBlobSha: "sha_mock_123",
      language: "tsx",
      operations: [
        {
          kind: "nonExistentOperationKind" as any,
        },
      ],
      rationale: "Unsupported op test",
      risk: "HIGH",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/AST_MUTATION_UNSUPPORTED/);
  });

  it("applies Robots.txt AST operations cleanly", () => {
    const originalRobots = `User-agent: *\nDisallow: /admin\n`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_robots_1",
      filePath: "public/robots.txt",
      baseBlobSha: "sha_mock_123",
      language: "robots",
      operations: [
        {
          kind: "setRobotsDirective",
          userAgent: "*",
          directive: "Disallow",
          path: "/private",
        },
      ],
      rationale: "Add disallow rule",
      risk: "SAFE",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalRobots, plan);
    expect(prepared.serializedContent).toContain("Disallow: /private");
  });

  it("applies XML AST operations cleanly", () => {
    const originalXml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_xml_1",
      filePath: "sitemap.xml",
      baseBlobSha: "sha_mock_123",
      language: "xml",
      operations: [
        {
          kind: "setXmlNode",
          targetTag: "loc",
          value: "https://example.com/updated",
        },
      ],
      rationale: "Update sitemap url",
      risk: "SAFE",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalXml, plan);
    expect(prepared.serializedContent).toContain("https://example.com/updated");
  });

  it("applies JSON AST operations cleanly", () => {
    const originalJson = `{\n  "name": "app",\n  "version": "1.0.0"\n}`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_json_1",
      filePath: "manifest.json",
      baseBlobSha: "sha_mock_123",
      language: "json",
      operations: [
        {
          kind: "setObjectProperty",
          target: "manifest",
          property: "version",
          value: "1.0.1",
        },
      ],
      rationale: "Bump version",
      risk: "SAFE",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalJson, plan);
    expect(prepared.serializedContent).toContain('"version": "1.0.1"');
  });

  it("fails closed when registerEffect throws error during PR creation", async () => {
    const spyKillSwitch = vi.spyOn(mutationsModule, "assertEffectChannelEnabled").mockResolvedValue(undefined as any);
    const spy = vi.spyOn(mutationsModule, "registerEffect").mockRejectedValue(new Error("Database connection lost"));

    const content = "const x = 1;";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const preparedChange = {
      findingFingerprint: "fp_effect_fail",
      filePath: "src/app/layout.tsx",
      baseBlobSha: "sha_mock_123",
      language: "tsx" as const,
      serializedContent: content,
      contentHash,
      unifiedDiff: "",
      astFingerprintBefore: "a",
      astFingerprintAfter: "b",
      appliedOperationsCount: 1,
    };

    const res = await createAutoFixPR(
      "https://github.com/owner/repo",
      [
        {
          path: "src/app/layout.tsx",
          content: "const x = 1;",
          description: "Test description",
          astPreparedChange: preparedChange,
        },
      ],
      "example.com",
      "gho_dummy_token",
      undefined,
      "op_12345",
      "site_12345",
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("MutationEffect registration failed");

    spyKillSwitch.mockRestore();
    spy.mockRestore();
  });

  it("throws AST_TARGET_AMBIGUOUS when multiple JSX elements match and occurrence is not specified", () => {
    const originalTsx = `export default function Gallery() {
  return (
    <div>
      <img src="/a.jpg" alt="First" />
      <img src="/b.jpg" alt="Second" />
    </div>
  );
}`;

    const planAmbiguous: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_ambig_1",
      filePath: "src/app/gallery.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setJsxAttribute",
          elementTag: "img",
          attributeName: "alt",
          value: "Updated Alt",
        },
      ],
      rationale: "Ambiguous target test",
      risk: "MEDIUM",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, planAmbiguous)).toThrow(/AST_TARGET_AMBIGUOUS/);

    const planOccurrence: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_occurrence_1",
      filePath: "src/app/gallery.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setJsxAttribute",
          elementTag: "img",
          attributeName: "alt",
          value: "Updated Second Alt",
          occurrence: 2,
        },
      ],
      rationale: "Occurrence test",
      risk: "LOW",
      verification: [],
    };

    const prepared = applyAstFixPlan(originalTsx, planOccurrence);
    expect(prepared.serializedContent).toContain('alt="First"');
    expect(prepared.serializedContent).toContain('alt="Updated Second Alt"');
  });

  it("throws AST_TARGET_AMBIGUOUS when multiple HTML elements match selector without occurrence", () => {
    const originalHtml = `<div><p>Paragraph 1</p><p>Paragraph 2</p></div>`;

    const planAmbiguous: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_html_ambig",
      filePath: "index.html",
      language: "html",
      operations: [
        {
          kind: "setHtmlAttribute",
          selector: "p",
          attributeName: "class",
          value: "highlight",
        },
      ],
      rationale: "HTML ambiguous test",
      risk: "MEDIUM",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalHtml, planAmbiguous)).toThrow(/AST_TARGET_AMBIGUOUS/);
  });

  it("aborts execution when expectedCurrentValue is set but property/attribute is missing", () => {
    const originalTsx = `export const metadata = { title: "Hello" };`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_missing_expected",
      filePath: "src/app/layout.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setObjectProperty",
          target: "metadata",
          property: "description",
          value: "New Description",
          expectedCurrentValue: "Old Description",
        },
      ],
      rationale: "Expected value missing test",
      risk: "MEDIUM",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/STALE_FIX_ABORTED/);
  });

  it("throws AST_TARGET_AMBIGUOUS when multiple property assignments match op.target", () => {
    const originalTsx = `const pageA = { settings: { theme: "dark" } };
const pageB = { settings: { theme: "light" } };`;

    const plan: AstFixPlan = {
      version: 1,
      findingFingerprint: "fp_object_ambig",
      filePath: "src/app/page.tsx",
      language: "tsx",
      operations: [
        {
          kind: "setObjectProperty",
          target: "settings",
          property: "theme",
          value: "system",
        },
      ],
      rationale: "Object ambiguous test",
      risk: "HIGH",
      verification: [],
    };

    expect(() => applyAstFixPlan(originalTsx, plan)).toThrow(/AST_TARGET_AMBIGUOUS/);
  });
});

