// =============================================================================
// AGENTS MODULE — Barrel Export
// =============================================================================

// Core contract
export type {
  AgentTier,
  AgentStatus,
  FindingSeverity,
  FindingResourceType,
  EvidenceSourceType,
  AgentError,
  Evidence,
  AgentFinding,
  AgentExecution,
  AgentResult,
} from "./types";

// Fingerprinting
export { createFindingFingerprint } from "./fingerprint";

// Runner
export { runAgent } from "./runner";

// Snapshots
export type { DiscoveryData, CrawlSnapshot, SearchSnapshot } from "./snapshots";

// Lock
export { acquireAnalysisLock, releaseAnalysisLock, isAnalysisLocked } from "./analysis-lock";
