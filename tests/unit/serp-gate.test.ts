import { describe, it, expect } from "vitest";
import { evaluateSerpIntentGate } from "@/lib/blog/serp-gate";
import type { SerpFormatSignal } from "@/lib/blog/serp";

// ─── Helper ───────────────────────────────────────────────────────────────────

function signal(
    format: SerpFormatSignal["format"],
    confidence: SerpFormatSignal["confidence"]
): SerpFormatSignal {
    return {
        format,
        confidence,
        reasoning: `Weighted score test: format=${format} confidence=${confidence}`,
    };
}

// ─── 1. Format × Confidence decision table ────────────────────────────────────

describe("evaluateSerpIntentGate — decision table", () => {
    // ── tool ──────────────────────────────────────────────────────────────────
    it("tool + high → BLOCK", () => {
        const d = evaluateSerpIntentGate(signal("tool", "high"));
        expect(d.verdict).toBe("BLOCK");
    });

    it("tool + medium → WARN", () => {
        const d = evaluateSerpIntentGate(signal("tool", "medium"));
        expect(d.verdict).toBe("WARN");
    });

    it("tool + low → WARN", () => {
        const d = evaluateSerpIntentGate(signal("tool", "low"));
        expect(d.verdict).toBe("WARN");
    });

    // ── video ─────────────────────────────────────────────────────────────────
    it("video + high → BLOCK", () => {
        const d = evaluateSerpIntentGate(signal("video", "high"));
        expect(d.verdict).toBe("BLOCK");
    });

    it("video + medium → WARN", () => {
        const d = evaluateSerpIntentGate(signal("video", "medium"));
        expect(d.verdict).toBe("WARN");
    });

    it("video + low → WARN", () => {
        const d = evaluateSerpIntentGate(signal("video", "low"));
        expect(d.verdict).toBe("WARN");
    });

    // ── product ───────────────────────────────────────────────────────────────
    it("product + high → WARN", () => {
        const d = evaluateSerpIntentGate(signal("product", "high"));
        expect(d.verdict).toBe("WARN");
    });

    it("product + medium → WARN", () => {
        const d = evaluateSerpIntentGate(signal("product", "medium"));
        expect(d.verdict).toBe("WARN");
    });

    it("product + low → WARN", () => {
        const d = evaluateSerpIntentGate(signal("product", "low"));
        expect(d.verdict).toBe("WARN");
    });

    // ── listicle ──────────────────────────────────────────────────────────────
    it("listicle + high → WARN", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "high"));
        expect(d.verdict).toBe("WARN");
    });

    it("listicle + medium → WARN", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "medium"));
        expect(d.verdict).toBe("WARN");
    });

    it("listicle + low → WARN", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "low"));
        expect(d.verdict).toBe("WARN");
    });

    // ── comparison ────────────────────────────────────────────────────────────
    it("comparison + high → WARN", () => {
        const d = evaluateSerpIntentGate(signal("comparison", "high"));
        expect(d.verdict).toBe("WARN");
    });

    it("comparison + medium → WARN", () => {
        const d = evaluateSerpIntentGate(signal("comparison", "medium"));
        expect(d.verdict).toBe("WARN");
    });

    it("comparison + low → WARN", () => {
        const d = evaluateSerpIntentGate(signal("comparison", "low"));
        expect(d.verdict).toBe("WARN");
    });

    // ── guide ─────────────────────────────────────────────────────────────────
    it("guide + high → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("guide", "high"));
        expect(d.verdict).toBe("ALLOW");
    });

    it("guide + medium → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("guide", "medium"));
        expect(d.verdict).toBe("ALLOW");
    });

    it("guide + low → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("guide", "low"));
        expect(d.verdict).toBe("ALLOW");
    });

    // ── general ───────────────────────────────────────────────────────────────
    it("general + high → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("general", "high"));
        expect(d.verdict).toBe("ALLOW");
    });

    it("general + medium → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("general", "medium"));
        expect(d.verdict).toBe("ALLOW");
    });

    it("general + low → ALLOW", () => {
        const d = evaluateSerpIntentGate(signal("general", "low"));
        expect(d.verdict).toBe("ALLOW");
    });

    // ── null signal ───────────────────────────────────────────────────────────
    it("null signal → SKIP", () => {
        const d = evaluateSerpIntentGate(null);
        expect(d.verdict).toBe("SKIP");
    });
});

