// =============================================================================
// PROPOSAL GENERATOR — Converts Opportunities into Concrete Action Proposals
//
// Takes a GrowthDecision (opportunity) and produces an ActionProposal with:
//   - Concrete proposed changes (current value → proposed value)
//   - Verification criteria
//   - Safety tier classification
//   - Approval requirements
//
// The generator NEVER mutates anything. It only observes current state
// and produces a proposal for the ActionRunner to execute later.
// =============================================================================

import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import {
  type ActionType,
  type ProposedChange,
  type VerificationCriterion,
  FINDING_TO_ACTION_MAP,
  VERIFICATION_CRITERIA_MAP,
} from "./types";
import {
  evaluatePolicy,
  hashProposedChanges,
  generateProposalIdempotencyKey,
} from "./safety-policy";
import { transitionOpportunity } from "./opportunity-lifecycle";

// ── Public API ──────────────────────────────────────────────────────────────

export interface GenerateProposalInput {
  /** The GrowthDecision ID (opportunity) */
  decisionId: string;
  /** Actor who triggered generation (usually "system:proposal-generator") */
  actorId?: string;
}

export interface GenerateProposalResult {
  proposalId: string | null;
  actionType: ActionType;
  status: "CREATED" | "IDEMPOTENT_HIT" | "SKIPPED" | "ERROR";
  reason: string;
  autoApproved: boolean;
}

/**
 * Generates an ActionProposal from a GrowthDecision.
 *
 * Flow:
 *   1. Load the GrowthDecision with its source findings
 *   2. Determine the ActionType from the finding type / growth action
 *   3. Fetch current state of the target entity
 *   4. Generate proposed changes
 *   5. Evaluate safety policy (tier, approval, retry)
 *   6. Create the ActionProposal record
 *   7. Auto-approve if policy allows (Tier 1)
 *   8. Transition opportunity to PROPOSED
 */
