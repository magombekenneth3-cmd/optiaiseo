/**
 * Phase D.3 — Deterministic Action Planners
 *
 * One planner per action family. Each answers:
 *   - Can this action be performed given the evidence?
 *   - What resource does it target?
 *   - What evidence supports it?
 *   - What parameters are required?
 *   - What constraints apply?
 *
 * RULES:
 *   1. Planners are pure functions — no DB writes, no side effects
 *   2. Same input → same plan (deterministic)
 *   3. If planner cannot plan → return false from canPlan()
 *   4. Planners never invent new action types
 */

import type { ActionPlanner, PlanningInput, ActionPlan, PlanningReason } from "../types";
import { PLANNING_VERSION } from "../types";
import { getSafetyTier } from "@/lib/proposals/types";

// ── Shared Helpers ──────────────────────────────────────────────────────────

function buildBaseRationale(input: PlanningInput): PlanningReason[] {
  const reasons: PlanningReason[] = [
    {
      rule: "CATEGORY_MATCH",
      details: `Opportunity category: ${input.opportunity.category}`,
    },
  ];

  if (input.scoreRecord) {
    reasons.push({
      rule: "SCORE_SUPPORT",
      details: `D.2 score: ${input.scoreRecord.finalScore} (${input.scoreRecord.decision})`,
    });
  }

  if (input.opportunity.discoveryConfidence !== null) {
    reasons.push({
      rule: "DISCOVERY_CONFIDENCE",
      details: `D.1 confidence: ${(input.opportunity.discoveryConfidence * 100).toFixed(0)}%`,
    });
  }

  return reasons;
}

function getEvidenceIds(input: PlanningInput): string[] {
  return input.evidence.map((e) => e.id);
}

// ── REFRESH_CONTENT Planner ─────────────────────────────────────────────────

