// =============================================================================
// VERIFICATION LOOP — Closed-Loop Outcome Verification
//
// After an action is executed, the verification loop:
//   1. Fetches the target URL
//   2. Parses the HTML
//   3. Runs each verification criterion check
//   4. Updates the proposal with verification results
//   5. Transitions the proposal and opportunity to VERIFIED or FAILED
//
// This is the most important Phase B component. Without it, the system
// would claim success merely because it attempted a fix.
// =============================================================================

import { logger } from "@/lib/logger";
import {
  type ActionType,
  type VerificationCriterion,
  type VerificationDetail,
  type VerificationOutcome,
  type ProposedChange,
  VERIFICATION_CRITERIA_MAP,
  VERIFICATION_DELAYS,
} from "./types";
import { parsePage, runAllChecks } from "./verification-checks";
import { transitionOpportunity } from "./opportunity-lifecycle";

// ── Public API ──────────────────────────────────────────────────────────────

export interface VerificationInput {
  proposalId: string;
}

export interface VerificationOutput {
  proposalId: string;
  outcome: VerificationOutcome;
  details: VerificationDetail[];
  durationMs: number;
}

/**
 * Runs the full verification loop for an executed proposal.
 *
 * 1. Load the ActionProposal (must be in EXECUTED or VERIFYING status)
 * 2. Fetch the target URL via HTTP GET
 * 3. Parse HTML and run all verification criteria
 * 4. Compute outcome: VERIFIED, FAILED, or PARTIAL
 * 5. Persist results to the proposal
 * 6. Transition proposal → VERIFIED or FAILED
 * 7. Transition opportunity → VERIFIED or FAILED
 * 8. If VERIFIED, mark source findings as RESOLVED
 */
