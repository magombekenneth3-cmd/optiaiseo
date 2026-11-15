/**
 * src/lib/seo-audit/live-verify.ts
 *
 * Shared T+0 live diagnostic verification service:
 *   1. Reconstructs VerificationCriterion[] from persisted finding criteria or DIAGNOSTIC_RULES
 *   2. Resolves a canonical same-origin target URL
 *   3. Runs synchronous technical checks via runTechnicalVerification()
 *   4. Best-effort inspects live GSC URL status via inspectGscUrl()
 *   5. Updates DiagnosticFindingRecord status + transitions lifecycle state
 *   6. Persists SEOEvidenceRecord and schedules T+7 verification via Inngest
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { inngest } from "@/lib/inngest/client";
import { inspectGscUrl, type GscUrlInspectionResult } from "@/lib/gsc/indexing";
import { computeEvidenceHash } from "./contracts";
import { persistDiagnosticEvidence } from "./diagnostic-persistence";
import {
  DIAGNOSTIC_RULES,
  tryDeterministicFix,
  type VerificationCriterion,
} from "./diagnostic-engine";
import { LIFECYCLE_STATE, transitionLifecycleState } from "./lifecycle";
import {
  runTechnicalVerification,
  type VerificationFetcher,
  type VerificationResult,
} from "./verification-runner";

export interface LiveVerifyFindingInput {
  id: string;
  siteId: string;
  fingerprint: string;
  issueType: string;
  status: string;
  scopeUrls: string[];
  rootCause: string;
  verificationCriteria?: unknown;
  lifecycleState: string;
}

export interface LiveVerifySiteInput {
  id?: string;
  userId: string;
  domain: string;
}

export interface VerifyFindingLiveParams {
  finding: LiveVerifyFindingInput;
  site: LiveVerifySiteInput;
  explicitUrl?: string | null;
  includeGscInspection?: boolean;
  deploymentRevision?: string | null;
  fetcher?: VerificationFetcher;
}

export interface VerifyFindingLiveOutcome {
  findingId: string;
  siteId: string;
  url: string;
  verified: boolean;
  outcome: VerificationResult["outcome"];
  status: string;
  lifecycleState: string;
  passedCount: number;
  totalCount: number;
  durationMs: number;
  verifiedAt: string;
  criteria: VerificationResult["criteria"];
  gscInspection: GscUrlInspectionResult | null;
  t7Scheduled: boolean;
  evidenceHash: string;
}

export function mapTechnicalOutcomeToDiagnosticStatus(
  outcome: VerificationResult["outcome"],
): "WARNING" | "UNKNOWN" | "FAIL" {
  if (outcome === "TECHNICALLY_VERIFIED" || outcome === "PARTIALLY_VERIFIED") {
    return "WARNING";
  }
  if (outcome === "UNKNOWN") {
    return "UNKNOWN";
  }
  return "FAIL";
}

export function buildT0ObservedValue(params: {
  result: VerificationResult;
  deploymentRevision?: string | null;
  trigger: "DEPLOYED" | "LIVE_MANUAL";
  gscInspection?: GscUrlInspectionResult | null;
}): Record<string, unknown> {
  const { result, deploymentRevision, trigger, gscInspection } = params;
  return {
    verificationType: "T0_TECHNICAL",
    trigger,
    outcome: result.outcome,
    passedCount: result.passedCount,
    totalCount: result.totalCount,
    verifiedAt: result.verifiedAt,
    deploymentRevision: deploymentRevision ?? null,
    criteria: result.criteria.map((c) => ({
      type: c.criterion.type,
      passed: c.passed,
      actual: c.actual,
      error: c.error,
    })),
    ...(gscInspection
      ? {
          gscInspection: gscInspection.success
            ? { status: "OK", ...gscInspection.data }
            : { status: gscInspection.code, message: gscInspection.message },
        }
      : {}),
  };
}

function normalizeHost(domainOrHost: string): string {
  return domainOrHost
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

export function resolveVerificationTargetUrl(
  siteDomain: string,
  scopeUrls: string[],
  explicitUrl?: string | null,
): string {
  const cleanHost = normalizeHost(siteDomain);
  const baseOrigin = `https://${siteDomain.trim().replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "") || cleanHost}`;

  const tryNormalizeCandidate = (raw: string | null | undefined): string | null => {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    try {
      const parsed = trimmed.startsWith("/")
        ? new URL(trimmed, baseOrigin)
        : new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      const host = normalizeHost(parsed.hostname);
      if (cleanHost && host !== cleanHost) {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  };

  if (explicitUrl) {
    const resolvedExplicit = tryNormalizeCandidate(explicitUrl);
    if (!resolvedExplicit) {
      throw new Error("Verification URL must belong to the site's domain");
    }
    return resolvedExplicit;
  }

  for (const candidate of scopeUrls || []) {
    const resolved = tryNormalizeCandidate(candidate);
    if (resolved) return resolved;
  }

  return `${baseOrigin}/`;
}

const CAUSE_TOKEN_STOPWORDS = new Set([
  "to", "of", "in", "on", "at", "by", "is", "be", "an", "or", "as", "it",
  "the", "and", "for", "with", "from", "that", "this", "are", "was",
]);

function tokenizeDiagnosticText(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !CAUSE_TOKEN_STOPWORDS.has(w));
  return new Set(tokens);
}

function scoreCauseLabelSimilarity(rootCauseText: string, causeLabel: string, causeId: string): number {
  const normRoot = rootCauseText.toLowerCase();
  const normLabel = causeLabel.toLowerCase();
  if (normRoot === normLabel) return 100;
  if (normRoot.includes(causeId.toLowerCase())) return 90;

  const rootTokens = tokenizeDiagnosticText(normRoot);
  const causeTokens = tokenizeDiagnosticText(`${causeId.replace(/_/g, " ")} ${normLabel}`);
  if (rootTokens.size === 0 || causeTokens.size === 0) return 0;

  let hits = 0;
  for (const token of causeTokens) {
    if (rootTokens.has(token)) hits++;
  }

  return Math.round(((2 * hits) / (rootTokens.size + causeTokens.size)) * 80);
}

function derivePreferredUrl(currentUrl: string): string {
  try {
    const parsed = new URL(currentUrl);
    if (parsed.search) {
      parsed.search = "";
      return parsed.toString();
    }
    return currentUrl;
  } catch {
    return currentUrl;
  }
}

function hydrateCriterionPlaceholders(
  criteria: VerificationCriterion[],
  currentUrl: string | null,
): VerificationCriterion[] {
  if (!currentUrl) return criteria;
  const preferredUrl = derivePreferredUrl(currentUrl);

  const replaceToken = (value: string): string => {
    if (value === "__CURRENT_URL__") return currentUrl;
    if (value === "__PREFERRED_URL__") return preferredUrl;
    return value;
  };

  return criteria.map((criterion) => {
    let next = criterion;
    if ("url" in criterion && typeof criterion.url === "string") {
      const updatedUrl = replaceToken(criterion.url);
      if (updatedUrl !== criterion.url) {
        next = { ...next, url: updatedUrl } as VerificationCriterion;
      }
    }
    if (next.type === "HTML_SELECTOR" && typeof next.expected === "string") {
      const updatedExpected = replaceToken(next.expected);
      if (updatedExpected !== next.expected) {
        next = { ...next, expected: updatedExpected };
      }
    }
    return next;
  });
}

function resolveOptionalTargetUrl(
  scopeUrls: string[] | undefined,
  siteDomain?: string,
  explicitUrl?: string,
): string | null {
  if (explicitUrl) return explicitUrl;
  if (siteDomain) {
    try {
      return resolveVerificationTargetUrl(siteDomain, scopeUrls ?? []);
    } catch {
      return null;
    }
  }
  for (const raw of scopeUrls ?? []) {
    if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) {
      try {
        return new URL(raw.trim()).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Matches a persisted (issueType, rootCause) pair back to its strongest DiagnosticCause definition.
 */
