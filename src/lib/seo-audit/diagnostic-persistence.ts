import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { DiagnosticFinding } from "./root-cause-engine";
import type { SEOEvidence } from "./contracts";
import type { ExplainablePriority } from "./contracts";

export interface PersistedFindingResult {
  dbId: string;
  fingerprint: string;
  isNew: boolean;
}

export async function persistDiagnosticFinding(
  siteId: string,
  finding: DiagnosticFinding,
  priority?: ExplainablePriority,
): Promise<PersistedFindingResult> {
  const record = await prisma.diagnosticFindingRecord.upsert({
    where: {
      siteId_fingerprint: {
        siteId,
        fingerprint: finding.fingerprint,
      },
    },
    create: {
      siteId,
      fingerprint: finding.fingerprint,
      issueType: finding.issueType,
      status: finding.status,
      severity: finding.severity,
      scopeType: finding.scope.type,
      scopeUrls: finding.scope.urls,
      rootCause: finding.rootCause,
      confidence: finding.confidence,
      expectedOutcome: finding.expectedOutcome,
      remediationType: finding.remediationType,
      verificationCriteria: finding.verificationCriteria as unknown as Prisma.InputJsonValue,
      dependencies: finding.dependencyFingerprints,
      priorityScore: priority?.score ?? null,
      priorityComponents: priority?.components
        ? (priority.components as unknown as Prisma.InputJsonValue)
        : undefined,
      policyVersion: priority?.policyVersion ?? null,
    },
    update: {
      status: finding.status,
      severity: finding.severity,
      confidence: finding.confidence,
      scopeUrls: finding.scope.urls,
      priorityScore: priority?.score ?? undefined,
      priorityComponents: priority?.components
        ? (priority.components as unknown as Prisma.InputJsonValue)
        : undefined,
      policyVersion: priority?.policyVersion ?? undefined,
    },
    select: {
      id: true,
      fingerprint: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const isNew = record.createdAt.getTime() === record.updatedAt.getTime();

  return {
    dbId: record.id,
    fingerprint: record.fingerprint,
    isNew,
  };
}

export async function persistDiagnosticEvidence(
  siteId: string,
  findingDbId: string,
  evidence: SEOEvidence[],
): Promise<number> {
  if (evidence.length === 0) return 0;

  const existingHashes = new Set(
    (
      await prisma.sEOEvidenceRecord.findMany({
        where: {
          siteId,
          findingId: findingDbId,
          evidenceHash: { in: evidence.map((e) => e.evidenceHash) },
        },
        select: { evidenceHash: true },
      })
    ).map((r) => r.evidenceHash),
  );

  const newEvidence = evidence.filter((e) => !existingHashes.has(e.evidenceHash));
  if (newEvidence.length === 0) return 0;

  const result = await prisma.sEOEvidenceRecord.createMany({
    data: newEvidence.map((e) => ({
      siteId,
      findingId: findingDbId,
      source: e.source,
      url: e.url ?? null,
      observedAt: new Date(e.observedAt),
      observedValue: e.observedValue as Prisma.InputJsonValue,
      expectedValue: e.expectedValue
        ? (e.expectedValue as Prisma.InputJsonValue)
        : undefined,
      httpStatus: e.httpStatus ?? null,
      confidence: e.confidence,
      evidenceHash: e.evidenceHash,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

export async function persistFindingWithEvidence(
  siteId: string,
  finding: DiagnosticFinding,
  priority?: ExplainablePriority,
): Promise<PersistedFindingResult> {
  return prisma.$transaction(async (tx) => {
    const record = await tx.diagnosticFindingRecord.upsert({
      where: {
        siteId_fingerprint: {
          siteId,
          fingerprint: finding.fingerprint,
        },
      },
      create: {
        siteId,
        fingerprint: finding.fingerprint,
        issueType: finding.issueType,
        status: finding.status,
        severity: finding.severity,
        scopeType: finding.scope.type,
        scopeUrls: finding.scope.urls,
        rootCause: finding.rootCause,
        confidence: finding.confidence,
        expectedOutcome: finding.expectedOutcome,
        remediationType: finding.remediationType,
        verificationCriteria: finding.verificationCriteria as unknown as Prisma.InputJsonValue,
        dependencies: finding.dependencyFingerprints,
        priorityScore: priority?.score ?? null,
        priorityComponents: priority?.components
          ? (priority.components as unknown as Prisma.InputJsonValue)
          : undefined,
        policyVersion: priority?.policyVersion ?? null,
      },
      update: {
        status: finding.status,
        severity: finding.severity,
        confidence: finding.confidence,
        scopeUrls: finding.scope.urls,
        priorityScore: priority?.score ?? undefined,
        priorityComponents: priority?.components
          ? (priority.components as unknown as Prisma.InputJsonValue)
          : undefined,
        policyVersion: priority?.policyVersion ?? undefined,
      },
      select: {
        id: true,
        fingerprint: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const isNew = record.createdAt.getTime() === record.updatedAt.getTime();

    if (finding.evidence.length > 0) {
      const existingHashes = new Set(
        (
          await tx.sEOEvidenceRecord.findMany({
            where: {
              siteId,
              findingId: record.id,
              evidenceHash: { in: finding.evidence.map((e) => e.evidenceHash) },
            },
            select: { evidenceHash: true },
          })
        ).map((r) => r.evidenceHash),
      );

      const newEvidence = finding.evidence.filter(
        (e) => !existingHashes.has(e.evidenceHash),
      );

      if (newEvidence.length > 0) {
        await tx.sEOEvidenceRecord.createMany({
          data: newEvidence.map((e) => ({
            siteId,
            findingId: record.id,
            source: e.source,
            url: e.url ?? null,
            observedAt: new Date(e.observedAt),
            observedValue: e.observedValue as Prisma.InputJsonValue,
            expectedValue: e.expectedValue
              ? (e.expectedValue as Prisma.InputJsonValue)
              : undefined,
            httpStatus: e.httpStatus ?? null,
            confidence: e.confidence,
            evidenceHash: e.evidenceHash,
          })),
          skipDuplicates: true,
        });
      }
    }

    return {
      dbId: record.id,
      fingerprint: record.fingerprint,
      isNew,
    };
  });
}

export async function persistDiagnosticBatch(
  siteId: string,
  findings: DiagnosticFinding[],
  priorities: Map<string, ExplainablePriority>,
): Promise<PersistedFindingResult[]> {
  const results: PersistedFindingResult[] = [];

  for (const finding of findings) {
    try {
      const priority = priorities.get(finding.fingerprint);
      const result = await persistFindingWithEvidence(siteId, finding, priority);
      results.push(result);
    } catch (err) {
      logger.error("[DiagnosticPersistence] Failed to persist finding:", {
        fingerprint: finding.fingerprint,
        issueType: finding.issueType,
        error: (err as Error)?.message,
      });
      throw err;
    }
  }

  return results;
}

export async function markFindingResolved(
  siteId: string,
  fingerprint: string,
): Promise<boolean> {
  const result = await prisma.diagnosticFindingRecord.updateMany({
    where: {
      siteId,
      fingerprint,
      status: { in: ["FAIL", "WARNING", "UNKNOWN"] },
    },
    data: {
      status: "PASS",
      resolvedAt: new Date(),
    },
  });
  return result.count > 0;
}

export async function getFindingByFingerprint(
  siteId: string,
  fingerprint: string,
): Promise<{ dbId: string; status: string; fingerprint: string } | null> {
  const record = await prisma.diagnosticFindingRecord.findUnique({
    where: {
      siteId_fingerprint: {
        siteId,
        fingerprint,
      },
    },
    select: {
      id: true,
      status: true,
      fingerprint: true,
    },
  });
  if (!record) return null;
  return { dbId: record.id, status: record.status, fingerprint: record.fingerprint };
}

export async function getFindingByDbId(
  dbId: string,
): Promise<{ dbId: string; status: string; fingerprint: string; siteId: string } | null> {
  const record = await prisma.diagnosticFindingRecord.findUnique({
    where: { id: dbId },
    select: {
      id: true,
      status: true,
      fingerprint: true,
      siteId: true,
    },
  });
  if (!record) return null;
  return { dbId: record.id, status: record.status, fingerprint: record.fingerprint, siteId: record.siteId };
}
