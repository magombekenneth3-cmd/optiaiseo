/**
 * Mutation Operation Lifecycle — Public API
 *
 * This barrel export is the canonical import path for the mutation library.
 * All mutations in the system should flow through these functions.
 *
 * Usage:
 *   import { createOperation, executeOperation } from "@/lib/mutations";
 */

// Core operation lifecycle
export {
  createOperation,
  approveOperation,
  rejectOperation,
  executeOperation,
  registerEffect,
  checkOperationCompletion,
  type CreateOperationParams,
  type CreateOperationResult,
  type ExecuteOperationResult,
  type RegisterEffectParams,
} from "./operation";

// Types & Errors
export {
  type OperationStatus,
  type EffectStatus,
  type RiskLevel,
  type MutationType,
  type EffectType,
  type ActorType,
  type ConfirmationMode,
  type CompensationPolicy,
  type KillSwitchChannel,
  VALID_TRANSITIONS,
  TERMINAL_STATUSES,
  TERMINAL_EFFECT_STATUSES,
  ConcurrentModificationError,
  MutationBlockedError,
  ApprovalExpiredError,
  ApprovalHashMismatchError,
  ExecutionClaimError,
} from "./types";

// Concurrency
export {
  atomicVersionedUpdate,
  claimExecution,
  type MutableModel,
} from "./concurrency";

// Snapshots
export {
  captureBeforeSnapshot,
  recordAfterState,
  getVersionLineage,
} from "./snapshot";

// Risk engine
export {
  calculateOperationRisk,
  requiresApproval,
  type RiskCalculationParams,
  type RiskAssessment,
} from "./risk-engine";

// Kill switch
export {
  assertGlobalNotKilled,
  assertSiteNotKilled,
  assertEffectChannelEnabled,
  assertAllKillSwitchesClear,
} from "./kill-switch";

// Idempotency
export { generateOperationKey, generateEffectKey } from "./idempotency";

// Approval
export {
  hashCanonicalMutation,
  validateApproval,
  generateApprovalData,
} from "./approval";

// Audit
export {
  appendAuditEvent,
  getAuditTrail,
  type AuditEventType,
} from "./audit";

// Reconciliation
export {
  reconcileEffects,
  type ReconcileBatchResult,
  type ReconciliationResult,
} from "./reconciliation";

// Compensation
export {
  compensateOperation,
  compensateSingleEffect,
  type CompensateOperationResult,
  type CompensationRequest,
  type CompensationResult,
} from "./compensation";