export async function verifyProposal(
  input: VerificationInput
): Promise<VerificationOutput> {
  const startMs = Date.now();
  const { prisma } = await import("@/lib/prisma");

  // 1. Load proposal
  const proposal = await (prisma as any).actionProposal.findUniqueOrThrow({
    where: { id: input.proposalId },
    include: {
      decision: {
        select: {
          id: true,
          opportunityStatus: true,
          siteId: true,
          sourceFindings: {
            select: {
              findingId: true,
            },
          },
        },
      },
    },
  });

  if (!["EXECUTED", "VERIFYING"].includes(proposal.status)) {
    throw new Error(
      `Cannot verify proposal ${input.proposalId}: status is ${proposal.status}, expected EXECUTED or VERIFYING`
    );
  }

  // Transition proposal to VERIFYING if not already
  if (proposal.status === "EXECUTED") {
    await (prisma as any).actionProposal.update({
      where: { id: input.proposalId },
      data: { status: "VERIFYING" },
    });
  }

  const actionType = proposal.actionType as ActionType;
  const proposedChanges = proposal.proposedChanges as ProposedChange[];

  // 2. Build verification criteria with dynamic expectedValues
  const baseCriteria =
    VERIFICATION_CRITERIA_MAP[actionType] ?? [];
  const criteria = hydrateCriteria(baseCriteria, proposedChanges);

  // 3. Fetch and parse the target URL
  let html: string;
  let httpStatus: number;

  try {
    const response = await fetchTargetUrl(proposal.targetUrl);
    html = response.html;
    httpStatus = response.status;
  } catch (fetchErr) {
    logger.error("[Verification] Failed to fetch target URL", {
      proposalId: input.proposalId,
      targetUrl: proposal.targetUrl,
      error: (fetchErr as Error)?.message,
    });

    // Record fetch failure
    const failureDetails: VerificationDetail[] = [
      {
        check: "HTTP_STATUS_200",
        passed: false,
        message: `Fetch failed: ${(fetchErr as Error)?.message}`,
      },
    ];

    await persistVerificationResult(
      prisma,
      input.proposalId,
      "FAILED",
      failureDetails
    );

    // Transition statuses
    await transitionProposalStatus(prisma, input.proposalId, "FAILED");
    await transitionOpportunity({
      decisionId: proposal.decisionId,
      from: "VERIFYING",
      to: "FAILED",
      actorId: "system:verifier",
      reason: `Verification fetch failed: ${(fetchErr as Error)?.message}`,
      proposalId: input.proposalId,
    });

    return {
      proposalId: input.proposalId,
      outcome: "FAILED",
      details: failureDetails,
      durationMs: Date.now() - startMs,
    };
  }

  // 4. Run verification checks
  const page = parsePage(html, httpStatus, proposal.targetUrl);
  const { details, allCriticalPassed } = runAllChecks(criteria, page);

  // 5. Compute outcome
  const allPassed = details.every((d) => d.passed);
  const outcome: VerificationOutcome = allCriticalPassed
    ? allPassed
      ? "VERIFIED"
      : "PARTIAL"
    : "FAILED";

  // Treat PARTIAL as VERIFIED (advisory checks failed but critical passed)
  const effectiveOutcome = outcome === "PARTIAL" ? "VERIFIED" : outcome;

  logger.info("[Verification] Checks completed", {
    proposalId: input.proposalId,
    outcome,
    effectiveOutcome,
    totalChecks: details.length,
    passed: details.filter((d) => d.passed).length,
    failed: details.filter((d) => !d.passed).length,
  });

  // 6. Persist results
  await persistVerificationResult(
    prisma,
    input.proposalId,
    effectiveOutcome as VerificationOutcome,
    details
  );

  // 7. Transition proposal status
  const newProposalStatus =
    effectiveOutcome === "VERIFIED" ? "VERIFIED" : "FAILED";
  await transitionProposalStatus(prisma, input.proposalId, newProposalStatus);

  // 8. Transition opportunity status
  const newOpportunityStatus =
    effectiveOutcome === "VERIFIED" ? "VERIFIED" : "FAILED";
  await transitionOpportunity({
    decisionId: proposal.decisionId,
    from: "VERIFYING",
    to: newOpportunityStatus,
    actorId: "system:verifier",
    reason: `Verification ${effectiveOutcome}: ${details.filter((d) => !d.passed).length} check(s) failed`,
    proposalId: input.proposalId,
  });

  // 9. If VERIFIED, mark source findings as RESOLVED
  if (effectiveOutcome === "VERIFIED" && proposal.decision?.sourceFindings) {
    for (const link of proposal.decision.sourceFindings) {
      try {
        await (prisma as any).agentFinding.updateMany({
          where: {
            id: link.findingId,
            status: { in: ["OPEN", "REOPENED"] },
          },
          data: { status: "RESOLVED" },
        });
      } catch {
        // Fail open — finding resolution is best-effort
      }
    }
  }

  return {
    proposalId: input.proposalId,
    outcome: effectiveOutcome as VerificationOutcome,
    details,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Returns the recommended verification delay (in ms) for an action type.
 */
export function getVerificationDelay(actionType: ActionType): number {
  return VERIFICATION_DELAYS[actionType] ?? 5 * 60 * 1000;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Populates expectedValue fields in verification criteria from the
 * proposed changes. E.g., META_DESCRIPTION_MATCHES gets its expectedValue
 * from the proposedChange with field="metaDescription".
 */
function hydrateCriteria(
  baseCriteria: VerificationCriterion[],
  proposedChanges: ProposedChange[]
): VerificationCriterion[] {
  const changeMap = new Map<string, ProposedChange>();
  for (const change of proposedChanges) {
    changeMap.set(change.field, change);
  }

  return baseCriteria.map((criterion) => {
    // If this criterion already has an expectedValue, keep it
    if (criterion.expectedValue) return criterion;

    // Map check types to the relevant proposed change field
    const fieldMapping: Partial<Record<string, string>> = {
      META_DESCRIPTION_MATCHES: "metaDescription",
      TITLE_MATCHES: "title",
      CANONICAL_MATCHES: "canonicalUrl",
      CONTENT_CONTAINS_KEYWORD: "primaryKeyword",
    };

    const field = fieldMapping[criterion.check];
    if (field) {
      const change = changeMap.get(field);
      if (change) {
        return { ...criterion, expectedValue: change.proposedValue };
      }
    }

    // For CANONICAL_UNCHANGED: set expectedValue to the current canonical
    if (criterion.check === "CANONICAL_UNCHANGED") {
      const canonicalChange = changeMap.get("canonicalUrl");
      if (canonicalChange?.currentValue) {
        return { ...criterion, expectedValue: canonicalChange.currentValue };
      }
    }

    return criterion;
  });
}

/**
 * Lightweight fetch of a target URL for verification.
 * Returns the HTML body and HTTP status.
 */
async function fetchTargetUrl(
  url: string
): Promise<{ html: string; status: number }> {
  // Normalize URL — if relative, we can't fetch it
  if (!url.startsWith("http")) {
    throw new Error(`Cannot verify relative URL: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "OptiAISEO-Verifier/1.0 (+https://optiaiseo.online)",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    const html = await response.text();
    return { html, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Persists verification results to the ActionProposal.
 */
async function persistVerificationResult(
  prisma: any,
  proposalId: string,
  outcome: VerificationOutcome,
  details: VerificationDetail[]
): Promise<void> {
  await prisma.actionProposal.update({
    where: { id: proposalId },
    data: {
      verificationResult: outcome,
      verificationDetails: details,
      verifiedAt: new Date(),
    },
  });
}

/**
 * Transitions the proposal status.
 */
async function transitionProposalStatus(
  prisma: any,
  proposalId: string,
  newStatus: string
): Promise<void> {
  await prisma.actionProposal.update({
    where: { id: proposalId },
    data: {
      status: newStatus,
      ...(["VERIFIED", "FAILED", "REJECTED", "EXPIRED"].includes(newStatus)
        ? { completedAt: new Date() }
        : {}),
    },
  });
}
