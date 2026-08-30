// =============================================================================
// INTENT AGENT — Search intent classification using LLM
//
// The ONLY LLM-using agent in Phase A.
// Classifies BOTH query intent AND page intent, detects mismatches.
// Uses Gemini. Batches 20 queries at a time. Caches results for 30 days.
//
// This is an AI_REASONING tier agent. It has higher latency and cost than
// deterministic agents but provides insights that deterministic analysis cannot.
// =============================================================================

import { createFindingFingerprint } from "./fingerprint";
import { validateIntentResponse } from "./intent-validation";
import { logger } from "@/lib/logger";
import type { AgentExecution, AgentFinding, AgentError } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export type SearchIntent =
  | "INFORMATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "NAVIGATIONAL"
  | "COMPARISON"
  | "PROBLEM_SOLVING";

export interface IntentClassification {
  query: string;
  queryIntent: SearchIntent;
  pageUrl: string;
  pageIntent: SearchIntent;
  match: boolean;
  matchScore: number; // 0–100
  confidence: number; // 0–100
  reason: string;
}

export interface IntentAgentData {
  classifications: IntentClassification[];
  mismatches: number;
  totalClassified: number;
}

interface QueryInput {
  query: string;
  pageUrl: string;
  pageTitle?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify search intent for a batch of query + landing page pairs.
 *
 * @param classifyFn - Injected LLM classification function (keeps this agent testable).
 *   In production, this would call the Gemini API. In tests, it can be mocked.
 */
export async function analyzeIntent(
  siteId: string,
  queries: QueryInput[],
  classifyFn: (batch: QueryInput[]) => Promise<IntentClassification[]>,
): Promise<AgentExecution<IntentAgentData>> {
  const findings: AgentFinding[] = [];
  const errors: AgentError[] = [];
  const allClassifications: IntentClassification[] = [];

  let tokensUsed = 0;
  let mismatches = 0;

  // Process in batches of 20
  const BATCH_SIZE = 20;
  const batches: QueryInput[][] = [];
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    batches.push(queries.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    try {
      const rawResults = await classifyFn(batch);

      // Validate LLM output through Zod schema
      let results: IntentClassification[];
      try {
        results = validateIntentResponse(rawResults);
      } catch (validationErr: unknown) {
        const message = (validationErr as Error)?.message ?? String(validationErr);
        logger.warn("[IntentAgent] LLM output validation failed", {
          batchSize: batch.length,
          error: message,
        });
        errors.push({
          code: "INTENT_VALIDATION_FAILED",
          message: `Batch of ${batch.length} queries: ${message}`,
          recoverable: true,
        });
        continue; // Skip this batch, try the next one
      }

      allClassifications.push(...results);

      // Generate findings for intent mismatches
      for (const result of results) {
        if (!result.match && result.confidence >= 60) {
          mismatches++;
          findings.push({
            type: "INTENT_MISMATCH",
            severity: result.matchScore < 30 ? "HIGH" : "MEDIUM",
            title: `Intent mismatch: "${truncate(result.query, 50)}"`,
            description: `Query intent is ${result.queryIntent} but the landing page (${result.pageUrl}) serves ${result.pageIntent} content. ${result.reason}`,
            evidence: [
              {
                sourceType: "COMPUTED",
                metric: "queryIntent",
                value: result.queryIntent,
                observedAt: new Date().toISOString(),
              },
              {
                sourceType: "COMPUTED",
                metric: "pageIntent",
                value: result.pageIntent,
                observedAt: new Date().toISOString(),
              },
              {
                sourceType: "COMPUTED",
                metric: "matchScore",
                value: String(result.matchScore),
                metadata: {
                  confidence: result.confidence,
                  reason: result.reason,
                },
                observedAt: new Date().toISOString(),
              },
            ],
            confidence: result.confidence / 100,
            affectedResource: { type: "QUERY", id: result.query },
            fingerprint: createFindingFingerprint({
              siteId,
              type: "INTENT_MISMATCH",
              resourceType: "QUERY",
              resourceId: result.query,
            }),
          });
        }
      }
    } catch (err: unknown) {
      const message = (err as Error)?.message ?? String(err);
      logger.warn("[IntentAgent] Batch classification failed", {
        batchSize: batch.length,
        error: message,
      });
      errors.push({
        code: "INTENT_CLASSIFICATION_FAILED",
        message: `Batch of ${batch.length} queries failed: ${message}`,
        recoverable: true,
      });
    }
  }

  return {
    data: {
      classifications: allClassifications,
      mismatches,
      totalClassified: allClassifications.length,
    },
    findings,
    errors: errors.length > 0 ? errors : undefined,
    itemsProcessed: allClassifications.length,
    tokensUsed,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + "..." : str;
}
