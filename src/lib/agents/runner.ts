import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createFindingFingerprint } from "./fingerprint";
import type {
  AgentExecution,
  AgentResult,
  AgentStatus,
  AgentFinding,
  AgentError,
} from "./types";

// Prisma enum values (matching schema.prisma)
type PrismaAgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

type PrismaFindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type PrismaFindingStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "REOPENED"
  | "IGNORED";

/** Default timeout: 5 minutes */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-agent timeout defaults (ms) */
const AGENT_TIMEOUTS: Record<string, number> = {
  DISCOVERY: 30_000,
  CRAWL: 5 * 60_000,
  TECHNICAL_SEO: 2 * 60_000,
  INDEXATION: 2 * 60_000,
  SITEMAP: 60_000,
  ROBOTS: 30_000,
  INTERNAL_LINKS: 60_000,
  GSC_INTELLIGENCE: 60_000,
  GA4_INTELLIGENCE: 60_000,
  KEYWORD_INTELLIGENCE: 60_000,
  CANNIBALIZATION: 60_000,
  INTENT: 2 * 60_000,
};

interface RunAgentOptions {
  parentRunId?: string | null;
  triggerEvent?: string;
  inputSnapshot?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Override timeout for this agent run (ms). Defaults to AGENT_TIMEOUTS or 5min. */
  timeoutMs?: number;
}


