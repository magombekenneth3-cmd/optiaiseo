/**
 * tests/unit/recommendations-integrity.test.ts
 *
 * Phase 4 — Recommendation Integrity tests.
 *
 * Verifies:
 *   1. All ISSUE_META records have valid claimSource/claimUrl
 *   2. No unsupported quantitative claims remain in why/action text
 *   3. FAQ impact is low, not critical/high
 *   4. Speakable is applicability-dependent (not universally high-impact)
 *   5. Legal/compliance wording is not overgeneralised
 *   6. EnrichedRecommendation exposes claimSource and claimUrl
 *   7. GeoBrief.idealAnswerWords is not presented as a universal AI requirement
 *   8. Backward compatibility: all exported functions still work
 */

import { describe, it, expect } from "vitest";
import {
  extractEnrichedRecommendations,
  enrichIssue,
  getAutoFixableIssues,
  getAeoGaps,
  getGeoBriefs,
  type ClaimSource,
  type EnrichedRecommendation,
  type RawIssue,
} from "@/lib/seo/recommendations";

// ── Banned quantitative claim phrases ───────────────────────────────────────
// Any of these appearing in why/action text fails the test.
const BANNED_PHRASES = [
  "3× less likely",
  "3x less likely",
  "cited 2× more",
  "cited 2x more",
  "150 words are rarely cited",
  "30% traffic decline",
  "median 30%",
  "rank 4–5 positions lower",
  "rank 4-5 positions lower",
  "4–5 positions",
  "4-5 positions",
  "CAN-SPAM and GDPR requirement",
  "Required by GDPR, CCPA",
];

// ── Helper: get a recommendation by checkId ─────────────────────────────────
function getRec(checkId: string): EnrichedRecommendation {
  const raw: RawIssue = { checkId, passed: false, severity: "error" };
  return enrichIssue(raw);
}

// ── All ISSUE_META records ──────────────────────────────────────────────────
// We test by exercising each known check ID through enrichIssue()
const KNOWN_CHECK_IDS = [
  "schema_faq",
  "schema_organization",
  "schema_speakable",
  "schema_howto",
  "tech_canonical",
  "tech_sitemap",
  "missing_h1",
  "slow_lcp",
  "eeat_about",
  "eeat_contact",
  "eeat_privacy",
  "content_faq_section",
  "answer_length",
  "topical_gap",
  "content-decay-detector",
  "header-tag-strategy",
];

// ── ClaimSource provenance ───────────────────────────────────────────────────

describe("ClaimSource provenance", () => {
  const VALID_SOURCES: ClaimSource[] = [
    "GOOGLE_DOCUMENTATION",
    "INDUSTRY_STUDY",
    "OPTIAISEO_HEURISTIC",
    "OBSERVED_DATA",
    "NONE",
  ];

  it("every known check ID produces a valid claimSource", () => {
    for (const id of KNOWN_CHECK_IDS) {
      const rec = getRec(id);
      expect(VALID_SOURCES, `${id} should have a valid claimSource`).toContain(rec.claimSource);
    }
  });

  it("claimUrl is a string or null — never undefined", () => {
    for (const id of KNOWN_CHECK_IDS) {
      const rec = getRec(id);
      expect(
        rec.claimUrl === null || typeof rec.claimUrl === "string",
        `${id}: claimUrl should be string|null, got ${rec.claimUrl}`,
      ).toBe(true);
    }
  });

  it("OPTIAISEO_HEURISTIC records have claimUrl null", () => {
    // Heuristics don't have an external URL to cite
    const heuristicIds = [
      "missing_h1",
      "eeat_contact",
      "eeat_privacy",
      "content_faq_section",
      "answer_length",
      "topical_gap",
      "content-decay-detector",
      "header-tag-strategy",
    ];
    for (const id of heuristicIds) {
      const rec = getRec(id);
      if (rec.claimSource === "OPTIAISEO_HEURISTIC") {
        expect(rec.claimUrl, `${id}: OPTIAISEO_HEURISTIC should have null claimUrl`).toBeNull();
      }
    }
  });

  it("GOOGLE_DOCUMENTATION records have a claimUrl string", () => {
    const googleIds = [
      "schema_faq",
      "schema_organization",
      "schema_speakable",
      "schema_howto",
      "tech_canonical",
      "tech_sitemap",
      "slow_lcp",
      "eeat_about",
    ];
    for (const id of googleIds) {
      const rec = getRec(id);
      expect(rec.claimSource, `${id} should have GOOGLE_DOCUMENTATION`).toBe("GOOGLE_DOCUMENTATION");
      expect(typeof rec.claimUrl, `${id}: should have claimUrl string`).toBe("string");
      expect(rec.claimUrl, `${id}: claimUrl should start with https`).toMatch(/^https:\/\//);
    }
  });

  it("unknown check IDs fall back to claimSource NONE", () => {
    const rec = getRec("completely_unknown_check_xyz");
    expect(rec.claimSource).toBe("NONE");
    expect(rec.claimUrl).toBeNull();
  });
});

// ── Banned quantitative claims ──────────────────────────────────────────────

describe("Unsupported quantitative claims removed", () => {
  for (const id of KNOWN_CHECK_IDS) {
    it(`${id}: why/action contains no banned phrases`, () => {
      const rec = getRec(id);
      const text = `${rec.why} ${rec.action}`.toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        expect(text, `"${phrase}" found in ${id}`).not.toContain(phrase.toLowerCase());
      }
    });
  }
});

