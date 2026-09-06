/**
 * D.8.1.1 — Test Harness Index
 *
 * Single import point for all D.8 test harness utilities.
 *
 * Usage:
 *   import { makeTestContext, buildLifecycle, assertOneProposal, providerStub, isLiveDbAvailable }
 *     from "../harness";
 */

// DB guard + infra mode declarations
export {
  assertStagingDatabase,
  isLiveDbAvailable,
  isLiveRedisAvailable,
  type InfraMode,
  type TestLevel,
  type TestClassification,
} from "./db-guard";

// Fixture factories
export {
  makeTestContext,
  seedUser,
  seedSite,
  seedOpportunity,
  seedScoreRecord,
  seedAllocation,
  seedProposal,
  seedExperiment,
  seedTrace,
  cleanupContext,
  type TestContext,
  type SiteOverrides,
  type OpportunityOverrides,
  type ScoreOverrides,
  type AllocationOverrides,
  type ProposalOverrides,
  type ExperimentOverrides,
} from "./fixtures";

// Lifecycle builder
export {
  buildLifecycle,
  type LifecycleStage,
  type LifecycleState,
  type BuildLifecycleOptions,
} from "./lifecycle";

// Provider stub
export {
  D4ProviderStub,
  providerStub,
  type ProviderMode,
  type ProviderResponse,
  type ProviderCallRecord,
} from "./provider-stub";

// Infrastructure assertions
export {
  assertSelectedAllocation,
  assertNoSelectedAllocation,
  assertAllocationFenceValid,
  assertOneProposal,
  assertNoProposal,
  assertNoDuplicateProposals,
  assertOneClaim,
  assertNoClaim,
  assertReservationReleased,
  assertReservationConsumed,
  assertBudgetAvailable,
  assertTraceComplete,
  assertTraceBlocked,
  assertOpportunityStatus,
  assertNoMutation,
} from "./assertions";