export async function runAgent<T>(
  agentName: string,
  siteId: string,
  executeFn: () => Promise<AgentExecution<T>>,
  options: RunAgentOptions = {},
): Promise<AgentResult<T>> {
  const startTime = Date.now();

  const agentRun = await prisma.agentRun.create({
    data: {
      siteId,
      agentType: agentName,
      status: "RUNNING" as PrismaAgentRunStatus,
      parentRunId: options.parentRunId ?? null,
      triggerEvent: options.triggerEvent,
      metadata: {
        ...(options.metadata ?? {}),
        ...(options.inputSnapshot ? { inputSnapshot: options.inputSnapshot } : {}),
      } as object,
      startedAt: new Date(),
    },
  });

  let execution: AgentExecution<T>;
  const errors: AgentError[] = [];

  const timeoutMs = options.timeoutMs ?? AGENT_TIMEOUTS[agentName] ?? DEFAULT_TIMEOUT_MS;

  try {
    // 2. Execute the pure agent function with timeout
    execution = await Promise.race([
      executeFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent ${agentName} timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    // Collect any errors reported by the agent
    if (execution.errors) {
      errors.push(...execution.errors);
    }
  } catch (err: unknown) {
    // Fatal error — agent threw
    const message = (err as Error)?.message ?? String(err);
    errors.push({ code: "AGENT_FATAL", message, recoverable: false });

    const durationMs = Date.now() - startTime;

    await prisma.agentRun
      .update({
        where: { id: agentRun.id },
        data: {
          status: "FAILED" as PrismaAgentRunStatus,
          completedAt: new Date(),
          metadata: {
            ...(agentRun.metadata as Record<string, unknown> ?? {}),
            durationMs,
            fatalError: message,
          } as object,
        },
      })
      .catch((e: unknown) =>
        logger.error("[AgentRunner] Failed to update AgentRun on fatal error", {
          runId: agentRun.id,
          error: (e as Error).message,
        }),
      );

    return {
      agent: agentName,
      runId: agentRun.id,
      status: "FAILED",
      data: {} as T,
      findings: [],
      metrics: { durationMs, itemsProcessed: 0 },
      errors,
    };
  }

  // 3. Compute fingerprints for findings that lack them
  const fingerprintedFindings = execution.findings.map((f) => ({
    ...f,
    fingerprint:
      f.fingerprint ??
      createFindingFingerprint({
        siteId,
        type: f.type,
        resourceType: f.affectedResource?.type,
        resourceId: f.affectedResource?.id,
      }),
  }));

  // 4. Persist findings + evidence in a transaction
  const persistedFindingIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const finding of fingerprintedFindings) {
        // Check if a previous finding with this fingerprint was RESOLVED
        const previousFinding = await tx.agentFinding.findFirst({
          where: {
            fingerprint: finding.fingerprint!,
            agentRun: { siteId },
            status: "RESOLVED" as PrismaFindingStatus,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        const findingStatus: PrismaFindingStatus = previousFinding
          ? "REOPENED"
          : "OPEN";

        const created = await tx.agentFinding.create({
          data: {
            agentRunId: agentRun.id,
            fingerprint: finding.fingerprint!,
            type: finding.type,
            severity: finding.severity as PrismaFindingSeverity,
            status: findingStatus,
            title: finding.title,
            description: finding.description,
            confidence: finding.confidence,
            resourceType: finding.affectedResource?.type ?? null,
            resourceId: finding.affectedResource?.id ?? null,
            recommendation: finding.recommendation ?? null,
          },
        });

        persistedFindingIds.push(created.id);

        // Persist evidence rows
        if (finding.evidence.length > 0) {
          await tx.findingEvidence.createMany({
            data: finding.evidence.map((ev) => ({
              findingId: created.id,
              sourceType: ev.sourceType,
              sourceId: ev.sourceId ?? null,
              metric: ev.metric ?? null,
              value: ev.value ?? null,
              metadata: ev.metadata
                ? (JSON.parse(JSON.stringify(ev.metadata)) as Record<string, string>)
                : undefined,
              observedAt: ev.observedAt
                ? new Date(ev.observedAt as string)
                : new Date(),
            })),
          });
        }
      }
    });
  } catch (err: unknown) {
    const message = (err as Error)?.message ?? String(err);
    logger.error("[AgentRunner] Failed to persist findings", {
      runId: agentRun.id,
      error: message,
    });
    errors.push({
      code: "FINDING_PERSISTENCE_FAILED",
      message,
      recoverable: true,
    });
  }

  // 5. Determine result status BEFORE reconciliation
  const durationMs = Date.now() - startTime;
  let status: AgentStatus;

  if (errors.some((e) => !e.recoverable)) {
    status = "FAILED";
  } else if (errors.length > 0) {
    status = "PARTIAL";
  } else {
    status = "COMPLETED";
  }

  // 6. Reconcile ONLY on successful completion
  //    Never reconcile after PARTIAL/FAILED — those runs may have missed
  //    findings due to errors, not because issues were resolved.
  if (status === "COMPLETED") {
    try {
      await reconcileFindings(siteId, agentName, agentRun.id, fingerprintedFindings);
    } catch (err: unknown) {
      logger.warn("[AgentRunner] Finding reconciliation failed (non-fatal)", {
        runId: agentRun.id,
        error: (err as Error)?.message,
      });
    }
  }

  // 7. Update AgentRun to final status
  await prisma.agentRun
    .update({
      where: { id: agentRun.id },
      data: {
        status: status as PrismaAgentRunStatus,
        completedAt: new Date(),
        itemsProcessed: execution.itemsProcessed ?? 0,
        findingCount: persistedFindingIds.length,
        tokensUsed: execution.tokensUsed ?? null,
        costUsd: execution.estimatedCostUsd ?? null,
      },
    })
    .catch((e: unknown) =>
      logger.error("[AgentRunner] Failed to finalize AgentRun", {
        runId: agentRun.id,
        error: (e as Error).message,
      }),
    );

  logger.info(`[AgentRunner] ${agentName} completed`, {
    runId: agentRun.id,
    status,
    findings: persistedFindingIds.length,
    durationMs,
  });

  // 8. Return AgentResult
  return {
    agent: agentName,
    runId: agentRun.id,
    status,
    data: execution.data,
    findings: fingerprintedFindings,
    metrics: {
      durationMs,
      itemsProcessed: execution.itemsProcessed ?? 0,
      tokensUsed: execution.tokensUsed,
      estimatedCostUsd: execution.estimatedCostUsd,
    },
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding Reconciliation
//
// After an agent run, any previously-OPEN findings (same agent + site) that
// were NOT observed in this run are marked RESOLVED.
//
// This is the mechanism that gives findings lifecycle:
//   Run N: issue present → OPEN
//   Run N+1: issue absent → RESOLVED
//   Run N+2: issue returns → REOPENED (handled at creation time above)
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileFindings(
  siteId: string,
  agentType: string,
  currentRunId: string,
  currentFindings: AgentFinding[],
): Promise<void> {
  const currentFingerprints = new Set(
    currentFindings.map((f) => f.fingerprint).filter(Boolean),
  );



  // Find the most recent previous run of this agent type for this site
  const previousRun = await prisma.agentRun.findFirst({
    where: {
      siteId,
      agentType,
      id: { not: currentRunId },
      status: { in: ["COMPLETED", "PARTIAL"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!previousRun) return;

  // Get all OPEN/REOPENED findings from previous runs of this agent
  const previousFindings = await prisma.agentFinding.findMany({
    where: {
      agentRun: {
        siteId,
        agentType,
        id: { not: currentRunId },
      },
      status: { in: ["OPEN", "REOPENED"] },
    },
    select: { id: true, fingerprint: true },
  });

  // Mark findings not observed in current run as RESOLVED
  const toResolve = previousFindings.filter(
    (f: { id: string; fingerprint: string }) => !currentFingerprints.has(f.fingerprint),
  );

  if (toResolve.length > 0) {
    await prisma.agentFinding.updateMany({
      where: { id: { in: toResolve.map((f: { id: string }) => f.id) } },
      data: {
        status: "RESOLVED" as PrismaFindingStatus,
      },
    });

    logger.info("[AgentRunner] Reconciled findings", {
      siteId,
      agentType,
      resolved: toResolve.length,
    });
  }
}