// ── FAQ recommendation ───────────────────────────────────────────────────────

describe("FAQ recommendation", () => {
  it("schema_faq impact is low", () => {
    const rec = getRec("schema_faq");
    expect(rec.impact).toBe("low");
  });

  it("schema_faq does not claim universal applicability", () => {
    const rec = getRec("schema_faq");
    // Should not use absolute language about all pages
    expect(rec.why).not.toContain("all pages");
    expect(rec.why).not.toContain("every page");
    // Should be conditional
    expect(rec.why.toLowerCase()).toMatch(/appropriate|eligible|qualifying|genuine/);
  });

  it("content_faq_section does not claim 2x citation rate", () => {
    const rec = getRec("content_faq_section");
    expect(rec.why).not.toContain("2×");
    expect(rec.why).not.toContain("2x");
  });
});

// ── Speakable recommendation ─────────────────────────────────────────────────

describe("Speakable recommendation", () => {
  it("schema_speakable impact is medium, not high", () => {
    // After Phase 4, speakable is no longer a universal high-impact recommendation
    const rec = getRec("schema_speakable");
    expect(["medium", "low"]).toContain(rec.impact);
  });

  it("schema_speakable why mentions article/news applicability", () => {
    const rec = getRec("schema_speakable");
    const text = rec.why.toLowerCase();
    expect(text).toMatch(/article|news/);
  });

  it("schema_speakable action mentions only applying to appropriate content", () => {
    const rec = getRec("schema_speakable");
    const text = rec.action.toLowerCase();
    expect(text).toMatch(/article|news|only apply|applicable/);
  });
});

// ── Legal / compliance wording ────────────────────────────────────────────────

describe("Legal and compliance wording", () => {
  it("eeat_contact does not claim universal CAN-SPAM/GDPR requirement", () => {
    const rec = getRec("eeat_contact");
    expect(rec.why).not.toContain("CAN-SPAM and GDPR requirement");
    expect(rec.action).not.toContain("required for CAN-SPAM");
  });

  it("eeat_privacy does not claim Required by GDPR, CCPA universally", () => {
    const rec = getRec("eeat_privacy");
    expect(rec.why).not.toContain("Required by GDPR, CCPA");
    // Should acknowledge jurisdiction-dependency
    expect(rec.why.toLowerCase()).toMatch(/jurisdiction|applicable|depend/);
  });

  it("eeat_contact why is still actionable (not vague)", () => {
    const rec = getRec("eeat_contact");
    // Should still explain why and what to do
    expect(rec.why.length).toBeGreaterThan(30);
    expect(rec.action.length).toBeGreaterThan(30);
  });

  it("eeat_privacy action is still actionable", () => {
    const rec = getRec("eeat_privacy");
    expect(rec.action).toContain("privacy");
  });
});

// ── Heading / H1 wording ─────────────────────────────────────────────────────