export async function generateProposal(
  input: GenerateProposalInput
): Promise<GenerateProposalResult> {
  const actorId = input.actorId ?? "system:proposal-generator";
  const { prisma } = await import("@/lib/prisma");

  // 1. Load the GrowthDecision
  const decision = await (prisma as any).growthDecision.findUnique({
    where: { id: input.decisionId },
    include: {
      sourceFindings: {
        include: {
          finding: {
            select: {
              type: true,
              severity: true,
              title: true,
              description: true,
              confidence: true,
              resourceType: true,
              resourceId: true,
              recommendation: true,
            },
          },
        },
      },
    },
  });

  if (!decision) {
    return {
      proposalId: null,
      actionType: "UPDATE_META_DESCRIPTION",
      status: "ERROR",
      reason: `GrowthDecision ${input.decisionId} not found`,
      autoApproved: false,
    };
  }

  // Only generate for OPEN opportunities
  if (decision.opportunityStatus && decision.opportunityStatus !== "OPEN") {
    return {
      proposalId: null,
      actionType: "UPDATE_META_DESCRIPTION",
      status: "SKIPPED",
      reason: `Opportunity is in status ${decision.opportunityStatus}, not OPEN`,
      autoApproved: false,
    };
  }

  // 2. Determine ActionType
  const findingType = decision.sourceFindings?.[0]?.finding?.type ?? decision.action;
  const mapping = FINDING_TO_ACTION_MAP[findingType];
  const actionType: ActionType = mapping?.actionType ?? mapGrowthActionToActionType(decision.action);

  // 3. Check idempotency
  const idempotencyKey = generateProposalIdempotencyKey(
    decision.siteId,
    decision.id,
    actionType,
    decision.url
  );

  const existingProposal = await (prisma as any).actionProposal.findUnique({
    where: { idempotencyKey },
  });

  if (existingProposal) {
    logger.info("[ProposalGenerator] Idempotent hit", {
      proposalId: existingProposal.id,
      idempotencyKey,
    });
    return {
      proposalId: existingProposal.id,
      actionType,
      status: "IDEMPOTENT_HIT",
      reason: "Proposal already exists for this opportunity + action",
      autoApproved: existingProposal.status === "APPROVED",
    };
  }

  // 4. Fetch current target state and generate proposed changes
  const targetEntity = await resolveTarget(prisma, decision.siteId, decision.url);
  const proposedChanges = generateChangesForAction(
    actionType,
    decision,
    targetEntity
  );

  if (proposedChanges.length === 0) {
    return {
      proposalId: null,
      actionType,
      status: "SKIPPED",
      reason: "No changes needed — target already in desired state",
      autoApproved: false,
    };
  }

  // 5. Evaluate safety policy
  const policy = evaluatePolicy(actionType);

  // 6. Build verification criteria with dynamic values
  const baseCriteria = VERIFICATION_CRITERIA_MAP[actionType] ?? [];
  const verificationCriteria = populateCriteriaValues(baseCriteria, proposedChanges);

  // 7. Compute approval data
  const approvalHash = hashProposedChanges(actionType, decision.url, proposedChanges);
  const now = new Date();

  // 8. Derive and persist verification URL (Amendment #5)
  // Captured at generation time so CMS config changes after execution
  // don't cause verification to check the wrong location.
  const verificationUrl = await deriveVerificationUrl(
    prisma,
    decision.siteId,
    decision.url
  );

  // 8. Create the ActionProposal
  const proposal = await (prisma as any).actionProposal.create({
    data: {
      siteId: decision.siteId,
      decisionId: decision.id,
      idempotencyKey,
      actionType,
      targetUrl: decision.url,
      verificationUrl, // Persisted at generation time (Amendment #5)
      targetModel: targetEntity ? "Blog" : "Page",
      targetId: targetEntity?.id ?? decision.url,
      status: policy.autoApprove ? "APPROVED" : "READY",
      proposedChanges,
      expectedOutcome: buildExpectedOutcome(actionType, proposedChanges),
      riskLevel: policy.tier <= 1 ? "LOW" : policy.tier === 2 ? "MEDIUM" : "HIGH",
      safetyTier: policy.tier,
      confidence: decision.sourceFindings?.[0]?.finding?.confidence ?? 0.5,
      requiresApproval: !policy.autoApprove,
      verificationCriteria,
      attemptCount: 0,
      maxAttempts: policy.maxAttempts,
      generatedBy: actorId,
      // Auto-approve for Tier 1
      ...(policy.autoApprove
        ? {
            approvedBy: "system:auto-policy",
            approvedAt: now,
            approvalExpiresAt: new Date(
              now.getTime() + policy.approvalTtlMinutes * 60 * 1000
            ),
            approvalHash,
          }
        : {}),
    },
  });

  // 9. Transition opportunity to PROPOSED
  await transitionOpportunity({
    decisionId: decision.id,
    from: "OPEN",
    to: "PROPOSED",
    actorId,
    reason: `Generated ${actionType} proposal`,
    proposalId: proposal.id,
  });

  // If auto-approved, also transition to APPROVED
  if (policy.autoApprove) {
    await transitionOpportunity({
      decisionId: decision.id,
      from: "PROPOSED",
      to: "APPROVED",
      actorId: "system:auto-policy",
      reason: `Tier ${policy.tier} auto-approved`,
      proposalId: proposal.id,
    });
  }

  logger.info("[ProposalGenerator] Proposal created", {
    proposalId: proposal.id,
    decisionId: decision.id,
    actionType,
    safetyTier: policy.tier,
    autoApproved: policy.autoApprove,
    changesCount: proposedChanges.length,
  });

  return {
    proposalId: proposal.id,
    actionType,
    status: "CREATED",
    reason: policy.autoApprove
      ? `Tier ${policy.tier} — auto-approved by policy`
      : `Tier ${policy.tier} — requires human approval`,
    autoApproved: policy.autoApprove,
  };
}

