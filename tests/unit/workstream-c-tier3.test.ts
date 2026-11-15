import { describe, it, expect } from "vitest";
import { runDiagnosticPipeline } from "@/lib/seo-audit/diagnostic-engine";
import {
  extractDiagnosticFindings,
  checklistItemToEvidence,
} from "@/lib/seo-audit/evidence-collector";
import {
  DIAGNOSTIC_RULES,
  sortFindingsForRemediation,
  topologicalSort,
} from "@/lib/seo-audit/root-cause-engine";
import { buildRemediationPlan } from "@/lib/seo-audit/remediation-planner";
import {
  DETERMINISTIC_FIXES,
  tryDeterministicFix,
  type FixContext,
} from "@/lib/seo-audit/deterministic-fixes";
import {
  runTechnicalVerification,
  type VerificationFetcher,
} from "@/lib/seo-audit/verification-runner";
import { applyAstFixPlan } from "@/lib/ast/executor";
import type { AstFixPlan } from "@/lib/ast/types";
import type { AuditCategoryResult, ChecklistItem } from "@/lib/seo-audit/types";
import type { VerificationCriterion } from "@/lib/seo-audit/contracts";

const TEST_URL = "https://example.com";
const TEST_DOMAIN = "example.com";
const TEST_SITE_ID = "site-workstream-c";

function makeItem(
  id: string,
  status: ChecklistItem["status"] = "Fail",
  finding = `${id} check`,
  details?: Record<string, string | number | boolean>,
): ChecklistItem {
  return {
    id,
    label: id,
    status,
    finding,
    recommendation: { text: `Fix ${id}`, priority: "High" },
    details,
  };
}

function makeCategory(
  id: string,
  items: ChecklistItem[],
): AuditCategoryResult {
  return {
    id,
    label: id,
    items,
    score: 50,
    passed: items.filter((i) => i.status === "Pass").length,
    failed: items.filter((i) => i.status === "Fail").length,
    warnings: items.filter((i) => i.status === "Warning").length,
  };
}

