// =============================================================================
// Competitor detection engine — Business Fingerprint builder
//
// buildFingerprint() is the "source of truth" for what a site IS.
// It fetches title+meta, combines with ranking keywords, then calls Claude once
// to produce a structured identity used by the similarity engine.
//
// Results are cached in Redis (Upstash) for 24 hours — survives serverless
// cold starts. Falls back to in-process Map when Redis is unavailable.
// =============================================================================

import type { BusinessFingerprint } from "./types";
import { getFingerprintCache, setFingerprintCache } from "./cache";
import { AI_MODELS } from "@/lib/constants/ai-models";

const DEFAULT_TIMEOUT_MS = 5_000;

// Public API

/**
 * Builds (or returns cached) a BusinessFingerprint for a domain.
 *
 * Data sources used (in priority order):
 *   1. Caller-supplied context (rankingKeywords, coreServices)
 *   2. Title + meta description fetched from the homepage
 *   3. Claude Haiku structured classification
 *
 * Never throws — returns a low-confidence generic fingerprint on any failure.
 */
export async function buildFingerprint(
    domain:   string,
    opts: {
        apiKey:          string;
        rankingKeywords?: string[];
        coreServices?:   string;
        timeoutMs?:      number;
    }
): Promise<BusinessFingerprint> {
    const cached = await getFingerprintCache(domain);
    if (cached) return cached;

    const { apiKey, rankingKeywords = [], coreServices, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

    // Step 1: Fetch homepage signals (title + meta only — fast)
    const homeSignals = await fetchHomeSignals(domain, timeoutMs);

    // Step 2: Ask Claude to produce a structured fingerprint
    const fp = await classifyWithAI(domain, homeSignals, rankingKeywords, coreServices, apiKey);

    await setFingerprintCache(domain, fp);
    return fp;
}

// Homepage signal fetch (title + meta only — ~1–2 KB)

interface HomeSignals {
    title:       string;
    description: string;
}

async function fetchHomeSignals(domain: string, timeoutMs: number): Promise<HomeSignals> {
    try {
        const res = await fetch(`https://${domain}`, {
            signal:  AbortSignal.timeout(timeoutMs),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        });
        if (!res.ok) return { title: "", description: "" };

        const html = await res.text();
        const title       = html.match(/<title[^>]*>([^<]{3,120})<\/title>/i)?.[1]?.trim() ?? "";
        const metaDesc    = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1]?.trim() ?? "";
        const ogDesc      = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1]?.trim() ?? "";
        const description = ogDesc || metaDesc;

        return { title, description };
    } catch {
        return { title: "", description: "" };
    }
}

// Claude classification — uses AI_MODELS registry

const INDUSTRIES   = ["saas", "agency", "ecommerce", "local", "media", "finance", "education", "health", "legal", "other"];
const BIZ_MODELS   = ["b2b-saas", "b2c-saas", "marketplace", "services", "content", "platform", "ecommerce", "other"];
const INTENT_TYPES = ["transactional", "informational", "mixed"];

async function classifyWithAI(
    domain:          string,
    signals:         HomeSignals,
    rankingKeywords: string[],
    coreServices:    string | undefined,
    apiKey:          string,
): Promise<BusinessFingerprint> {
    const kwHint  = rankingKeywords.length > 0
        ? `Ranking keywords: ${rankingKeywords.slice(0, 10).join(", ")}`
        : "";
    const svcHint = coreServices ? `Owner-described services: ${coreServices}` : "";

    const prompt = `Classify this website into a structured business fingerprint. Return ONLY a valid JSON object.

Domain: ${domain}
Title: ${signals.title || "(unknown)"}
Description: ${signals.description || "(unknown)"}
${kwHint}
${svcHint}

Required JSON shape:
{
  "industry":      one of [${INDUSTRIES.map(i => `"${i}"`).join(", ")}],
  "businessModel": one of [${BIZ_MODELS.map(m => `"${m}"`).join(", ")}],
  "coreServices":  array of 1-4 SHORT generic service strings (NOT brand names),
  "intentType":    one of [${INTENT_TYPES.map(t => `"${t}"`).join(", ")}],
  "audience":      short string e.g. "seo agencies" / "small business owners" / "enterprise devs",
  "confidence":    number 0.0-1.0 (how confident you are given the data quality)
}

Rules:
- coreServices must be generic category terms, NOT the brand name
- intentType "transactional" = they charge money for the thing; "informational" = mostly content/blog
- If data is insufficient, still return your best guess with low confidence (<0.4)
- Return ONLY the JSON object, no markdown, no explanation.`;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key":         apiKey,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            body: JSON.stringify({
                model:      AI_MODELS.ANTHROPIC_PRIMARY,
                max_tokens: 300,
                messages:   [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(12_000),
        });

        if (!res.ok) return genericFingerprint(domain);

        const data    = await res.json() as { content?: Array<{ text?: string }> };
        const rawText = data.content?.[0]?.text ?? "";
        const cleaned = rawText.replace(/```json\s*|```\s*/g, "").trim();
        const parsed  = JSON.parse(cleaned);

        if (isValidFingerprint(parsed)) {
            return { domain, ...parsed };
        }
    } catch {
        // fall through to generic
    }

    return genericFingerprint(domain);
}

// Helpers

function isValidFingerprint(v: unknown): v is Omit<BusinessFingerprint, "domain"> {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return (
        typeof o.industry      === "string" &&
        typeof o.businessModel === "string" &&
        Array.isArray(o.coreServices) &&
        typeof o.intentType    === "string" &&
        typeof o.audience      === "string" &&
        typeof o.confidence    === "number"
    );
}

/** Returns a low-confidence generic fingerprint when classification fails. */
function genericFingerprint(domain: string): BusinessFingerprint {
    return {
        domain,
        industry:      "other",
        businessModel: "other",
        coreServices:  [],
        intentType:    "mixed",
        audience:      "general",
        confidence:    0.2,
    };
}