export function matchDiagnosticCause(issueType: string, rootCause: string) {
  const normalizedIssueType = issueType.trim().toLowerCase();
  const matchingRule = Object.values(DIAGNOSTIC_RULES).find(
    (rule) => rule.issueType.toLowerCase() === normalizedIssueType,
  );

  if (matchingRule && matchingRule.causes.length > 0) {
    let bestCause = matchingRule.causes[0];
    let bestScore = -1;

    for (const cause of matchingRule.causes) {
      const score = scoreCauseLabelSimilarity(rootCause, cause.label, cause.id);
      if (score > bestScore) {
        bestScore = score;
        bestCause = cause;
      }
    }
    return bestCause;
  }

  const rootLower = rootCause.toLowerCase();
  for (const rule of Object.values(DIAGNOSTIC_RULES)) {
    for (const cause of rule.causes) {
      if (rootLower.includes(cause.id.toLowerCase())) {
        return cause;
      }
    }
  }

  return null;
}

/**
 * Resolves verification criteria for a persisted DiagnosticFindingRecord:
 *   1. Uses stored finding.verificationCriteria if valid & non-empty
 *   2. Otherwise reconstructs from DIAGNOSTIC_RULES + DETERMINISTIC_FIXES
 *   3. Hydrates __CURRENT_URL__ / __PREFERRED_URL__ placeholders against the resolved target URL
 */
