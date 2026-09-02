/**
 * Phase D.1 — Discovery Module (barrel export)
 */

export { runDiscovery } from "./discovery-runner";
export { validateSignal, filterValidSignals, MIN_DISCOVERY_CONFIDENCE } from "./validators";
export { resolveConflict, resolveAllConflicts, CATEGORY_PRIORITY, CATEGORY_TO_ACTION } from "./conflict-resolution";
export { deduplicateSignals, checkExistingOpportunity } from "./deduplicator";
export {
  FRESHNESS_POLICIES,
  getMaxEvidenceAge,
  isEvidenceFresh,
  computeAggregateExpiry,
  shouldRefreshSource,
  getSourceExpiry,
  wouldCreateExpiredCandidate,
} from "./freshness";

export type {
  DiscoverySource,
  DiscoveryEvidence,
  RawDiscoverySignal,
  ResolvedSignal,
  DiscoveryRunResult,
  FreshnessPolicy,
  ValidationResult,
  DiscoveryResourceType,
} from "./types";
