/**
 * Phase D.1 — Discovery Runner
 *
 * Orchestrates a single discovery run for one site + one source.
 * This is the heart of the discovery system.
 *
 * INVARIANT: Discovery is OBSERVATION ONLY.
 *   - Creates CANDIDATE opportunities, never OPEN.
 *   - Only D.2 scoring can promote CANDIDATE → OPEN.
 *   - Never imports from mutations/ or proposals/.
 *
 * Flow:
 *   createAgentRun(siteId, "DISCOVERY")
 *     ↓
 *   source-specific detector → RawDiscoverySignal[]
 *     ↓
 *   validateSignals(signals, source)
 *     ↓
 *   deduplicateSignals(signals) → toCreate / toRefresh / skipped
 *     ↓
 *   persistCandidates() → GrowthDecision with status=CANDIDATE
 *     ↓
 *   refreshExisting() → update evidence + lastRefreshedAt
 *     ↓
 *   completeAgentRun()
 */

import type {
  DiscoverySource,
  DiscoveryRunResult,
  ResolvedSignal,
} from "./types";
import { filterValidSignals } from "./validators";
import { deduplicateSignals } from "./deduplicator";
import { computeAggregateExpiry } from "./freshness";
import { detectGscSignals } from "./source-detectors/gsc-detector";
import { detectAuditSignals } from "./source-detectors/audit-detector";
import { detectContentSignals } from "./source-detectors/content-detector";
import { createOpportunityFingerprint } from "@/lib/opportunity-engine/findings-to-opportunities";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "@/lib/inngest/client";

// ── Source Detector Registry ────────────────────────────────────────────────

type DetectorFn = (siteId: string, sourceRunId: string, options?: { since?: Date }) => Promise<import("./types").RawDiscoverySignal[]>;