// ── Change Generation per Action Type ───────────────────────────────────────

/**
 * Generates concrete ProposedChange[] for each action type.
 * Each change captures: field, currentValue, proposedValue, reasoning.
 */
function generateChangesForAction(
  actionType: ActionType,
  decision: any,
  targetEntity: any
): ProposedChange[] {
  switch (actionType) {
    case "UPDATE_META_DESCRIPTION": {
      const current = targetEntity?.metaDescription ?? null;
      const keyword = decision.primaryKeyword;
      if (current && current.length >= 50 && current.length <= 160) {
        return []; // Already has a valid meta description
      }
      return [
        {
          field: "metaDescription",
          currentValue: current,
          proposedValue: generateMetaDescription(keyword, decision.url),
          reasoning: current
            ? `Current meta description is ${current.length} chars (out of 50–160 range)`
            : "Page is missing a meta description",
        },
      ];
    }

    case "UPDATE_TITLE_TAG": {
      const current = targetEntity?.title ?? null;
      const keyword = decision.primaryKeyword;
      return [
        {
          field: "title",
          currentValue: current,
          proposedValue: generateTitle(keyword),
          reasoning: "Optimize title tag for improved CTR and keyword relevance",
        },
      ];
    }

    case "FIX_HEADING_HIERARCHY": {
      return [
        {
          field: "content",
          currentValue: "(HTML content)",
          proposedValue: "(heading-corrected HTML)",
          reasoning:
            "Fix heading hierarchy: ensure single H1 and no skipped heading levels",
        },
      ];
    }

    case "ADD_SCHEMA_MARKUP": {
      const current = targetEntity?.schemaMarkup ?? null;
      const keyword = decision.primaryKeyword;
      return [
        {
          field: "schemaMarkup",
          currentValue: current,
          proposedValue: generateSchemaMarkup(keyword),
          reasoning: "Add structured data (JSON-LD) for rich results eligibility",
        },
      ];
    }

    case "ADD_CANONICAL_TAG": {
      return [
        {
          field: "canonicalUrl",
          currentValue: null,
          proposedValue: decision.url,
          reasoning: "Add self-referencing canonical tag to prevent duplicate content issues",
        },
      ];
    }

    case "FIX_BROKEN_LINK": {
      return [
        {
          field: "content",
          currentValue: "(contains broken links)",
          proposedValue: "(links repaired)",
          reasoning: "Fix broken internal links to improve crawlability and user experience",
        },
      ];
    }

    case "ADD_INTERNAL_LINKS": {
      return [
        {
          field: "internalLinks",
          currentValue: "0 inbound links",
          proposedValue: "1+ inbound links from topically related pages",
          reasoning: "Orphan page with insufficient internal links — add contextual links",
        },
      ];
    }

    case "REFRESH_CONTENT": {
      return [
        {
          field: "needsRefresh",
          currentValue: "false",
          proposedValue: "true",
          reasoning: "Flag content for AI-assisted refresh with updated statistics and coverage",
        },
      ];
    }

    case "CONSOLIDATE_CONTENT": {
      return [
        {
          field: "status",
          currentValue: "PUBLISHED",
          proposedValue: "CONSOLIDATED",
          reasoning: "Consolidate cannibalizing page via 301 redirect to primary page",
        },
      ];
    }

    default:
      return [];
  }
}

// ── Content Generation Helpers ──────────────────────────────────────────────

function generateMetaDescription(keyword: string, url: string): string {
  const clean = keyword.replace(/[^\w\s-]/g, "").trim();
  return `Discover everything about ${clean}. Expert analysis, actionable insights, and proven strategies to improve your results. Learn more.`;
}

function generateTitle(keyword: string): string {
  const clean = keyword.replace(/[^\w\s-]/g, "").trim();
  const capitalized = clean
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `${capitalized}: Expert Guide & Analysis (2026)`;
}