export function resolveFindingVerificationCriteria(
  finding: Pick<LiveVerifyFindingInput, "issueType" | "rootCause" | "verificationCriteria" | "scopeUrls">,
  siteDomain?: string,
  resolvedTargetUrl?: string,
): VerificationCriterion[] {
  const targetUrl = resolveOptionalTargetUrl(finding.scopeUrls, siteDomain, resolvedTargetUrl);
  const finalize = (criteria: VerificationCriterion[]) => hydrateCriterionPlaceholders(criteria, targetUrl);

  if (Array.isArray(finding.verificationCriteria)) {
    const valid = finding.verificationCriteria.filter(
      (c): c is VerificationCriterion =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as { type?: unknown }).type === "string",
    );
    if (valid.length > 0) {
      return finalize(valid);
    }
  }

  const bestCause = matchDiagnosticCause(finding.issueType, finding.rootCause);
  if (bestCause) {
    if (bestCause.verification && bestCause.verification.length > 0) {
      return finalize(bestCause.verification);
    }

    if (siteDomain) {
      const detFix = tryDeterministicFix(bestCause.id, {
        url: targetUrl ?? finding.scopeUrls?.[0] ?? `https://${siteDomain}/`,
        domain: siteDomain,
      });
      if (detFix?.verification && detFix.verification.length > 0) {
        return finalize(detFix.verification);
      }
    }
  }

  return [{ type: "HTTP_STATUS", expected: [200, 301, 302] }];
}

export async function verifyFindingLiveAndPersist(
  params: VerifyFindingLiveParams,
): Promise<VerifyFindingLiveOutcome> {
  const {
    finding,
    site,
    explicitUrl,
    includeGscInspection = true,
    deploymentRevision,
    fetcher,
  } = params;

  const targetUrl = resolveVerificationTargetUrl(site.domain, finding.scopeUrls, explicitUrl);
  const criteria = resolveFindingVerificationCriteria(finding, site.domain, targetUrl);

  const verificationResult = await runTechnicalVerification(targetUrl, criteria, fetcher);

  let gscInspection: GscUrlInspectionResult | null = null;
  if (includeGscInspection) {
    try {
      gscInspection = await inspectGscUrl(site.userId, site.domain, targetUrl);
    } catch (err) {
      logger.warn("[LiveVerify] GSC URL inspection failed softly", {
        findingId: finding.id,
        url: targetUrl,
        error: err instanceof Error ? err.message : String(err),
      });
      gscInspection = {
        success: false,
        code: "UNKNOWN",
        message: "Unable to inspect URL in Google Search Console.",
      };
    }
  }

  const newDiagnosticStatus = mapTechnicalOutcomeToDiagnosticStatus(verificationResult.outcome);

  await prisma.diagnosticFindingRecord.update({
    where: { id: finding.id },
    data: { status: newDiagnosticStatus },
  });

  let nextLifecycleState = finding.lifecycleState;
  if (
    (verificationResult.outcome === "TECHNICALLY_VERIFIED" ||
      verificationResult.outcome === "PARTIALLY_VERIFIED") &&
    finding.lifecycleState !== LIFECYCLE_STATE.IN_PROGRESS &&
    finding.lifecycleState !== LIFECYCLE_STATE.RESOLVED
  ) {
    const transition = await transitionLifecycleState(finding.id, LIFECYCLE_STATE.IN_PROGRESS);
    if (transition.success) {
      nextLifecycleState = transition.newState;
    }
  }

  const revision = deploymentRevision ?? `manual-${Date.now()}`;
  const observedValue = buildT0ObservedValue({
    result: verificationResult,
    deploymentRevision: revision,
    trigger: "LIVE_MANUAL",
    gscInspection,
  });

  const evidenceHash = computeEvidenceHash({
    source: "HTML",
    url: targetUrl,
    observedValue,
  });

  await persistDiagnosticEvidence(finding.siteId, finding.id, [
    {
      source: "HTML",
      url: targetUrl,
      observedAt: verificationResult.verifiedAt,
      observedValue,
      confidence: verificationResult.passedCount / Math.max(1, verificationResult.totalCount),
      confidenceKind: "DIRECTLY_OBSERVED",
      evidenceHash,
    },
  ]);

  let t7Scheduled = false;
  if (
    verificationResult.outcome === "TECHNICALLY_VERIFIED" ||
    verificationResult.outcome === "PARTIALLY_VERIFIED"
  ) {
    try {
      await inngest.send({
        name: "seo/fix.t0-verified",
        data: {
          siteId: finding.siteId,
          findingDbId: finding.id,
          url: targetUrl,
          t0Outcome: verificationResult.outcome,
          deployedAt: verificationResult.verifiedAt,
          deploymentRevision: revision,
        },
      });
      t7Scheduled = true;
    } catch (err) {
      logger.warn("[LiveVerify] Failed to schedule T+7 verification event", {
        findingId: finding.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    findingId: finding.id,
    siteId: finding.siteId,
    url: targetUrl,
    verified: verificationResult.outcome === "TECHNICALLY_VERIFIED",
    outcome: verificationResult.outcome,
    status: newDiagnosticStatus,
    lifecycleState: nextLifecycleState,
    passedCount: verificationResult.passedCount,
    totalCount: verificationResult.totalCount,
    durationMs: verificationResult.durationMs,
    verifiedAt: verificationResult.verifiedAt,
    criteria: verificationResult.criteria,
    gscInspection,
    t7Scheduled,
    evidenceHash,
  };
}