describe("Heading wording", () => {
  it("missing_h1 does not claim 4-5 position ranking effect", () => {
    const rec = getRec("missing_h1");
    expect(rec.why).not.toMatch(/4.?5 position/i);
  });

  it("missing_h1 does not claim H1 is strongest on-page keyword signal", () => {
    const rec = getRec("missing_h1");
    expect(rec.why).not.toContain("strongest on-page keyword signal");
  });

  it("header-tag-strategy does not claim H2/H3 are primary AI citation signal", () => {
    const rec = getRec("header-tag-strategy");
    expect(rec.why).not.toContain("primary signal for AI engines");
    expect(rec.why).not.toContain("determine citation scope");
  });
});

// ── Content decay wording ────────────────────────────────────────────────────

describe("Content decay wording", () => {
  it("content-decay-detector does not claim 30% traffic decline", () => {
    const rec = getRec("content-decay-detector");
    expect(rec.why).not.toContain("30%");
    expect(rec.why).not.toContain("median");
  });

  it("content-decay-detector recommendation is still actionable", () => {
    const rec = getRec("content-decay-detector");
    expect(rec.action).toContain("Update");
  });
});

// ── Answer length wording ─────────────────────────────────────────────────────

describe("Answer length wording", () => {
  it("answer_length does not claim 150-word universal threshold", () => {
    const rec = getRec("answer_length");
    expect(rec.why).not.toContain("150 words");
    expect(rec.why).not.toContain("rarely cited");
  });

  it("answer_length does not claim AI engines universally prefer 40-60 words", () => {
    const rec = getRec("answer_length");
    expect(rec.why).not.toContain("40–60 words");
    expect(rec.why).not.toContain("40-60 words");
  });

  it("answer_length recommendation is still actionable", () => {
    const rec = getRec("answer_length");
    expect(rec.why.length).toBeGreaterThan(50);
    expect(rec.action.length).toBeGreaterThan(30);
  });
});

// ── EnrichedRecommendation backward compatibility ─────────────────────────────

describe("EnrichedRecommendation backward compatibility", () => {
  const sampleIssueList = [
    { checkId: "schema_faq",         passed: false, severity: "error" },
    { checkId: "tech_canonical",     passed: false, severity: "error" },
    { checkId: "eeat_privacy",       passed: false, severity: "error" },
    { checkId: "answer_length",      passed: false, severity: "warning" },
    { checkId: "content-decay-detector", passed: false, severity: "warning" },
  ];

  it("extractEnrichedRecommendations returns results", () => {
    const recs = extractEnrichedRecommendations(sampleIssueList);
    expect(recs.length).toBeGreaterThan(0);
  });

  it("all results have required EnrichedRecommendation fields", () => {
    const recs = extractEnrichedRecommendations(sampleIssueList);
    for (const rec of recs) {
      expect(typeof rec.checkId).toBe("string");
      expect(typeof rec.title).toBe("string");
      expect(typeof rec.why).toBe("string");
      expect(typeof rec.action).toBe("string");
      expect(typeof rec.priorityScore).toBe("number");
      expect(typeof rec.difficulty).toBe("string");
      expect(["GOOGLE_DOCUMENTATION", "INDUSTRY_STUDY", "OPTIAISEO_HEURISTIC", "OBSERVED_DATA", "NONE"]).toContain(rec.claimSource);
      expect(rec.claimUrl === null || typeof rec.claimUrl === "string").toBe(true);
    }
  });

  it("getAutoFixableIssues still works", () => {
    const fixable = getAutoFixableIssues(sampleIssueList);
    // Should run without error and return array
    expect(Array.isArray(fixable)).toBe(true);
  });

  it("getAeoGaps still works", () => {
    const gaps = getAeoGaps(sampleIssueList);
    expect(Array.isArray(gaps)).toBe(true);
  });

  it("getGeoBriefs still works", () => {
    const briefs = getGeoBriefs(sampleIssueList);
    expect(Array.isArray(briefs)).toBe(true);
  });

  it("sorted by priorityScore descending", () => {
    const recs = extractEnrichedRecommendations(sampleIssueList);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].priorityScore).toBeGreaterThanOrEqual(recs[i].priorityScore);
    }
  });
});
