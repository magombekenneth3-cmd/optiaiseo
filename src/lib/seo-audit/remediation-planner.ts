import type {
  SEOEvidence,
  VerificationCriterion,
  RemediationType,
  OptimizationDomain,
  FixRisk,
  EvidenceRequirement,
} from "./contracts";
import {
  evidenceSatisfiesRequirements,
  fixRiskRequiresApproval,
} from "./contracts";
import type { ExplainablePriority, PriorityComponents } from "./contracts";
import type { FixResult, FixContext } from "./deterministic-fixes";
import type { DiagnosticFinding } from "./root-cause-engine";
import { tryDeterministicFix, hasDeterministicFix } from "./deterministic-fixes";
import { sortFindingsForRemediation, DIAGNOSTIC_RULES } from "./root-cause-engine";
import {
  computePriorityV4,
  fixabilityForRemediation,
  recencyScore,
  scopeScore,
} from "./prioritization";

export type RemediationStatus =
  | "PLANNED"
  | "FIX_GENERATED"
  | "AWAITING_REVIEW"
  | "APPLIED"
  | "VERIFIED"
  | "FAILED"
  | "SKIPPED";

export interface RemediationAction {
  findingFingerprint: string;
  findingId: string;
  /** Optimization domain the finding belongs to */
  domain: OptimizationDomain;
  issueType: string;
  rootCause: string;
  rootCauseId: string;
  remediationType: RemediationType;
  /**
   * Risk level — controls execution policy.
   * Propagated from the deterministic fix if available,
   * otherwise inferred from the remediation type.
   */
  risk: FixRisk;
  deterministicFix?: FixResult;
  aiPatchHint?: string;
  manualActionDescription?: string;
  priority: ExplainablePriority;
  executionOrder: number;
  blockedBy: string[];
  verificationCriteria: VerificationCriterion[];
  status: RemediationStatus;
  expectedOutcome: string;
  /** If evidence requirements were not met, records what was missing */
  evidenceGapReason?: string;
}

export interface RemediationPlan {
  siteId: string;
  url: string;
  createdAt: string;
  findingsCount: number;
  actions: RemediationAction[];
  summary: {
    deterministic: number;
    aiPatch: number;
    manual: number;
    experiment: number;
    totalEstimatedImpact: number;
  };
}

export interface PlannerContext {
  siteId: string;
  url: string;
  domain: string;
  totalPages: number;
  fixContext?: Partial<FixContext>;
}

export function buildRemediationPlan(
  findings: DiagnosticFinding[],
  context: PlannerContext,
): RemediationPlan {
  const actionable = findings.filter(
    f => f.status === "FAIL" || f.status === "WARNING",
  );

  const sorted = sortFindingsForRemediation(actionable);

  const actions: RemediationAction[] = [];
  const summary = {
    deterministic: 0,
    aiPatch: 0,
    manual: 0,
    experiment: 0,
    totalEstimatedImpact: 0,
  };

  for (let i = 0; i < sorted.length; i++) {
    const finding = sorted[i];
    const action = planAction(finding, i, context);
    actions.push(action);

    switch (action.remediationType) {
      case "DETERMINISTIC":
        summary.deterministic++;
        break;
      case "AI_PATCH":
        summary.aiPatch++;
        break;
      case "MANUAL":
        summary.manual++;
        break;
      case "EXPERIMENT":
        summary.experiment++;
        break;
    }
  }

  return {
    siteId: context.siteId,
    url: context.url,
    createdAt: new Date().toISOString(),
    findingsCount: findings.length,
    actions,
    summary,
  };
}

