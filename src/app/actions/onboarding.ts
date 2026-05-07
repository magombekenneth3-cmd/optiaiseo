"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPOT_CHECK_CACHE_TTL_SECONDS = 86_400; // 24h — onboarding data doesn't stale fast
const SPOT_CHECK_MAX_OUTPUT_TOKENS = 220;     // Fix #2 — down from 400; JSON fits in ~150 tokens

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpotCheckStatus = "cited" | "not_cited" | "no_activity";

export interface SpotCheckResult {
    status: SpotCheckStatus;
    query: string;
    industry?: string;              // Fix #6 — was generated but thrown away
    competitorCited?: string;
    topFix: string;
    reason: string;
    nextStep: string;
}

// Shape the single batched LLM call must return. Fix #1.
interface BatchedSpotCheckRaw {
    query: string;                  // inferred by the model
    industry: string;               // Fix #6
    hasSubstantiveAnswer: boolean;
    domainMentioned: boolean;
    competitorMentioned: string | null;
    whyNotCited: string;
    topFix: string;
    nextStep: string;
}

// ---------------------------------------------------------------------------
// Public: markOnboardingDone
// ---------------------------------------------------------------------------

export async function markOnboardingDone(): Promise<void> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return;                              // Fix — prefer ID over email
    await prisma.user.update({
        where: { id: session.user.id },
        data: { onboardingDone: true },
    });
}

// ---------------------------------------------------------------------------
// Public: runOnboardingSpotCheck
// ---------------------------------------------------------------------------

export async function runOnboardingSpotCheck(domain: string): Promise<SpotCheckResult> {
    const cleanDomain = normaliseDomain(domain);

    // Fix #3 — check Redis before spending any tokens
    const cacheKey = `onboarding:spot:${cleanDomain}`;
    try {
        const cached = await redis.get<SpotCheckResult>(cacheKey);
        if (cached) {
            logger.debug("[OnboardingSpot] Cache HIT", { domain: cleanDomain });
            return cached;
        }
    } catch (e) {
        logger.warn("[OnboardingSpot] Redis read failed, proceeding fresh", { error: e });
    }

    try {
        const result = await runSinglePassSpotCheck(cleanDomain);

        // Cache the result so retries / reloads are free
        try {
            await redis.set(cacheKey, result, { ex: SPOT_CHECK_CACHE_TTL_SECONDS });
        } catch (e) {
            logger.warn("[OnboardingSpot] Redis write failed", { error: e });
        }

        return result;
    } catch (err) {
        logger.error("[OnboardingSpot] Spot-check failed", { domain: cleanDomain, error: err });
        return fallbackResult(inferFallbackQuery(cleanDomain));
    }
}

// ---------------------------------------------------------------------------
// Internal: single-pass AI call (Fix #1 — was two separate calls)
// ---------------------------------------------------------------------------

async function runSinglePassSpotCheck(domain: string): Promise<SpotCheckResult> {
    const domainBase = domain.split(".")[0].replace(/[-_]/g, " ");

    // Fix #1 — one prompt that infers the query, answers it, and evaluates citation
    // Fix #8 — "at least 2 real tools" enforced in prompt so competitorMentioned is reliable
    const prompt = `You are an AI citation auditor evaluating whether a website gets mentioned by AI assistants.

Website: "${domain}" (brand hint: "${domainBase}")

Do ALL of the following in one step:

1. Infer ONE realistic search query (3-8 words) a potential customer would ask ChatGPT or Perplexity. Do NOT include the brand name.
2. Answer that query naturally in 2-3 sentences. Mention at least 2 real tools, platforms, or companies by name.
3. Check whether "${domain}" appears in your answer.

Return ONLY valid JSON — no other text:
{
  "query": "the query you inferred",
  "industry": "one or two word industry label",
  "hasSubstantiveAnswer": true,
  "domainMentioned": false,
  "competitorMentioned": "first real brand you named in the answer, or null",
  "whyNotCited": "one sentence: most likely reason ${domainBase} was not cited",
  "topFix": "2-4 word label for the single most impactful fix",
  "nextStep": "one concrete sentence the site owner can act on today"
}`;

    // Fix #7 — track whether the failure was a parse error so we don't retry bad prompts
    let raw: BatchedSpotCheckRaw;
    try {
        raw = await callGeminiJson<BatchedSpotCheckRaw>(prompt, {
            model: AI_MODELS.GEMINI_FLASH,
            maxOutputTokens: SPOT_CHECK_MAX_OUTPUT_TOKENS,  // Fix #2
            temperature: 0.2,
            timeoutMs: 18_000,
            maxRetries: 2,                                   // only retries on timeout/5xx in callGeminiJson
        });
    } catch (err) {
        const isParseError = (err as Error)?.message?.toLowerCase().includes("json");
        if (isParseError) {
            // Fix #7 — prompt issue; retrying won't help, surface a clean fallback
            logger.warn("[OnboardingSpot] JSON parse failure — skipping retry", { domain, error: err });
            return fallbackResult(inferFallbackQuery(domain));
        }
        throw err; // network/timeout — let the caller handle
    }

    // Fix #5 — defensive validation: LLMs can hallucinate "domainMentioned: true"
    // A genuinely cited domain should have nothing meaningful in whyNotCited
    const isSelfContradictory =
        raw.domainMentioned === true &&
        typeof raw.whyNotCited === "string" &&
        raw.whyNotCited.trim().length > 40;     // long "why not cited" answer when claimed cited = suspect

    const domainMentioned = raw.domainMentioned && !isSelfContradictory;

    // Fix #5 — also reject if competitorMentioned is the domain itself (model confused itself)
    const competitorCited =
        raw.competitorMentioned &&
            raw.competitorMentioned.toLowerCase() !== domain.split(".")[0].toLowerCase()
            ? raw.competitorMentioned
            : undefined;

    let status: SpotCheckStatus;
    if (!raw.hasSubstantiveAnswer) {
        status = "no_activity";
    } else if (domainMentioned) {
        status = "cited";
    } else {
        status = "not_cited";
    }

    return {
        status,
        query: raw.query ?? inferFallbackQuery(domain),
        industry: raw.industry || undefined,            // Fix #6 — pass through to caller
        competitorCited,
        topFix: raw.topFix ?? "Add structured data",
        reason: raw.whyNotCited ?? "AI models have not indexed enough about your site yet.",
        nextStep: raw.nextStep ?? "Connect Google Search Console to unlock your personalized AEO roadmap.",
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fix #4 — three plausible query patterns instead of one weak template.
 * Rotate by domain hash so different domains get different fallback styles.
 */
function inferFallbackQuery(domain: string): string {
    const hint = domain.split(".")[0].replace(/[-_]/g, " ");
    const options = [
        `what does ${hint} do`,
        `best ${hint} alternatives`,
        `how to use ${hint}`,
    ];
    const idx = hint.length % options.length; // deterministic, not random
    return options[idx];
}

function fallbackResult(query: string): SpotCheckResult {
    return {
        status: "no_activity",
        query,
        topFix: "Add structured data",
        reason: "We couldn't complete the check right now — your first full audit has been queued.",
        nextStep: "Connect Google Search Console to unlock your personalized AEO roadmap.",
    };
}

function normaliseDomain(raw: string): string {
    let s = raw.trim().toLowerCase();
    if (!s.startsWith("http://") && !s.startsWith("https://")) {
        s = `https://${s}`;
    }
    try {
        return new URL(s).hostname.replace(/^www\./, "");
    } catch {
        return s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    }
}