describe("Workstream C (Tier 3) — Expanded Root-Cause & Remediation Engine Coverage", () => {
  describe("C1: Connect Orphaned Deterministic Fixes", () => {
    it("triggers viewport_missing, charset_missing, html_lang_missing, og_tags_missing, and robots_txt_missing without masking when co-occurring", () => {
      const categoryResults: AuditCategoryResult[] = [
        makeCategory("technical", [
          makeItem("robots-txt", "Fail", "robots.txt is missing (HTTP 404)", {
            exists: false,
          }),
          makeItem("viewport", "Fail", "Missing mobile viewport meta tag"),
          makeItem("charset", "Fail", "Missing UTF-8 charset declaration"),
          makeItem("html-lang", "Fail", "Missing lang attribute on <html> element"),
        ]),
        makeCategory("social", [
          makeItem("og-image", "Fail", "Missing og:image meta tag"),
        ]),
      ];

      const result = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 12,
        categoryResults,
      });

      const causeIds = result.findings.map((f) => f.rootCauseId);
      expect(causeIds).toEqual(
        expect.arrayContaining([
          "robots_txt_missing",
          "viewport_missing",
          "charset_missing",
          "html_lang_missing",
          "og_tags_missing",
        ]),
      );

      for (const rootCauseId of [
        "robots_txt_missing",
        "viewport_missing",
        "charset_missing",
        "html_lang_missing",
        "og_tags_missing",
      ]) {
        expect(DETERMINISTIC_FIXES[rootCauseId]).toBeDefined();
        const action = result.plan.actions.find(
          (a) => a.rootCauseId === rootCauseId,
        );
        expect(action).toBeDefined();
        expect(action?.remediationType).toBe("DETERMINISTIC");
        expect(action?.deterministicFix).toBeDefined();
      }
    });

    it("enforces EVIDENCE_QUALITY_GATES downgrade from DETERMINISTIC to AI_PATCH when charset/og_tags only emit Warning (DERIVED)", () => {
      const result = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 5,
        categoryResults: [
          makeCategory("technical", [
            makeItem("charset", "Warning", "Charset tag should be declared explicitly"),
          ]),
          makeCategory("social", [
            makeItem("og-title", "Warning", "Open Graph title tag is incomplete"),
          ]),
        ],
      });

      const charsetAction = result.plan.actions.find(
        (a) => a.rootCauseId === "charset_missing",
      );
      const ogAction = result.plan.actions.find(
        (a) => a.rootCauseId === "og_tags_missing",
      );

      expect(charsetAction).toBeDefined();
      expect(charsetAction?.remediationType).toBe("AI_PATCH");
      expect(charsetAction?.deterministicFix).toBeUndefined();

      expect(ogAction).toBeDefined();
      expect(ogAction?.remediationType).toBe("AI_PATCH");
      expect(ogAction?.deterministicFix).toBeUndefined();
    });

    it("keeps DIAGNOSTIC_RULES dependency graph topologically sortable with blockers before dependents", () => {
      const ruleKeys = Object.keys(DIAGNOSTIC_RULES);
      const sorted = topologicalSort(ruleKeys);
      expect(sorted.length).toBe(ruleKeys.length);
      expect(new Set(sorted).size).toBe(ruleKeys.length);

      const indexingIdx = sorted.indexOf("INDEXING_BLOCKED");
      expect(indexingIdx).toBeGreaterThanOrEqual(0);
      expect(sorted.indexOf("ONPAGE_TITLE_MISSING")).toBeGreaterThan(indexingIdx);
      expect(sorted.indexOf("ONPAGE_DESCRIPTION_MISSING")).toBeGreaterThan(indexingIdx);
      expect(sorted.indexOf("ONPAGE_H1_DEFECT")).toBeGreaterThan(indexingIdx);
    });
  });

  describe("C2: On-Page, Broken Links, CWV, AEO & Cannibalization Rules", () => {
    it("diagnoses co-occurring on-page metadata defects (title_missing, meta_description_missing, h1_missing) independently", () => {
      const result = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 10,
        categoryResults: [
          makeCategory("onpage", [
            makeItem("title-tag", "Fail", "Missing <title> tag", { length: 0 }),
            makeItem("meta-description", "Fail", "Missing meta description", {
              length: 0,
            }),
            makeItem("h1-tag", "Fail", "No <h1> heading found on page", {
              count: 0,
            }),
          ]),
        ],
      });

      const causes = result.findings.map((f) => f.rootCauseId);
      expect(causes).toEqual(
        expect.arrayContaining([
          "title_missing",
          "meta_description_missing",
          "h1_missing",
        ]),
      );

      const titleFinding = result.findings.find(
        (f) => f.rootCauseId === "title_missing",
      );
      const descFinding = result.findings.find(
        (f) => f.rootCauseId === "meta_description_missing",
      );
      const h1Finding = result.findings.find(
        (f) => f.rootCauseId === "h1_missing",
      );

      expect(titleFinding?.severity).toBe("critical");
      expect(titleFinding?.remediationType).toBe("AI_PATCH");
      expect(descFinding?.severity).toBe("high");
      expect(descFinding?.remediationType).toBe("AI_PATCH");
      expect(h1Finding?.severity).toBe("high");
      expect(h1Finding?.remediationType).toBe("AI_PATCH");
    });

    it("distinguishes h1_multiple (MANUAL, medium) from h1_missing", () => {
      const { findings } = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("onpage", [
          makeItem("h1-tag", "Warning", "Multiple <h1> headings found", {
            count: 3,
          }),
        ]),
      ]);

      expect(findings.map((f) => f.rootCauseId)).toContain("h1_multiple");
      expect(findings.map((f) => f.rootCauseId)).not.toContain("h1_missing");
      const multi = findings.find((f) => f.rootCauseId === "h1_multiple");
      expect(multi?.remediationType).toBe("MANUAL");
      expect(multi?.severity).toBe("medium");
    });

    it("distinguishes broken_internal_links_critical (>=3) and broken_internal_links_minor (1-2)", () => {
      const critical = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("technical", [
          makeItem("broken-internal-links", "Fail", "4 broken internal links", {
            brokenCount: 4,
          }),
        ]),
      ]);
      expect(critical.findings.map((f) => f.rootCauseId)).toContain(
        "broken_internal_links_critical",
      );
      expect(
        critical.findings.find(
          (f) => f.rootCauseId === "broken_internal_links_critical",
        )?.severity,
      ).toBe("high");

      const minor = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("technical", [
          makeItem("broken-internal-links", "Warning", "2 broken internal links", {
            brokenCount: 2,
          }),
        ]),
      ]);
      expect(minor.findings.map((f) => f.rootCauseId)).toContain(
        "broken_internal_links_minor",
      );
      expect(
        minor.findings.find(
          (f) => f.rootCauseId === "broken_internal_links_minor",
        )?.severity,
      ).toBe("medium");
    });

    it("fixes lcp_hero_lazy_loaded deterministically and applies valid HTML AST operations", () => {
      const result = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 10,
        categoryResults: [
          makeCategory("performance", [
            makeItem(
              "lcp-hero-image",
              "Fail",
              "Hero LCP image has loading='lazy'",
              { loading: "lazy", heroSrc: "/images/hero.webp" },
            ),
            makeItem(
              "render-blocking-scripts",
              "Warning",
              "2 render-blocking scripts in <head>",
              { blockingScriptCount: 2 },
            ),
            makeItem("core-web-vitals-lcp", "Fail", "Lab LCP is 4.8s", {
              labLcpMs: 4800,
            }),
            makeItem("core-web-vitals-cls", "Fail", "Lab CLS is 0.32", {
              labCls: 0.32,
            }),
          ]),
        ],
      });

      const causes = result.findings.map((f) => f.rootCauseId);
      expect(causes).toEqual(
        expect.arrayContaining([
          "lcp_hero_lazy_loaded",
          "render_blocking_head_scripts",
          "lcp_poor",
          "cls_poor",
        ]),
      );

      const heroAction = result.plan.actions.find(
        (a) => a.rootCauseId === "lcp_hero_lazy_loaded",
      );
      expect(heroAction?.remediationType).toBe("DETERMINISTIC");
      expect(heroAction?.deterministicFix).toBeDefined();

      const ctx: FixContext = {
        url: TEST_URL,
        domain: TEST_DOMAIN,
      };
      const directFix = tryDeterministicFix("lcp_hero_lazy_loaded", ctx);
      expect(directFix).not.toBeNull();
      expect(directFix?.astOperations?.length).toBeGreaterThanOrEqual(2);

      const htmlBefore = `<main><img class="hero" src="/images/hero.webp" loading="lazy" alt="Hero"></main>`;
      const plan: AstFixPlan = {
        version: 1,
        findingFingerprint: heroAction!.findingFingerprint,
        filePath: "index.html",
        language: "html",
        operations: directFix!.astOperations!,
        rationale: directFix!.description,
        risk: "SAFE",
        verification: directFix!.verification,
      };
      const applied = applyAstFixPlan(htmlBefore, plan);
      expect(applied.astFingerprintAfter).not.toBe(applied.astFingerprintBefore);
      expect(applied.serializedContent).not.toContain('loading="lazy"');
      expect(applied.serializedContent).toContain('fetchpriority="high"');
    });

    it("routes AEO rules to AI_VISIBILITY source and generates valid starter public/llms.txt", () => {
      const botItem = makeItem(
        "ai-bot-robots",
        "Fail",
        "GPTBot and ClaudeBot are blocked in robots.txt",
        { blockedBots: "GPTBot, ClaudeBot", blockedCount: 2 },
      );
      const botEvidence = checklistItemToEvidence(botItem, TEST_URL);
      expect(botEvidence.source).toBe("AI_VISIBILITY");

      const missingLlmsResult = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 10,
        categoryResults: [
          makeCategory("technical", [
            botItem,
            makeItem("llms-txt", "Fail", "Missing /llms.txt file", {
              exists: false,
              quality: "missing",
            }),
          ]),
        ],
      });

      const causes = missingLlmsResult.findings.map((f) => f.rootCauseId);
      expect(causes).toEqual(
        expect.arrayContaining([
          "ai_crawlers_blocked_robots",
          "llms_txt_missing",
        ]),
      );

      const botAction = missingLlmsResult.plan.actions.find(
        (a) => a.rootCauseId === "ai_crawlers_blocked_robots",
      );
      expect(botAction?.remediationType).toBe("AI_PATCH");

      const llmsAction = missingLlmsResult.plan.actions.find(
        (a) => a.rootCauseId === "llms_txt_missing",
      );
      expect(llmsAction?.remediationType).toBe("DETERMINISTIC");
      const generated = llmsAction?.deterministicFix?.patch ?? "";
      expect(generated.length).toBeGreaterThan(80);
      expect(generated).toMatch(/^>\s?https?:\/\//m);
      const links = generated.match(/^- \[.+\]\(.+\)/gm) ?? [];
      expect(links.length).toBeGreaterThanOrEqual(3);

      const partialLlms = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("technical", [
          makeItem("llms-txt", "Warning", "/llms.txt lacks page links", {
            exists: true,
            quality: "partial",
          }),
        ]),
      ]);
      expect(partialLlms.findings.map((f) => f.rootCauseId)).toContain(
        "llms_txt_partial",
      );
      expect(
        partialLlms.findings.find((f) => f.rootCauseId === "llms_txt_partial")
          ?.remediationType,
      ).toBe("AI_PATCH");
    });

    it("distinguishes high_cannibalization_risk (>=70, EXPERIMENT) and moderate_cannibalization_risk (30-69, MANUAL)", () => {
      const highRes = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("keywords", [
          makeItem(
            "keyword-cannibalization",
            "Fail",
            "Severe cannibalization across 4 URLs",
            { riskScore: 75, overlappingQueries: 4 },
          ),
        ]),
      ]);
      expect(highRes.evidence[0].source).toBe("GSC");
      const highFinding = highRes.findings.find(
        (f) => f.rootCauseId === "high_cannibalization_risk",
      );
      expect(highFinding).toBeDefined();
      expect(highFinding?.remediationType).toBe("EXPERIMENT");
      expect(highFinding?.severity).toBe("high");

      const modRes = extractDiagnosticFindings(TEST_SITE_ID, TEST_URL, [
        makeCategory("keywords", [
          makeItem(
            "keyword-cannibalization",
            "Warning",
            "Moderate keyword overlap across 2 URLs",
            { riskScore: 45, overlappingQueries: 2 },
          ),
        ]),
      ]);
      const modFinding = modRes.findings.find(
        (f) => f.rootCauseId === "moderate_cannibalization_risk",
      );
      expect(modFinding).toBeDefined();
      expect(modFinding?.remediationType).toBe("MANUAL");
      expect(modFinding?.severity).toBe("medium");
    });

    it("calibrates searchImpact weights so aeo_readiness_ai_bots uses 0.70 rather than blocked=1.0", () => {
      const result = runDiagnosticPipeline({
        siteId: TEST_SITE_ID,
        url: TEST_URL,
        domain: TEST_DOMAIN,
        totalPages: 10,
        categoryResults: [
          makeCategory("technical", [
            makeItem("ai-bot-robots", "Fail", "AI bots blocked", {
              blockedCount: 2,
            }),
            makeItem("llms-txt", "Fail", "Missing llms.txt", {
              exists: false,
              quality: "missing",
            }),
          ]),
          makeCategory("onpage", [
            makeItem("title-tag", "Fail", "Missing title", { length: 0 }),
          ]),
        ],
      });

      const sorted = sortFindingsForRemediation(result.findings);
      expect(sorted.length).toBe(result.findings.length);

      const plan = buildRemediationPlan(result.findings, {
        url: TEST_URL,
        domain: TEST_DOMAIN,
        siteId: TEST_SITE_ID,
        totalPages: 10,
      });
      const titleAction = plan.actions.find(
        (a) => a.rootCauseId === "title_missing",
      );
      const aiBotAction = plan.actions.find(
        (a) => a.rootCauseId === "ai_crawlers_blocked_robots",
      );
      expect(titleAction).toBeDefined();
      expect(aiBotAction).toBeDefined();
      expect(aiBotAction!.priority.components.searchImpact).toBe(0.7);
      expect(titleAction!.priority.components.searchImpact).toBe(0.8);
      expect(aiBotAction!.priority.score).toBeGreaterThan(0);
    });
  });

  describe("False-Positive Guards & Verification Runner Evaluators", () => {
    it("emits zero Workstream C findings for healthy Pass items, Info GSC/timeout items, Warning CWV, robots fetch failures, and directive fixtures", () => {
      const healthyAndNeutral: AuditCategoryResult[] = [
        makeCategory("technical", [
          makeItem("robots-txt", "Pass", "robots.txt exists", { exists: true }),
          makeItem(
            "robots-directive-check",
            "Fail",
            "Page blocked by robots directive",
            { urlBlocked: true, validXml: false },
          ),
          makeItem(
            "broken-internal-links",
            "Info",
            "Crawl skipped due to timeout",
          ),
          makeItem("ai-bot-robots", "Warning", "Could not fetch robots.txt", {}),
          makeItem("llms-txt", "Pass", "/llms.txt is complete", {
            exists: true,
            quality: "complete",
          }),
          makeItem("viewport", "Pass", "Viewport tag present"),
          makeItem("charset", "Pass", "UTF-8 charset declared"),
          makeItem("html-lang", "Pass", "lang attribute present"),
        ]),
        makeCategory("onpage", [
          makeItem("title-tag", "Pass", "Title length optimal", { length: 48 }),
          makeItem("meta-description", "Pass", "Meta description optimal", {
            length: 140,
          }),
          makeItem("h1-tag", "Pass", "Single descriptive H1", { count: 1 }),
        ]),
        makeCategory("performance", [
          makeItem("core-web-vitals-lcp", "Warning", "Lab LCP needs improvement", {
            labLcpMs: 3000,
          }),
          makeItem("core-web-vitals-cls", "Warning", "Lab CLS needs improvement", {
            labCls: 0.15,
          }),
          makeItem("lcp-hero-image", "Pass", "Hero image loads eagerly", {
            loading: "eager",
          }),
        ]),
        makeCategory("keywords", [
          makeItem("keyword-cannibalization", "Info", "GSC not connected"),
        ]),
      ];

      const { findings } = extractDiagnosticFindings(
        TEST_SITE_ID,
        TEST_URL,
        healthyAndNeutral,
      );

      const workstreamCCauses = [
        "robots_txt_missing",
        "viewport_missing",
        "charset_missing",
        "html_lang_missing",
        "og_tags_missing",
        "title_missing",
        "meta_description_missing",
        "h1_missing",
        "h1_multiple",
        "broken_internal_links_critical",
        "broken_internal_links_minor",
        "lcp_hero_lazy_loaded",
        "render_blocking_head_scripts",
        "lcp_poor",
        "cls_poor",
        "ai_crawlers_blocked_robots",
        "llms_txt_missing",
        "llms_txt_partial",
        "high_cannibalization_risk",
        "moderate_cannibalization_risk",
      ];

      const triggered = findings.map((f) => f.rootCauseId);
      for (const c of workstreamCCauses) {
        expect(triggered).not.toContain(c);
      }
    });

    it("verifies nonEmpty HTML selectors, hero image fetchpriority, and /llms.txt HTTP 200 in verification-runner", async () => {
      const criteria: VerificationCriterion[] = [
        {
          type: "HTML_SELECTOR",
          selector: "title",
          expected: { exists: true, nonEmpty: true },
        },
        {
          type: "HTML_SELECTOR",
          selector: 'meta[name="description"]',
          expected: { exists: true, nonEmpty: true },
        },
        {
          type: "HTML_SELECTOR",
          selector: "h1",
          expected: { exists: true, nonEmpty: true },
        },
        {
          type: "HTML_SELECTOR",
          selector: 'img[fetchpriority="high"]:not([loading="lazy"])',
          expected: { exists: true },
        },
        {
          type: "HTTP_STATUS",
          url: "/llms.txt",
          expected: 200,
        },
      ];

      const passingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Example Page Title</title>
  <meta name="description" content="Concise description of example page.">
</head>
<body>
  <h1>Main Heading</h1>
  <img src="/hero.webp" fetchpriority="high" alt="Hero">
</body>
</html>`;

      const emptyTagHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>   </title>
  <meta name="description" content="">
</head>
<body>
  <h1></h1>
  <img src="/hero.webp" loading="lazy" alt="Hero">
</body>
</html>`;

      const passFetcher: VerificationFetcher = {
        fetchHtml: async () => passingHtml,
        fetchHeaders: async () => ({}),
        getStatus: async (url) => (url.endsWith("/llms.txt") ? 200 : 404),
      };

      const failFetcher: VerificationFetcher = {
        fetchHtml: async () => emptyTagHtml,
        fetchHeaders: async () => ({}),
        getStatus: async (url) => (url.endsWith("/llms.txt") ? 404 : 200),
      };

      const passRes = await runTechnicalVerification(
        TEST_URL,
        criteria,
        passFetcher,
      );
      expect(passRes.outcome).toBe("TECHNICALLY_VERIFIED");
      expect(passRes.passedCount).toBe(5);

      const failRes = await runTechnicalVerification(
        TEST_URL,
        criteria,
        failFetcher,
      );
      expect(failRes.outcome).toBe("PENDING");
      expect(failRes.passedCount).toBe(0);
      expect(failRes.criteria.every((c) => !c.passed)).toBe(true);
    });
  });
});