function planAction(
  finding: DiagnosticFinding,
  executionOrder: number,
  context: PlannerContext,
): RemediationAction {
  const fixCtx: FixContext = {
    url: context.url,
    domain: context.domain,
    preferredUrl: context.url,
    title: context.fixContext?.title,
    metaDescription: context.fixContext?.metaDescription,
    discoveredUrls: context.fixContext?.discoveredUrls,
    robotsContent: context.fixContext?.robotsContent,
    pageType: context.fixContext?.pageType,
    findingDetails: finding.scope.urls.length > 0
      ? { affectedUrls: finding.scope.urls }
      : undefined,
  };

  let deterministicFix: FixResult | null = null;
  let effectiveRemediationType = finding.remediationType;
  let evidenceGapReason: string | undefined;

  // ── Per-remediation evidence requirements gate ────────────────────────
  // Look up the root cause's evidence requirements from the diagnostic rule.
  // If the collected evidence doesn't satisfy them, downgrade to MANUAL.
  const ruleEntry = Object.values(DIAGNOSTIC_RULES).find(
    r => r.issueType === finding.issueType,
  );
  const matchingCause = ruleEntry?.causes.find(c => c.id === finding.rootCauseId);

  if (matchingCause?.evidenceRequirements && matchingCause.evidenceRequirements.length > 0) {
    const { satisfied, missing } = evidenceSatisfiesRequirements(
      finding.evidence,
      matchingCause.evidenceRequirements,
    );
    if (!satisfied) {
      // Evidence insufficient for the intended remediation type → downgrade
      const missingDesc = missing
        .map(r => `${r.source} (min: ${r.minimumConfidence})`)
        .join(", ");
      evidenceGapReason = `Insufficient evidence for ${effectiveRemediationType}: missing ${missingDesc}`;
      effectiveRemediationType = "MANUAL";
    }
  }

  if (
    effectiveRemediationType !== "MANUAL" &&
    (finding.remediationType === "DETERMINISTIC" || hasDeterministicFix(finding.rootCauseId))
  ) {
    deterministicFix = tryDeterministicFix(finding.rootCauseId, fixCtx);
    if (deterministicFix) {
      effectiveRemediationType = "DETERMINISTIC";
    } else {
      effectiveRemediationType = "AI_PATCH";
    }
  }

  // ── Resolve risk level ────────────────────────────────────────────────
  // If deterministic fix provides explicit risk, use that.
  // Otherwise, infer from remediation type.
  const risk: FixRisk = deterministicFix?.risk
    ?? remediationTypeToDefaultRisk(effectiveRemediationType);

  const newestEvidence = finding.evidence.reduce(
    (newest, e) => {
      const t = new Date(e.observedAt).getTime();
      return t > newest ? t : newest;
    },
    0,
  );

  const priorityInput: PriorityComponents = {
    businessImpact: severityToBusinessImpact(finding.severity),
    searchImpact: issueTypeToSearchImpact(finding.issueType),
    affectedScope: scopeScore(finding.scope.urls.length, context.totalPages),
    confidence: finding.confidence,
    fixability: fixabilityForRemediation(effectiveRemediationType),
    evidenceStrength: Math.min(1, finding.evidence.length / 3),
    recency: newestEvidence > 0
      ? recencyScore(new Date(newestEvidence))
      : 0.5,
  };

  const priority = computePriorityV4(priorityInput);

  const action: RemediationAction = {
    findingFingerprint: finding.fingerprint,
    findingId: finding.fingerprint,
    domain: finding.domain,
    issueType: finding.issueType,
    rootCause: finding.rootCause,
    rootCauseId: finding.rootCauseId,
    remediationType: effectiveRemediationType,
    risk,
    priority,
    executionOrder,
    blockedBy: finding.dependencyFingerprints,
    verificationCriteria: finding.verificationCriteria,
    status: "PLANNED",
    expectedOutcome: finding.expectedOutcome,
  };

  if (evidenceGapReason) {
    action.evidenceGapReason = evidenceGapReason;
  }

  if (deterministicFix) {
    action.deterministicFix = deterministicFix;
  } else if (effectiveRemediationType === "AI_PATCH") {
    action.aiPatchHint = buildAiPatchHint(finding);
  } else if (effectiveRemediationType === "MANUAL") {
    action.manualActionDescription = buildManualDescription(finding);
  }

  return action;
}

function remediationTypeToDefaultRisk(type: RemediationType): FixRisk {
  switch (type) {
    case "DETERMINISTIC": return "LOW";
    case "AI_PATCH":      return "MEDIUM";
    case "EXPERIMENT":    return "MEDIUM";
    case "MANUAL":        return "HIGH";
  }
}

function severityToBusinessImpact(severity: string): number {
  switch (severity) {
    case "critical": return 1.0;
    case "high":     return 0.8;
    case "medium":   return 0.5;
    case "low":      return 0.25;
    default:         return 0.3;
  }
}

function issueTypeToSearchImpact(issueType: string): number {
  if (issueType.includes("indexing") || issueType.includes("blocked")) return 1.0;
  if (issueType.includes("canonical")) return 0.85;
  if (issueType.includes("redirect")) return 0.75;
  if (issueType.includes("sitemap")) return 0.65;
  if (issueType.includes("schema")) return 0.55;
  if (issueType.includes("ssl") || issueType.includes("robots")) return 0.7;
  return 0.5;
}

function buildAiPatchHint(finding: DiagnosticFinding): string {
  const evidenceSummary = finding.evidence
    .slice(0, 3)
    .map(e => `- [${e.source}] observed: ${JSON.stringify(e.observedValue)}`)
    .join("\n");

  return [
    `Issue: ${finding.rootCause}`,
    `Type: ${finding.issueType}`,
    `Severity: ${finding.severity}`,
    `Expected outcome: ${finding.expectedOutcome}`,
    "",
    "Evidence:",
    evidenceSummary,
    "",
    "Verification criteria:",
    finding.verificationCriteria
      .map(vc => `- ${vc.type}: expected ${JSON.stringify(vc.expected)}`)
      .join("\n"),
  ].join("\n");
}

function buildManualDescription(finding: DiagnosticFinding): string {
  return [
    `**Root Cause:** ${finding.rootCause}`,
    "",
    `**Why this can't be auto-fixed:** This issue requires server configuration, `,
    `DNS changes, or manual review that OptiAISEO cannot perform automatically.`,
    "",
    `**Expected outcome after fix:** ${finding.expectedOutcome}`,
    "",
    "**Evidence:**",
    ...finding.evidence.slice(0, 3).map(e =>
      `- ${e.source}: ${typeof e.observedValue === "string" ? e.observedValue : JSON.stringify(e.observedValue)}`,
    ),
    "",
    "**How to verify:**",
    ...finding.verificationCriteria.map(vc =>
      `- Check ${vc.type}: expected ${JSON.stringify(vc.expected)}`,
    ),
  ].join("\n");
}

export function getExecutableActions(
  plan: RemediationPlan,
  resolvedFingerprints: Set<string>,
): RemediationAction[] {
  return plan.actions.filter(action => {
    if (action.status !== "PLANNED") return false;
    if (action.blockedBy.length === 0) return true;
    return action.blockedBy.every(dep => resolvedFingerprints.has(dep));
  });
}

export function partitionByType(plan: RemediationPlan): {
  deterministic: RemediationAction[];
  aiPatch: RemediationAction[];
  manual: RemediationAction[];
  experiment: RemediationAction[];
} {
  return {
    deterministic: plan.actions.filter(a => a.remediationType === "DETERMINISTIC"),
    aiPatch:       plan.actions.filter(a => a.remediationType === "AI_PATCH"),
    manual:        plan.actions.filter(a => a.remediationType === "MANUAL"),
    experiment:    plan.actions.filter(a => a.remediationType === "EXPERIMENT"),
  };
}