const DETECTORS: Record<string, DetectorFn> = {
  GSC: detectGscSignals,
  AUDIT: detectAuditSignals,
  CONTENT: detectContentSignals,
  // CRAWL, COMPETITOR, PERFORMANCE are stubs for D.2+
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs discovery for a single (site, source) pair.
 *
 * 1. Creates an AgentRun for provenance
 * 2. Runs the source detector
 * 3. Validates and deduplicates signals
 * 4. Persists new CANDIDATE opportunities or refreshes existing ones
 * 5. Returns a summary result
 */
export async function runDiscovery(
  siteId: string,
  source: DiscoverySource,
  options?: { triggeredBy?: "CRON" | "EVENT" | "MANUAL"; since?: Date }
): Promise<DiscoveryRunResult> {
  const startTime = Date.now();
  const triggeredBy = options?.triggeredBy ?? "EVENT";

  // 1. Create AgentRun for provenance tracking
  const agentRun = await createAgentRun(siteId, source, triggeredBy);

  try {
    // 2. Run source-specific detector
    const detector = DETECTORS[source];
    if (!detector) {
      logger.warn("[DiscoveryRunner] No detector for source", { siteId, source });
      await completeAgentRun(agentRun.id, "COMPLETED", 0, 0);
      return buildResult(siteId, source, agentRun.id, 0, 0, 0, 0, 0, startTime);
    }

    const rawSignals = await detector(siteId, agentRun.id, { since: options?.since });

    // Update heartbeat
    await updateHeartbeat(agentRun.id);

    // 3. Validate signals (source-specific evidence age)
    const { valid, rejected } = filterValidSignals(rawSignals);

    if (rejected.length > 0) {
      logger.info("[DiscoveryRunner] Rejected signals", {
        siteId,
        source,
        rejectedCount: rejected.length,
        reasons: rejected.slice(0, 5).map((r) => r.reason),
      });
    }

    if (valid.length === 0) {
      await completeAgentRun(agentRun.id, "COMPLETED", rawSignals.length, 0);
      return buildResult(siteId, source, agentRun.id, rawSignals.length, 0, 0, 0, 0, startTime);
    }

    // 4. Deduplicate against existing opportunities
    const dedup = await deduplicateSignals(valid, source);

    // Update heartbeat
    await updateHeartbeat(agentRun.id);

    // 5. Persist new candidates
    let created = 0;
    const createdIds: string[] = [];
    for (const signal of dedup.toCreate) {
      const candidateId = await persistCandidate(siteId, signal, source, agentRun.id);
      if (candidateId) {
        created++;
        createdIds.push(candidateId);
      }
    }

    // 6. Refresh existing opportunities
    let refreshed = 0;
    for (const item of dedup.toRefresh) {
      const success = await refreshOpportunity(item.existingId, item.signal, source);
      if (success) refreshed++;
    }

    // 6b. Emit events for D.2 scoring (event boundary: D.1 → D.2)
    if (createdIds.length > 0) {
      try {
        await inngest.send(
          createdIds.map((id) => ({
            name: "opportunity.candidate.created" as const,
            data: { opportunityId: id, siteId, fingerprint: "" },
          }))
        );
      } catch {
        // Non-critical — reconciliation will catch missed events
        logger.warn("[DiscoveryRunner] Failed to emit candidate.created events", {
          count: createdIds.length,
        });
      }
    }

    // 7. Complete agent run
    await completeAgentRun(agentRun.id, "COMPLETED", rawSignals.length, created + refreshed);

    const result = buildResult(
      siteId, source, agentRun.id,
      rawSignals.length, valid.length,
      created, refreshed, dedup.skipped.length,
      startTime
    );

    logger.info("[DiscoveryRunner] Discovery complete", { ...result });
    return result;

  } catch (err: unknown) {
    logger.error("[DiscoveryRunner] Discovery failed", {
      siteId,
      source,
      error: (err as Error)?.message,
    });

    await completeAgentRun(agentRun.id, "FAILED", 0, 0);

    return buildResult(siteId, source, agentRun.id, 0, 0, 0, 0, 0, startTime);
  }
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persists a new CANDIDATE opportunity from a resolved signal.
 *
 * INVARIANT: status = "CANDIDATE", NOT "OPEN".
 * Only D.2 scoring promotes CANDIDATE → OPEN.
 */
async function persistCandidate(
  siteId: string,
  signal: ResolvedSignal,
  source: DiscoverySource,
  agentRunId: string,
): Promise<string | null> {
  try {
    const now = new Date();
    const evidenceSources = signal.mergedEvidence.map((e) => ({
      source: source,
      observedAt: e.observedAt,
    }));
    const expiresAt = computeAggregateExpiry(evidenceSources);

    // Build score JSON (minimal — D.2 will compute the real score)
    const placeholderScore = {
      final: 0,
      impact: 0,
      confidence: Math.round(signal.confidence * 100),
      trafficPotential: 0,
      businessValue: 0,
      effort: 0,
      components: {
        rankingOpportunity: 0,
        trafficOpportunity: 0,
        intentAlignment: 0,
        businessAlignment: 0,
        freshness: 0,
        internalLinkOpportunity: 0,
      },
    };

    // Build whyNow JSON
    const whyNow = {
      signals: signal.mergedEvidence
        .filter((e) => e.metric === "evidenceText" || e.metric === "findingDescription")
        .slice(0, 3)
        .map((e) => ({
          signal: signal.category as string,
          severity: "MEDIUM" as const,
          evidence: e.value ?? "",
        })),
      urgency: "MEDIUM" as const,
    };

    // Build impact JSON (placeholder — D.2 will compute)
    const impact = {
      trafficPotential: { low: 0, expected: 0, high: 0, confidence: Math.round(signal.confidence * 100) },
    };

    const created = await (prisma as any).growthDecision.create({
      data: {
        siteId,
        url: signal.url ?? signal.resourceId,
        primaryKeyword: signal.keyword ?? signal.resourceId,
        primaryCategory: signal.category,
        opportunityCategories: signal.contributingSources.length > 1
          ? [signal.category]
          : [signal.category],
        action: signal.action,
        score: placeholderScore,
        whyNow,
        impact,
        executionPlan: [],
        status: "ACTIVE",
        opportunityStatus: "CANDIDATE",    // ← D.1 creates CANDIDATE, never OPEN
        fingerprint: signal.fingerprint,
        // D.1 provenance fields
        primaryDiscoverySource: source,
        discoveredAt: now,
        lastRefreshedAt: now,
        expiresAt,
        discoveryConfidence: signal.confidence,
      },
      select: { id: true },
    });

    return created.id;
  } catch (err: unknown) {
    // Handle unique constraint violations (race with parallel discovery)
    if ((err as any)?.code === "P2002") {
      logger.info("[DiscoveryRunner] Candidate already exists (race)", {
        fingerprint: signal.fingerprint,
      });
      return null;
    }

    logger.error("[DiscoveryRunner] Failed to persist candidate", {
      fingerprint: signal.fingerprint,
      error: (err as Error)?.message,
    });
    return null;
  }
}

/**
 * Refreshes an existing opportunity with new evidence.
 * Updates lastRefreshedAt, expiresAt, and discoveryConfidence.
 * Does NOT change opportunityStatus.
 */
async function refreshOpportunity(
  existingId: string,
  signal: ResolvedSignal,
  source: DiscoverySource,
): Promise<boolean> {
  try {
    const now = new Date();
    const evidenceSources = signal.mergedEvidence.map((e) => ({
      source: source,
      observedAt: e.observedAt,
    }));
    const expiresAt = computeAggregateExpiry(evidenceSources);

    await (prisma as any).growthDecision.update({
      where: { id: existingId },
      data: {
        lastRefreshedAt: now,
        expiresAt,
        discoveryConfidence: Math.max(signal.confidence, 0),
      },
    });

    return true;
  } catch (err: unknown) {
    logger.error("[DiscoveryRunner] Failed to refresh opportunity", {
      existingId,
      error: (err as Error)?.message,
    });
    return false;
  }
}

// ── AgentRun Lifecycle ──────────────────────────────────────────────────────

async function createAgentRun(
  siteId: string,
  source: DiscoverySource,
  triggeredBy: string,
): Promise<{ id: string }> {
  try {
    return await (prisma as any).agentRun.create({
      data: {
        siteId,
        agentType: "DISCOVERY",
        status: "RUNNING",
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        metadata: { source, triggeredBy },
      },
      select: { id: true },
    });
  } catch {
    // Fallback: return a synthetic ID if AgentRun model isn't available
    return { id: `discovery_${siteId}_${source}_${Date.now()}` };
  }
}

async function updateHeartbeat(agentRunId: string): Promise<void> {
  try {
    await (prisma as any).agentRun.update({
      where: { id: agentRunId },
      data: { lastHeartbeatAt: new Date() },
    });
  } catch {
    // Non-critical — heartbeat is best-effort
  }
}

async function completeAgentRun(
  agentRunId: string,
  status: "COMPLETED" | "FAILED",
  itemsProcessed: number,
  findingCount: number,
): Promise<void> {
  try {
    await (prisma as any).agentRun.update({
      where: { id: agentRunId },
      data: {
        status,
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        itemsProcessed,
        findingCount,
      },
    });
  } catch {
    // Non-critical
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(
  siteId: string,
  source: DiscoverySource,
  agentRunId: string,
  detected: number,
  valid: number,
  created: number,
  refreshed: number,
  skipped: number,
  startTime: number,
): DiscoveryRunResult {
  return {
    siteId,
    source,
    agentRunId,
    signalsDetected: detected,
    signalsValid: valid,
    candidatesCreated: created,
    candidatesRefreshed: refreshed,
    candidatesSkipped: skipped,
    durationMs: Date.now() - startTime,
  };
}
