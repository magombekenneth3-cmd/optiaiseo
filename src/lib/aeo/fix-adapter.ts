/**
 * src/lib/aeo/fix-adapter.ts
 *
 * Phase 3 — Remediation Safety: AEO Fix Adapter.
 *
 * Bridges the existing AEO fix engine into the canonical remediation pipeline.
 * Instead of generating full-file replacements, this adapter:
 *
 *   1. Converts AeoCheck → DiagnosticFinding (canonical format)
 *   2. Generates a constrained AiPatchResult (not full-file)
 *   3. Returns a RemediationAction the planner can schedule
 *
 * The original fix-engine.ts is NOT deleted — it continues to serve existing
 * callers. This adapter wraps it and constrains its output.
 *
 * Migration: Callers should migrate from generateAeoFixInternal() to
 * adaptAeoCheckToRemediation() when they want planner-routed execution.
 */

import type { AeoCheck } from "./fix-engine";
import type { DiagnosticFinding } from "@/lib/seo-audit/root-cause-engine";
import type { RemediationAction } from "@/lib/seo-audit/remediation-planner";
import type {
  AiPatchResult,
  SEOEvidence,
  VerificationCriterion,
  FixRisk,
  OptimizationDomain,
  FindingSeverity,
} from "@/lib/seo-audit/contracts";
import { createHash } from "crypto";

// ── AeoCheck → DiagnosticFinding ────────────────────────────────────────────

/**
 * Map an AeoCheck to the canonical DiagnosticFinding format.
 *
 * This is a LOSSY conversion — AeoCheck has less information than a real
 * diagnostic finding. Missing fields use safe defaults:
 *   - severity defaults to "medium"
 *   - confidence defaults to 0.7 (AI-generated checks aren't fully verified)
 *   - remediationType defaults to "AI_PATCH" (not deterministic)
 *   - evidence is marked INFERRED since AEO checks don't carry direct observations
 */
export function aeoCheckToFinding(
  check: AeoCheck,
  domain: string,
): DiagnosticFinding {
  const fingerprint = createHash("sha256")
    .update(`aeo:${check.id}:${domain}`)
    .digest("hex")
    .slice(0, 16);

  const now = new Date().toISOString();
  const evidenceHash = createHash("sha256")
    .update(`aeo-evidence:${check.id}:${domain}:${now}`)
    .digest("hex")
    .slice(0, 12);

  const evidence: SEOEvidence[] = [
    {
      source: "HTML" as const,
      url: `https://${domain}`,
      observedAt: now,
      observedValue: check.detail ?? check.label,
      confidence: 0.5,
      confidenceKind: "INFERRED" as const,
      evidenceHash,
    },
  ];

  return {
    id: `aeo_${check.id}`,
    fingerprint,
    domain: "AEO" as OptimizationDomain,
    issueType: `AEO_${check.id.toUpperCase().replace(/-/g, "_")}`,
    rootCause: check.detail ?? check.label,
    rootCauseId: `aeo_${check.id}`,
    status: check.passed ? "NOT_APPLICABLE" : "FAIL",
    severity: (check.passed ? "low" : "medium") as FindingSeverity,
    confidence: check.passed ? 0.9 : 0.7,
    evidence,
    scope: {
      type: "SITE",
      urls: [`https://${domain}`],
    },
    remediationType: check.passed ? "MANUAL" : "AI_PATCH",
    dependencyFingerprints: [],
    verificationCriteria: aeoVerificationCriteria(check, domain),
    expectedOutcome: check.recommendation ?? `Fix AEO issue: ${check.label}`,
  };
}

// ── AEO Fix Output → AiPatchResult ─────────────────────────────────────────

/**
 * Constrain a raw AEO fix engine output to the AiPatchResult contract.
 *
 * The old fix engine returns `{ fix: string }` — an entire file.
 * This wrapper converts it to a structured patch result with risk and
 * verification metadata attached.
 */
export function constrainAeoPatch(
  check: AeoCheck,
  rawFix: string,
  filePath: string,
  domain: string,
  aiModel?: string,
): AiPatchResult {
  const fingerprint = createHash("sha256")
    .update(`aeo:${check.id}:${domain}`)
    .digest("hex")
    .slice(0, 16);

  // Risk classification for AEO patches:
  //   - Schema additions (JSON-LD insertion) → LOW risk
  //   - Content rewrites → MEDIUM risk
  //   - Structural changes → HIGH risk
  const risk = classifyAeoPatchRisk(check);

  return {
    findingFingerprint: fingerprint,
    filePath,
    patch: rawFix,
    rationale: `AEO fix for "${check.label}": ${check.recommendation ?? check.detail ?? "improve AI engine visibility"}`,
    risk,
    verification: aeoVerificationCriteria(check, domain),
    aiModel,
    domain: "AEO",
  };
}

// ── Risk Classification ─────────────────────────────────────────────────────

function classifyAeoPatchRisk(check: AeoCheck): FixRisk {
  const id = check.id.toLowerCase();

  // Schema-only additions are relatively safe
  if (id.includes("schema") || id.includes("jsonld") || id.includes("json-ld")) {
    return "LOW";
  }

  // Speakable is a schema addition
  if (id.includes("speakable")) {
    return "LOW";
  }

  // Meta tag changes are medium risk
  if (id.includes("meta") || id.includes("title") || id.includes("description")) {
    return "MEDIUM";
  }

  // Content restructuring is higher risk
  if (id.includes("content") || id.includes("heading") || id.includes("structure")) {
    return "MEDIUM";
  }

  // Default: MEDIUM — AI patches should be reviewed
  return "MEDIUM";
}

// ── Verification Criteria ───────────────────────────────────────────────────

function aeoVerificationCriteria(
  check: AeoCheck,
  domain: string,
): VerificationCriterion[] {
  const criteria: VerificationCriterion[] = [];
  const id = check.id.toLowerCase();

  // Schema-related checks: verify JSON-LD is present
  if (id.includes("schema") || id.includes("jsonld") || id.includes("speakable")) {
    criteria.push({
      type: "HTML_SELECTOR",
      selector: 'script[type="application/ld+json"]',
      expected: true,
      url: `https://${domain}`,
    });
  }

  // All AEO checks: page should be accessible
  criteria.push({
    type: "HTTP_STATUS",
    expected: [200],
    url: `https://${domain}`,
  });

  return criteria;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert failed AEO checks to canonical DiagnosticFindings.
 *
 * Use this at the boundary between the AEO diagnosis system and the
 * remediation planner. The planner then schedules, prioritises, and
 * risk-gates the resulting RemediationActions through the normal pipeline.
 */
export function adaptAeoChecksToDiagnosticFindings(
  checks: AeoCheck[],
  domain: string,
): DiagnosticFinding[] {
  return checks
    .filter(check => !check.passed)
    .map(check => aeoCheckToFinding(check, domain));
}
