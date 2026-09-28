/**
 * src/lib/seo-audit/diagnostic-engine.ts
 *
 * Public API for the evidence-driven diagnostic engine.
 *
 * This module orchestrates the full pipeline:
 *   1. Collect evidence (from audit modules or passive extraction)
 *   2. Diagnose root causes (via DIAGNOSTIC_RULES)
 *   3. Prioritize findings (via priority-v4)
 *   4. Plan remediation (deterministic → AI → manual)
 *   5. Fingerprint and deduplicate across runs
 *
 * Usage:
 *   import { runDiagnosticPipeline } from "@/lib/seo-audit/diagnostic-engine";
 *
 *   const result = runDiagnosticPipeline({
 *     siteId, url, domain, totalPages,
 *     categoryResults,        // from the existing audit engine
 *     fixContext: { title, metaDescription },
 *   });
 *
 *   // result.findings        → DiagnosticFinding[]
 *   // result.plan            → RemediationPlan
 *   // result.evidence        → SEOEvidence[]
 */

import type { AuditCategoryResult } from "./types";
import type { DiagnosticFinding, SEOEvidence } from "./diagnostic-types";
import type { RemediationPlan } from "./remediation-planner";
import type { FixContext } from "./deterministic-fixes";

import { extractDiagnosticFindings } from "./evidence-collector";
import { buildRemediationPlan } from "./remediation-planner";
import { computePriorityV4, fixabilityForRemediation, recencyScore, scopeScore } from "./prioritization";

// ── Pipeline Input ──────────────────────────────────────────────────────────

export interface DiagnosticPipelineInput {
  siteId: string;
  url: string;
  domain: string;
  totalPages: number;
  /** Category results from the existing audit engine */
  categoryResults: AuditCategoryResult[];
  /** Additional context for fix generation */
  fixContext?: Partial<FixContext>;
}

// ── Pipeline Output ─────────────────────────────────────────────────────────

export interface DiagnosticPipelineResult {
  /** All diagnostic findings (deduplicated) */
  findings: DiagnosticFinding[];
  /** All evidence collected during the audit */
  evidence: SEOEvidence[];
  /** Ordered remediation plan */
  plan: RemediationPlan;
  /** Pipeline metadata */
  meta: {
    pipelineVersion: string;
    findingsCount: number;
    evidenceCount: number;
    actionsCount: number;
    deterministicFixCount: number;
    /** Time taken to run the diagnostic pipeline (ms) */
    durationMs: number;
  };
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Run the full evidence-driven diagnostic pipeline.
 *
 * This is the main entry point. It takes the raw audit category results
 * and produces a prioritized, deduplicated, dependency-ordered remediation plan.
 */
export function runDiagnosticPipeline(
  input: DiagnosticPipelineInput,
): DiagnosticPipelineResult {
  const t0 = performance.now();

  // Step 1: Extract evidence and findings from category results
  const { findings, evidence } = extractDiagnosticFindings(
    input.siteId,
    input.url,
    input.categoryResults,
  );

  // Step 2: Build remediation plan
  const plan = buildRemediationPlan(findings, {
    siteId: input.siteId,
    url: input.url,
    domain: input.domain,
    totalPages: input.totalPages,
    fixContext: input.fixContext,
  });

  const durationMs = Math.round(performance.now() - t0);

  return {
    findings,
    evidence,
    plan,
    meta: {
      pipelineVersion: "diagnostic-v1",
      findingsCount: findings.length,
      evidenceCount: evidence.length,
      actionsCount: plan.actions.length,
      deterministicFixCount: plan.summary.deterministic,
      durationMs,
    },
  };
}

// ── Re-exports ──────────────────────────────────────────────────────────────

// Core types
export type {
  SEOEvidence,
  EvidenceSource,
  DiagnosticFinding,
  DiagnosticStatus,
  FindingSeverity,
  FindingScope,
  RemediationType,
  VerificationCriterion,
} from "./diagnostic-types";

export {
  createEvidence,
  computeEvidenceHash,
  computeFindingFingerprint,
  aggregateEvidenceConfidence,
} from "./diagnostic-types";

// Prioritization
export {
  computePriorityV4,
  computePriorityLegacy,
  fixabilityForRemediation,
  recencyScore,
  scopeScore,
  PRIORITIZATION_POLICY_VERSION,
} from "./prioritization";
export type { PriorityComponents, ExplainablePriority } from "./prioritization";

// Root cause engine
export { diagnose, topologicalSort, sortFindingsForRemediation, DIAGNOSTIC_RULES } from "./root-cause-engine";
export type { DiagnosticRule, RootCause, EvidenceCondition } from "./root-cause-engine";

// Evidence collector
export { EvidenceCollector, extractDiagnosticFindings, checklistItemToEvidence } from "./evidence-collector";
export type { EvidenceAwareResult } from "./evidence-collector";

// Deterministic fixes
export { tryDeterministicFix, hasDeterministicFix, DETERMINISTIC_FIXES } from "./deterministic-fixes";
export type { FixResult, FixContext } from "./deterministic-fixes";

// Remediation planner
export { buildRemediationPlan, getExecutableActions, partitionByType } from "./remediation-planner";
export type { RemediationPlan, RemediationAction, RemediationStatus } from "./remediation-planner";

// Verification outcomes (from mutations)
export type { VerificationOutcome, VerificationWindow } from "../mutations/types";
export { VALID_VERIFICATION_TRANSITIONS } from "../mutations/types";