export const refreshContentPlanner: ActionPlanner = {
  actionType: "REFRESH_CONTENT",

  canPlan(input: PlanningInput): boolean {
    // Needs a URL to refresh and some evidence
    return !!input.opportunity.url && input.evidence.length > 0;
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "CONTENT_REFRESH_NEEDED",
      details: `Page ${input.opportunity.url} requires content refresh for keyword "${input.opportunity.primaryKeyword}"`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "REFRESH_CONTENT",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Refresh content on ${input.opportunity.url} to improve ranking for "${input.opportunity.primaryKeyword}"`,
      constraints: {
        preserveExistingLinks: true,
        requireCanonicalPreservation: true,
        safetyTier: getSafetyTier("REFRESH_CONTENT"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── ADD_INTERNAL_LINKS Planner ──────────────────────────────────────────────

export const internalLinksPlanner: ActionPlanner = {
  actionType: "ADD_INTERNAL_LINKS",

  canPlan(input: PlanningInput): boolean {
    return !!input.opportunity.url && input.evidence.length > 0;
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "INTERNAL_LINKS_NEEDED",
      details: `Page ${input.opportunity.url} has insufficient internal links`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "ADD_INTERNAL_LINKS",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Add internal links to ${input.opportunity.url} to improve crawlability and ranking for "${input.opportunity.primaryKeyword}"`,
      constraints: {
        preserveExistingLinks: true,
        requireCanonicalPreservation: true,
        safetyTier: getSafetyTier("ADD_INTERNAL_LINKS"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── UPDATE_TITLE_TAG Planner ────────────────────────────────────────────────

export const titlePlanner: ActionPlanner = {
  actionType: "UPDATE_TITLE_TAG",

  canPlan(input: PlanningInput): boolean {
    return !!input.opportunity.url && !!input.opportunity.primaryKeyword;
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "TITLE_OPTIMIZATION",
      details: `Title optimization for "${input.opportunity.primaryKeyword}" on ${input.opportunity.url}`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "UPDATE_TITLE_TAG",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Optimize title tag on ${input.opportunity.url} for "${input.opportunity.primaryKeyword}" to improve CTR`,
      constraints: {
        requireCanonicalPreservation: true,
        safetyTier: getSafetyTier("UPDATE_TITLE_TAG"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── UPDATE_META_DESCRIPTION Planner ─────────────────────────────────────────

export const metaDescriptionPlanner: ActionPlanner = {
  actionType: "UPDATE_META_DESCRIPTION",

  canPlan(input: PlanningInput): boolean {
    return !!input.opportunity.url && !!input.opportunity.primaryKeyword;
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "META_DESCRIPTION_OPTIMIZATION",
      details: `Meta description optimization for "${input.opportunity.primaryKeyword}"`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "UPDATE_META_DESCRIPTION",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Optimize meta description on ${input.opportunity.url} for "${input.opportunity.primaryKeyword}" to improve CTR`,
      constraints: {
        requireCanonicalPreservation: true,
        safetyTier: getSafetyTier("UPDATE_META_DESCRIPTION"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── CONSOLIDATE_CONTENT Planner ─────────────────────────────────────────────

export const consolidationPlanner: ActionPlanner = {
  actionType: "CONSOLIDATE_CONTENT",

  canPlan(input: PlanningInput): boolean {
    // Consolidation needs the target URL and evidence of cannibalization/dead-weight
    return (
      !!input.opportunity.url &&
      ["CANNIBALIZATION", "DEAD_WEIGHT"].includes(input.opportunity.category)
    );
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "CONTENT_CONSOLIDATION",
      details: `Content at ${input.opportunity.url} identified for consolidation (${input.opportunity.category})`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "CONSOLIDATE_CONTENT",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Consolidate content at ${input.opportunity.url} to resolve ${input.opportunity.category.toLowerCase()} issue`,
      constraints: {
        preserveExistingLinks: true,
        requireCanonicalPreservation: false, // Canonical may change during consolidation
        safetyTier: getSafetyTier("CONSOLIDATE_CONTENT"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── REDIRECT_URL Planner ────────────────────────────────────────────────────

export const redirectPlanner: ActionPlanner = {
  actionType: "REDIRECT_URL",

  canPlan(input: PlanningInput): boolean {
    return (
      !!input.opportunity.url &&
      ["CANNIBALIZATION", "DEAD_WEIGHT"].includes(input.opportunity.category)
    );
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "REDIRECT_NEEDED",
      details: `Page ${input.opportunity.url} should be redirected (${input.opportunity.category})`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "REDIRECT_URL",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Redirect ${input.opportunity.url} to consolidate traffic`,
      constraints: {
        safetyTier: getSafetyTier("REDIRECT_URL"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
        redirectType: "301",
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── DELETE_PAGE Planner ─────────────────────────────────────────────────────

export const removalPlanner: ActionPlanner = {
  actionType: "DELETE_PAGE",

  canPlan(input: PlanningInput): boolean {
    return (
      !!input.opportunity.url &&
      input.opportunity.category === "DEAD_WEIGHT"
    );
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "PAGE_REMOVAL",
      details: `Dead-weight page ${input.opportunity.url} — zero traffic, no referring domains`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "DELETE_PAGE",
      resourceType: "PAGE",
      resourceId: input.opportunity.url,
      targetUrl: input.opportunity.url,
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Remove dead-weight page ${input.opportunity.url} to improve crawl budget`,
      constraints: {
        safetyTier: getSafetyTier("DELETE_PAGE"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── GENERATE_CONTENT_BRIEF Planner ──────────────────────────────────────────

export const contentBriefPlanner: ActionPlanner = {
  actionType: "GENERATE_CONTENT_BRIEF",

  canPlan(input: PlanningInput): boolean {
    return !!input.opportunity.primaryKeyword;
  },

  plan(input: PlanningInput): ActionPlan {
    const reasons = buildBaseRationale(input);
    reasons.push({
      rule: "CONTENT_BRIEF",
      details: `Generate content brief for "${input.opportunity.primaryKeyword}"`,
    });

    return {
      opportunityId: input.opportunity.id,
      siteId: input.opportunity.siteId,
      actionType: "GENERATE_CONTENT_BRIEF",
      resourceType: "SITE",
      resourceId: input.opportunity.siteId,
      targetUrl: input.opportunity.url || "/",
      rationale: reasons,
      evidenceIds: getEvidenceIds(input),
      expectedOutcome: `Create content brief targeting "${input.opportunity.primaryKeyword}"`,
      constraints: {
        safetyTier: getSafetyTier("GENERATE_CONTENT_BRIEF"),
      },
      parameters: {
        primaryKeyword: input.opportunity.primaryKeyword,
        category: input.opportunity.category,
      },
      planningVersion: PLANNING_VERSION,
      evidenceHash: input.scoreRecord?.evidenceHash ?? "",
    };
  },
};

// ── Planner Registry ────────────────────────────────────────────────────────

export const PLANNER_REGISTRY: Record<string, ActionPlanner> = {
  REFRESH_CONTENT: refreshContentPlanner,
  ADD_INTERNAL_LINKS: internalLinksPlanner,
  UPDATE_TITLE_TAG: titlePlanner,
  UPDATE_META_DESCRIPTION: metaDescriptionPlanner,
  CONSOLIDATE_CONTENT: consolidationPlanner,
  REDIRECT_URL: redirectPlanner,
  DELETE_PAGE: removalPlanner,
  GENERATE_CONTENT_BRIEF: contentBriefPlanner,
};

/**
 * Returns the planner for a given action type, or null if none exists.
 */
export function getPlanner(actionType: string): ActionPlanner | null {
  return PLANNER_REGISTRY[actionType] ?? null;
}
