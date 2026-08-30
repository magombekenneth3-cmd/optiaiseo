// =============================================================================
// PHASE B — ACTION PROPOSALS — Public API
//
// Barrel export for the proposals module.
// All Phase B functionality should be imported from this path:
//
//   import { generateProposal, runAction, verifyProposal } from "@/lib/proposals";
// =============================================================================

// Types & State Machines
export {
  type ActionType,
  type SafetyTier,
  type ProposalStatus,
  type OpportunityStatus,
  type ProposedChange,
  type VerificationCheckType,
  type VerificationCriterion,
  type VerificationOutcome,
  type VerificationDetail,
  type RollbackInfo,
  type CompensationPolicyType,
  type RetryPolicy,
  type FindingActionMapping,
  SAFETY_TIER_MAP,
  OPPORTUNITY_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  TERMINAL_OPPORTUNITY_STATUSES,
  TERMINAL_PROPOSAL_STATUSES,
  VERIFICATION_CRITERIA_MAP,
  VERIFICATION_DELAYS,
  RETRY_POLICIES,
  FINDING_TO_ACTION_MAP,
  getSafetyTier,
  requiresHumanApproval,
  canRetry,
  computeNextRetryDelay,
  OpportunityTransitionError,
  ProposalTransitionError,
  ProposalApprovalExpiredError,
  ProposalApprovalHashMismatchError,
  ProposalMaxAttemptsError,
} from "./types";

// Opportunity Lifecycle
export {
  assertValidOpportunityTransition,
  isTerminalOpportunityStatus,
  transitionOpportunity,
  getOpportunityStatus,
  findOpportunitiesByStatus,
  type OpportunityTransitionInput,
} from "./opportunity-lifecycle";

// Safety Policy
export {
  evaluatePolicy,
  hashProposedChanges,
  generateProposalIdempotencyKey,
  validateProposalApproval,
  type PolicyDecision,
  type ApprovalValidationResult,
} from "./safety-policy";

// Proposal Generator
export {
  generateProposal,
  type GenerateProposalInput,
  type GenerateProposalResult,
} from "./generator";

// Action Runner
export {
  runAction,
  type RunActionInput,
  type RunActionOutput,
} from "./action-runner";

// Verification
export {
  verifyProposal,
  getVerificationDelay,
  type VerificationInput,
  type VerificationOutput,
} from "./verification";

// Verification Checks (for testing / direct use)
export {
  parsePage,
  runCheck,
  runAllChecks,
  type ParsedPage,
} from "./verification-checks";
