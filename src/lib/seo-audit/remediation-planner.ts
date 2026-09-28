/**
 * src/lib/seo-audit/remediation-planner.ts
 *
 * Routes each DiagnosticFinding to the correct fix strategy:
 *
 *   Level 1 (DETERMINISTIC) → deterministic-fixes.ts
 *   Level 2 (AI_PATCH)      → auditFix.ts (existing)
 *   Level 3 (MANUAL)        → dashboard action item
 *   Level 4 (EXPERIMENT)    → experiments system
 *
 * The planner produces a RemediationPlan — an ordered list of actions
 * that the engine can execute sequentially, respecting dependency order.
 *
 * Design principle: "Use AI only where deterministic logic cannot solve it."
 */

import type { DiagnosticFinding, RemediationType, VerificationCriterion } from "./diagnostic-types";
import type { FixResult, FixContext } from "./deterministic-fixes";
import { tryDeterministicFix, hasDeterministicFix } from "./deterministic-fixes";
import { sortFindingsForRemediation } from "./root-cause-engine";
import {
  computePriorityV4,
  fixabilityForRemediation,
  recencyScore,
  scopeScore,
  type PriorityComponents,
  type ExplainablePriority,
} from "./prioritization";

// ── Plan Types ──────────────────────────────────────────────────────────────

export type RemediationStatus =
  | "PLANNED"
  | "FIX_GENERATED"
  | "AWAITING_REVIEW"
  | "APPLIED"
  | "VERIFIED"
  | "FAILED"
  | "SKIPPED";

export interface RemediationAction {
  /** Reference to the DiagnosticFinding that generated this action */
  findingFingerprint: string;
  findingId: string;
  issueType: string;
  rootCause: string;

  /** What level of fix this action uses */
  remediationType: RemediationType;

  /** The generated fix, if deterministic */
  deterministicFix?: FixResult;

  /** Instructions for the AI patch generator (passed to auditFix.ts) */
  aiPatchHint?: string;

  /** Instructions for manual action (displayed in dashboard) */
  manualActionDescription?: string;

  /** Priority and ordering */
  priority: ExplainablePriority;
  executionOrder: number;

  /** Dependencies that must be resolved before this action */
  blockedBy: string[];

  /** Verification contract */
  verificationCriteria: VerificationCriterion[];

  /** Current status */
  status: RemediationStatus;

  /** Expected outcome of this fix */
  expectedOutcome: string;
}

export interface RemediationPlan {
  siteId: string;
  url: string;
  createdAt: string;
  /** Total number of findings analysed */
  findingsCount: number;
  /** Actions in execution order (dependencies first, then by priority) */
  actions: RemediationAction[];
  /** Summary statistics */
  summary: {
    deterministic: number;
    aiPatch: number;
    manual: number;
    experiment: number;
    totalEstimatedImpact: number;
  };
}

// ── Planner ─────────────────────────────────────────────────────────────────

export interface PlannerContext {
  siteId: string;
  url: string;
  domain: string;
  totalPages: number;
  /** Additional context for fix generation */
  fixContext?: Partial<FixContext>;
}

/**
 * Generate a remediation plan from a set of diagnostic findings.
 *
 * 1. Sort findings by dependency order → severity → confidence
 * 2. For each finding, determine the fix strategy
 * 3. Generate deterministic fixes where possible
 * 4. Compute explainable priority for each action
 * 5. Return an ordered plan
 */
export function buildRemediationPlan(
  findings: DiagnosticFinding[],
  context: PlannerContext,
): RemediationPlan {
  // Only plan for findings that are FAIL or WARNING
  const actionable = findings.filter(
    f => f.status === "FAIL" || f.status === "WARNING",
  );

  // Sort by dependency order, then severity, then confidence
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

    // Count by type
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

/**
 * Plan a single remediation action for a finding.
 */
function planAction(
  finding: DiagnosticFinding,
  executionOrder: number,
  context: PlannerContext,
): RemediationAction {
  // Extract the root-cause ID from the finding ID
  // Finding IDs are formatted as "RULE_KEY:cause_id:timestamp"
  const rootCauseId = finding.id.split(":")[1] ?? finding.issueType;

  // Build fix context
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

  // Try deterministic fix first
  let deterministicFix: FixResult | null = null;
  let effectiveRemediationType = finding.remediationType;

  if (finding.remediationType === "DETERMINISTIC" || hasDeterministicFix(rootCauseId)) {
    deterministicFix = tryDeterministicFix(rootCauseId, fixCtx);
    if (deterministicFix) {
      effectiveRemediationType = "DETERMINISTIC";
    } else {
      // Deterministic fix failed — escalate to AI
      effectiveRemediationType = "AI_PATCH";
    }
  }

  // Compute priority
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

  // Build the action
  const action: RemediationAction = {
    findingFingerprint: finding.fingerprint,
    findingId: finding.id,
    issueType: finding.issueType,
    rootCause: finding.rootCause,
    remediationType: effectiveRemediationType,
    priority,
    executionOrder,
    blockedBy: finding.dependencies ?? [],
    verificationCriteria: finding.verificationCriteria,
    status: "PLANNED",
    expectedOutcome: finding.expectedOutcome,
  };

  // Add type-specific details
  if (deterministicFix) {
    action.deterministicFix = deterministicFix;
  } else if (effectiveRemediationType === "AI_PATCH") {
    action.aiPatchHint = buildAiPatchHint(finding);
  } else if (effectiveRemediationType === "MANUAL") {
    action.manualActionDescription = buildManualDescription(finding);
  }

  return action;
}

// ── Severity / Impact Mapping ───────────────────────────────────────────────

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
  // Indexing blockers are the highest search impact
  if (issueType.includes("indexing") || issueType.includes("blocked")) return 1.0;
  if (issueType.includes("canonical")) return 0.85;
  if (issueType.includes("redirect")) return 0.75;
  if (issueType.includes("sitemap")) return 0.65;
  if (issueType.includes("schema")) return 0.55;
  if (issueType.includes("ssl") || issueType.includes("robots")) return 0.7;
  return 0.5;
}

// ── AI Patch Hint Builder ───────────────────────────────────────────────────

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

// ── Manual Description Builder ──────────────────────────────────────────────

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

// ── Plan Utilities ──────────────────────────────────────────────────────────

/**
 * Filter a remediation plan to only return actions that are currently executable.
 * An action is executable when all its dependencies have been resolved.
 */
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

/**
 * Partition a plan's actions by remediation type for dashboard display.
 */
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
