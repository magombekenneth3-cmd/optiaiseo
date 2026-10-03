import type { AuditCategoryResult } from "./types";
import type { SEOEvidence } from "./contracts";
import type { RemediationPlan } from "./remediation-planner";
import type { FixContext } from "./deterministic-fixes";
import type { DiagnosticFinding } from "./root-cause-engine";

import { extractDiagnosticFindings } from "./evidence-collector";
import { buildRemediationPlan } from "./remediation-planner";

export interface DiagnosticPipelineInput {
  siteId: string;
  url: string;
  domain: string;
  totalPages: number;
  categoryResults: AuditCategoryResult[];
  fixContext?: Partial<FixContext>;
}

export interface DiagnosticPipelineResult {
  findings: DiagnosticFinding[];
  evidence: SEOEvidence[];
  plan: RemediationPlan;
  meta: {
    pipelineVersion: string;
    findingsCount: number;
    evidenceCount: number;
    actionsCount: number;
    deterministicFixCount: number;
    durationMs: number;
  };
}

export function runDiagnosticPipeline(
  input: DiagnosticPipelineInput,
): DiagnosticPipelineResult {
  const t0 = performance.now();

  const { findings, evidence } = extractDiagnosticFindings(
    input.siteId,
    input.url,
    input.categoryResults,
  );

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
      pipelineVersion: "diagnostic-v2",
      findingsCount: findings.length,
      evidenceCount: evidence.length,
      actionsCount: plan.actions.length,
      deterministicFixCount: plan.summary.deterministic,
      durationMs,
    },
  };
}

export type {
  SEOEvidence,
  DiagnosticStatus,
  FindingSeverity,
  FindingScope,
  RemediationType,
  VerificationCriterion,
  EvidenceConfidenceKind,
  CanonicalObservationSource as EvidenceSource,
  // Phase 1: Contract convergence
  OptimizationDomain,
  FixRisk,
  EvidenceRequirement,
} from "./contracts";

export {
  createEvidence,
  computeEvidenceHash,
  computeFindingFingerprint,
  aggregateEvidenceConfidence,
  // Phase 1: Contract convergence
  evidenceSatisfiesRequirements,
  fixRiskRequiresApproval,
  fixRiskIsManualOnly,
} from "./contracts";

export type { DiagnosticFinding } from "./root-cause-engine";

export {
  computePriorityV4,
  computePriorityLegacy,
  fixabilityForRemediation,
  recencyScore,
  scopeScore,
  PRIORITIZATION_POLICY_VERSION,
} from "./prioritization";
export type { PriorityComponents, ExplainablePriority } from "./prioritization";

export { diagnose, topologicalSort, sortFindingsForRemediation, DIAGNOSTIC_RULES } from "./root-cause-engine";
export type { DiagnosticRule, RootCause, EvidenceCondition, ApplicabilityCondition } from "./root-cause-engine";

export { EvidenceCollector, extractDiagnosticFindings, checklistItemToEvidence } from "./evidence-collector";
export type { EvidenceAwareResult } from "./evidence-collector";

export { tryDeterministicFix, hasDeterministicFix, DETERMINISTIC_FIXES } from "./deterministic-fixes";
export type { FixResult, FixContext } from "./deterministic-fixes";

export { buildRemediationPlan, getExecutableActions, partitionByType } from "./remediation-planner";
export type { RemediationPlan, RemediationAction, RemediationStatus } from "./remediation-planner";

export type { VerificationOutcome, VerificationWindow } from "../mutations/types";
export { VALID_VERIFICATION_TRANSITIONS } from "../mutations/types";

export {
  persistDiagnosticFinding,
  persistDiagnosticEvidence,
  persistFindingWithEvidence,
  persistDiagnosticBatch,
  markFindingResolved,
  getFindingByFingerprint,
  getFindingByDbId,
} from "./diagnostic-persistence";
export type { PersistedFindingResult } from "./diagnostic-persistence";