function generateSchemaMarkup(keyword: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: generateTitle(keyword),
    description: generateMetaDescription(keyword, ""),
    dateModified: new Date().toISOString(),
  });
}

function buildExpectedOutcome(
  actionType: ActionType,
  changes: ProposedChange[]
): string {
  const fieldNames = changes.map((c) => c.field).join(", ");
  return `After applying ${actionType}, the following fields should be updated: ${fieldNames}. Verification will confirm the changes are live.`;
}

// ── Target Resolution ───────────────────────────────────────────────────────

/**
 * Resolves the target entity from the opportunity's URL.
 * Currently supports Blog entities via slug matching.
 */
async function resolveTarget(
  prisma: any,
  siteId: string,
  url: string
): Promise<any> {
  const slug = url.replace(/^\/blog\//, "").replace(/\/$/, "");
  try {
    return await prisma.blog.findFirst({
      where: { siteId, slug },
    });
  } catch {
    return null;
  }
}

// ── Growth Action → ActionType Mapping ──────────────────────────────────────

/**
 * Maps the existing GrowthAction enum values from Phase A to Phase B ActionTypes.
 * This is the fallback when no finding-level mapping exists.
 */
function mapGrowthActionToActionType(growthAction: string): ActionType {
  const map: Record<string, ActionType> = {
    REFRESH_CONTENT: "REFRESH_CONTENT",
    BUILD_INTERNAL_LINKS: "ADD_INTERNAL_LINKS",
    CREATE_NEW_CONTENT: "GENERATE_CONTENT_BRIEF",
    CONSOLIDATE_CONTENT: "CONSOLIDATE_CONTENT",
    IMPROVE_SEARCH_INTENT: "REFRESH_CONTENT",
    OPTIMIZE_TITLE: "UPDATE_TITLE_TAG",
    OPTIMIZE_CONTENT_DEPTH: "REFRESH_CONTENT",
    DEINDEX_OR_REDIRECT: "REDIRECT_URL",
    MONITOR: "UPDATE_META_DESCRIPTION", // Default: low-risk observation
  };
  return map[growthAction] ?? "UPDATE_META_DESCRIPTION";
}

// ── Criteria Value Population ───────────────────────────────────────────────

/**
 * Populates expectedValue fields in verification criteria from proposed changes.
 */
function populateCriteriaValues(
  criteria: VerificationCriterion[],
  changes: ProposedChange[]
): VerificationCriterion[] {
  const changeMap = new Map<string, string>();
  for (const c of changes) {
    changeMap.set(c.field, c.proposedValue);
  }

  return criteria.map((criterion) => {
    if (criterion.expectedValue) return criterion;

    const fieldMap: Record<string, string> = {
      META_DESCRIPTION_MATCHES: "metaDescription",
      TITLE_MATCHES: "title",
      CANONICAL_MATCHES: "canonicalUrl",
    };

    const field = fieldMap[criterion.check];
    if (field && changeMap.has(field)) {
      return { ...criterion, expectedValue: changeMap.get(field) };
    }

    return criterion;
  });
}

// ── Verification URL Derivation ─────────────────────────────────────────────

/**
 * Derives the external verification URL from the site's domain.
 * Persisted at generation time so configuration changes after execution
 * don't cause verification to check the wrong location.
 *
 * Returns null if no domain is configured (verification falls back to targetUrl).
 */
async function deriveVerificationUrl(
  prisma: any,
  siteId: string,
  targetUrl: string
): Promise<string | null> {
  // If targetUrl is already absolute, use it directly
  if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
    return targetUrl;
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { domain: true },
  });

  if (!site?.domain) return null;

  // Construct the full URL from site domain + relative path
  const domain = site.domain.replace(/\/$/, "");
  const protocol = domain.startsWith("http") ? "" : "https://";
  const path = targetUrl.startsWith("/") ? targetUrl : `/${targetUrl}`;

  return `${protocol}${domain}${path}`;
}