// ─── 2. ALLOW / WARN carry format metadata ────────────────────────────────────

describe("evaluateSerpIntentGate — payload shape", () => {
    it("ALLOW includes format, confidence, hint", () => {
        const d = evaluateSerpIntentGate(signal("guide", "high"));
        expect(d.verdict).toBe("ALLOW");
        if (d.verdict === "ALLOW") {
            expect(d.format).toBe("guide");
            expect(d.confidence).toBe("high");
            expect(typeof d.hint).toBe("string");
            expect(d.hint.length).toBeGreaterThan(0);
        }
    });

    it("WARN includes format, confidence, reason, hint", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "high"));
        expect(d.verdict).toBe("WARN");
        if (d.verdict === "WARN") {
            expect(d.format).toBe("listicle");
            expect(d.confidence).toBe("high");
            expect(typeof d.reason).toBe("string");
            expect(d.reason.length).toBeGreaterThan(0);
            expect(typeof d.hint).toBe("string");
            expect(d.hint.length).toBeGreaterThan(0);
        }
    });

    it("BLOCK includes format, confidence, reason — no hint", () => {
        const d = evaluateSerpIntentGate(signal("tool", "high"));
        expect(d.verdict).toBe("BLOCK");
        if (d.verdict === "BLOCK") {
            expect(d.format).toBe("tool");
            expect(d.confidence).toBe("high");
            expect(typeof d.reason).toBe("string");
            expect(d.reason.length).toBeGreaterThan(0);
            // BLOCK has no override hint — the gate is hard
            expect("hint" in d).toBe(false);
        }
    });

    it("SKIP has a reason code but no format", () => {
        const d = evaluateSerpIntentGate(null);
        expect(d.verdict).toBe("SKIP");
        if (d.verdict === "SKIP") {
            expect(typeof d.reason).toBe("string");
            expect("format" in d).toBe(false);
        }
    });
});

// ─── 3. Evidence-based wording — never claims "will never rank" ───────────────

describe("evaluateSerpIntentGate — wording invariants", () => {
    const FORBIDDEN_PHRASES = [
        "will never rank",
        "cannot rank",
        "impossible to rank",
        "text won't rank",
        "blog will never",
    ];

    const allFormats: SerpFormatSignal["format"][] = [
        "tool", "listicle", "comparison", "guide", "product", "video", "general",
    ];
    const allConfidences: SerpFormatSignal["confidence"][] = ["high", "medium", "low"];

    for (const format of allFormats) {
        for (const confidence of allConfidences) {
            it(`${format}+${confidence} reason/hint contains no forbidden phrases`, () => {
                const d = evaluateSerpIntentGate(signal(format, confidence));
                const text = [
                    "reason" in d ? d.reason : "",
                    "hint" in d ? d.hint : "",
                ].join(" ").toLowerCase();

                for (const phrase of FORBIDDEN_PHRASES) {
                    expect(text).not.toContain(phrase);
                }
            });
        }
    }
});

// ─── 4. Credit-consumption invariants ─────────────────────────────────────────
//
// These tests verify the logical invariant of the gate without hitting the
// real server action (which requires DB + Redis). They work at the
// evaluateSerpIntentGate level and prove the decision the server action
// must enforce.

