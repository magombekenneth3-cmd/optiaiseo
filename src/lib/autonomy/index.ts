/**
 * Autonomy Module — Controlled autonomous execution for the SEO agent.
 *
 * Architecture:
 *
 *   LLM Proposal
 *       ↓
 *   Risk + Tier Engine
 *       ↓
 *   AUTONOMY GATE (policy-gate.ts)
 *     1. Operating mode
 *     2. Effective tier limit
 *     3. Atomic budget reservation
 *     4. Atomic concurrency lease
 *     5. Circuit breaker state
 *     6. Idempotent execution claim
 *       ↓
 *   Phase B Mutation Lifecycle
 *       ↓
 *   Verification
 */

// C.1 — Operating Modes
export {
  type OperatingMode,
  OPERATING_MODES,
  modeTierLimit,
  effectiveTierLimit,
  isTierAuthorized,
  isReportOnly,
  parseOperatingMode,
} from "./operating-modes";

// C.2 — Policy Gate
export {
  type AuthorizationRequest,
  type AuthorizationDecision,
  authorize,
} from "./policy-gate";

// C.3 — Budget Enforcer
export {
  type BudgetCheck,
  type BudgetReservationResult,
  checkBudget,
  reserveBudget,
  consumeReservation,
  releaseReservation,
} from "./budget-enforcer";

// C.4 — Concurrency Lease
export {
  type ConcurrencyCheck,
  checkConcurrencySlot,
  getConcurrencyStatus,
} from "./concurrency-lease";

// C.5 — Circuit Breaker
export {
  type CircuitState,
  type CircuitChannel,
  type CircuitBreakerConfig,
  type CircuitCheckResult,
  CIRCUIT_CHANNELS,
  checkCircuitBreaker,
  recordSuccess as recordCircuitSuccess,
  recordFailure as recordCircuitFailure,
} from "./circuit-breaker";

// C.6 — Execution Claim
export {
  type ExecutionClaimResult,
  ClaimOwnershipError,
  StaleExecutionError,
  CLAIM_TIMEOUT_MS,
  getWorkerId,
  claimExecution as claimAutonomousExecution,
  verifyClaimBeforeExecution,
  completeClaim,
  releaseClaim,
  releaseStaleActiveClaims,
} from "./execution-claim";

// C.8 — Failure Classification + Retry Policy
export {
  type FailureClass,
  type ClassificationContext,
  classifyFailure,
} from "./failure-classifier";

export {
  type RetryDecision,
  decideRetry,
  maxRetriesFor,
} from "./retry-policy";

// C.9 — Execution Trace
export {
  type VerificationStatus,
  type PolicyDecisionType,
  type TraceInit,
  type AuthorizationRecord,
  type ExecutionRecord,
  type VerificationRecord,
  createTrace,
  recordAuthorization,
  recordExecution,
  recordVerification,
} from "./execution-trace";
