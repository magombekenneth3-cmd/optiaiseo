import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { computeEvidenceHash, type SEOEvidence, type CanonicalObservationSource } from "./contracts";
import { persistDiagnosticEvidence } from "./diagnostic-persistence";
import {
  LIFECYCLE_STATE,
  isValidLifecycleTransition,
  type LifecycleState,
} from "./lifecycle";

export interface ReconciliationInput {
  siteId: string;
  currentFindings: Array<{
    fingerprint: string;
    issueType: string;
    status: string;
    severity: string;
    rootCause: string;
    confidence: number;
    scopeUrls: string[];
    evidence: Array<{
      source: string;
      url?: string;
      observedAt: string;
      observedValue: Record<string, unknown>;
      confidence: number;
      confidenceKind: string;
      evidenceHash: string;
    }>;
  }>;
  crawledUrls: string[];
}

export interface ReconciliationResult {
  resolved: number;
  regressed: number;
  updated: number;
  created: number;
  unchanged: number;
  skippedUnavailable: number;
}

export async function reconcileFindings(
  input: ReconciliationInput,
): Promise<ReconciliationResult> {
  const { siteId, currentFindings, crawledUrls } = input;

  const result: ReconciliationResult = {
    resolved: 0,
    regressed: 0,
    updated: 0,
    created: 0,
    unchanged: 0,
    skippedUnavailable: 0,
  };

  const existingFindings = await prisma.diagnosticFindingRecord.findMany({
    where: { siteId },
    select: {
      id: true,
      fingerprint: true,
      issueType: true,
      status: true,
      lifecycleState: true,
      scopeUrls: true,
      resolvedAt: true,
      updatedAt: true,
    },
  });

  const existingByFingerprint = new Map(
    existingFindings.map((f) => [f.fingerprint, f]),
  );

  const currentFingerprints = new Set(
    currentFindings.map((f) => f.fingerprint),
  );

  const crawledUrlSet = new Set(crawledUrls.map(normalizeUrl));

  for (const current of currentFindings) {
    const existing = existingByFingerprint.get(current.fingerprint);

    if (!existing) {
      result.created++;
      continue;
    }

    const existingLifecycle = existing.lifecycleState as LifecycleState;

    if (existingLifecycle === "RESOLVED" || existingLifecycle === "IN_PROGRESS") {
      if (current.status === "FAIL" || current.status === "WARNING") {
        const newState = LIFECYCLE_STATE.REGRESSED;
        if (isValidLifecycleTransition(existingLifecycle, newState)) {
          try {
            await prisma.diagnosticFindingRecord.update({
              where: { id: existing.id, updatedAt: existing.updatedAt },
              data: {
                status: current.status,
                lifecycleState: newState,
                severity: current.severity,
                confidence: current.confidence,
                resolvedAt: null,
              },
            });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
              result.unchanged++;
              continue;
            }
            throw err;
          }

          await appendReconciliationEvidence(siteId, existing.id, {
            action: "REGRESSED",
            previousState: existingLifecycle,
            newStatus: current.status,
          });

          result.regressed++;
        }
        continue;
      }
    }

    if (current.status === "FAIL" || current.status === "WARNING") {
      await prisma.diagnosticFindingRecord.update({
        where: { id: existing.id },
        data: {
          status: current.status,
          severity: current.severity,
          confidence: current.confidence,
        },
      });

      if (current.evidence.length > 0) {
        await persistDiagnosticEvidence(siteId, existing.id, current.evidence as SEOEvidence[]);
      }

      result.updated++;
    } else {
      result.unchanged++;
    }
  }

  for (const existing of existingFindings) {
    if (currentFingerprints.has(existing.fingerprint)) continue;

    const existingLifecycle = existing.lifecycleState as LifecycleState;
    if (existingLifecycle === "RESOLVED") {
      result.unchanged++;
      continue;
    }

    const scopeUrls = existing.scopeUrls ?? [];
    const allScopeUrlsCrawled = scopeUrls.length > 0 &&
      scopeUrls.every((url) => crawledUrlSet.has(normalizeUrl(url)));

    if (!allScopeUrlsCrawled && scopeUrls.length > 0) {
      result.skippedUnavailable++;
      logger.info("[Reconciliation] Skipped — scope URLs not crawled", {
        findingId: existing.id,
        fingerprint: existing.fingerprint,
        scopeUrls,
      });
      continue;
    }

    if (scopeUrls.length === 0) {
      result.skippedUnavailable++;
      logger.info("[Reconciliation] Skipped — no scope URLs to verify against", {
        findingId: existing.id,
        fingerprint: existing.fingerprint,
      });
      continue;
    }

    const newState = LIFECYCLE_STATE.RESOLVED;
    if (!isValidLifecycleTransition(existingLifecycle, newState)) {
      result.unchanged++;
      continue;
    }

    try {
      await prisma.diagnosticFindingRecord.update({
        where: { id: existing.id, updatedAt: existing.updatedAt },
        data: {
          status: "PASS",
          lifecycleState: newState,
          resolvedAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        result.unchanged++;
        continue;
      }
      throw err;
    }

    await appendReconciliationEvidence(siteId, existing.id, {
      action: "RESOLVED_BY_REAUDIT",
      previousState: existingLifecycle,
      crawledUrls: scopeUrls.filter((url) => crawledUrlSet.has(normalizeUrl(url))),
    });

    result.resolved++;
  }

  logger.info("[Reconciliation] Complete", {
    siteId,
    ...result,
  });

  return result;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    let normalized = parsed.origin.toLowerCase() + parsed.pathname + parsed.search;
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

async function appendReconciliationEvidence(
  siteId: string,
  findingDbId: string,
  observedValue: Record<string, unknown>,
): Promise<void> {
  const source: CanonicalObservationSource = "RECONCILIATION";
  const evidenceHash = computeEvidenceHash({
    source,
    url: undefined,
    observedValue,
  });

  try {
    await persistDiagnosticEvidence(siteId, findingDbId, [{
      source,
      url: undefined,
      observedAt: new Date().toISOString(),
      observedValue,
      confidence: 1.0,
      confidenceKind: "DIRECTLY_OBSERVED" as const,
      evidenceHash,
    }]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.includes("findingId") && target.includes("evidenceHash")) {
        return;
      }
    }
    throw err;
  }
}