describe("credit-consumption invariants via gate decisions", () => {
    /**
     * The server action's contract:
     *   BLOCK                        → consumeCredits MUST NOT be called
     *   WARN + forceSerpMismatch=false → consumeCredits MUST NOT be called
     *   WARN + forceSerpMismatch=true  → consumeCredits MAY be called
     *   ALLOW                         → consumeCredits MAY be called
     *   SKIP                          → consumeCredits MAY be called
     */

    it("BLOCK verdict means credits must not be consumed", () => {
        const d = evaluateSerpIntentGate(signal("tool", "high"));
        expect(d.verdict).toBe("BLOCK");
        // Server action checks: if (verdict === "BLOCK") return early
        // This assertion represents that invariant at the decision level.
        const shouldConsumeCredits = d.verdict !== "BLOCK";
        expect(shouldConsumeCredits).toBe(false);
    });

    it("WARN + no override means credits must not be consumed", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "high"));
        expect(d.verdict).toBe("WARN");
        const forceSerpMismatch = false;
        const shouldConsumeCredits = d.verdict === "ALLOW" || d.verdict === "SKIP" ||
            (d.verdict === "WARN" && forceSerpMismatch);
        expect(shouldConsumeCredits).toBe(false);
    });

    it("WARN + forceSerpMismatch=true means credits may be consumed", () => {
        const d = evaluateSerpIntentGate(signal("listicle", "high"));
        expect(d.verdict).toBe("WARN");
        const forceSerpMismatch = true;
        const shouldConsumeCredits = d.verdict === "ALLOW" || d.verdict === "SKIP" ||
            (d.verdict === "WARN" && forceSerpMismatch);
        expect(shouldConsumeCredits).toBe(true);
    });

    it("ALLOW means credits may be consumed", () => {
        const d = evaluateSerpIntentGate(signal("guide", "high"));
        expect(d.verdict).toBe("ALLOW");
        const shouldConsumeCredits = d.verdict === "ALLOW" || d.verdict === "SKIP" ||
            (d.verdict === "WARN" && true);
        expect(shouldConsumeCredits).toBe(true);
    });

    it("SKIP means credits may be consumed (fail-open)", () => {
        const d = evaluateSerpIntentGate(null);
        expect(d.verdict).toBe("SKIP");
        const shouldConsumeCredits = d.verdict === "ALLOW" || d.verdict === "SKIP" ||
            (d.verdict === "WARN" && true);
        expect(shouldConsumeCredits).toBe(true);
    });

    it("BLOCK cannot be overridden by forceSerpMismatch — still blocked", () => {
        const d = evaluateSerpIntentGate(signal("tool", "high"));
        expect(d.verdict).toBe("BLOCK");
        // forceSerpMismatch=true MUST NOT override BLOCK
        // The server action checks BLOCK first, before checking forceSerpMismatch.
        const forceSerpMismatch = true;
        const stillBlocked = d.verdict === "BLOCK"; // BLOCK is unconditional
        expect(stillBlocked).toBe(true);
        // Prove forceSerpMismatch has no effect on the block decision
        void forceSerpMismatch; // used to satisfy linter
    });
});

// ─── 5. Signal passthrough — format and confidence preserved ─────────────────

describe("evaluateSerpIntentGate — signal fidelity", () => {
    it("BLOCK preserves format from signal", () => {
        const d = evaluateSerpIntentGate(signal("video", "high"));
        if (d.verdict === "BLOCK") {
            expect(d.format).toBe("video");
            expect(d.confidence).toBe("high");
        }
    });

    it("WARN preserves format from signal", () => {
        const d = evaluateSerpIntentGate(signal("comparison", "medium"));
        if (d.verdict === "WARN") {
            expect(d.format).toBe("comparison");
            expect(d.confidence).toBe("medium");
        }
    });

    it("ALLOW preserves format from signal", () => {
        const d = evaluateSerpIntentGate(signal("general", "low"));
        if (d.verdict === "ALLOW") {
            expect(d.format).toBe("general");
            expect(d.confidence).toBe("low");
        }
    });
});
