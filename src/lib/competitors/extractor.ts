// =============================================================================
// Competitor detection engine — AI service extractor
// Uses Claude Haiku to identify GENERIC SERVICE CATEGORIES (not brand names).
// =============================================================================

import type { DetectedService } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SITE_TEXT_CHARS = 6_000;

/**
 * Extracts the root words from a domain that should NEVER appear in
 * service labels (they are brand names, not generic services).
 *
 * "optiaiseo.online" → ["optiaiseo", "aiseo", "optiai", "opti"]
 */
function brandWordsFromDomain(domain: string): string[] {
    const root = domain
        .replace(/^www\./, "")
        .split(".")[0]
        .toLowerCase();

    // Generate sub-words from camelCase / compound brand names
    const words = new Set<string>([root]);
    // Split on digit boundaries or capital transitions (for camelCase)
    const parts = root.split(/(?=[A-Z])|[-_]/).filter(p => p.length > 2);
    parts.forEach(p => words.add(p.toLowerCase()));
    // Also add progressively shorter prefixes (catches "aiseo" inside "optiaiseo")
    for (let i = 3; i < root.length; i++) {
        words.add(root.slice(0, i));
        words.add(root.slice(i));
    }
    return Array.from(words).filter(w => w.length > 2);
}

/**
 * Returns true if a service name/label contains any brand word from the domain.
 * Used to reject services like "OptiAISEO platform" before they reach the SERP.
 */
function containsBrandWord(text: string, brandWords: string[]): boolean {
    const lower = text.toLowerCase();
    return brandWords.some(w => lower.includes(w));
}

/**
 * Calls Claude Haiku to extract GENERIC service category names suitable for
 * SERP competitor queries. Returns up to `maxServices` DetectedService objects.
 *
 * Key invariant: returned services must NOT contain the site's brand name —
 * they must be terms a competitor would also rank for (e.g. "AI SEO audit tool",
 * not "OptiAISEO").
 */
export async function extractServicesWithAI(opts: {
    siteText:     string;
    domain:       string;
    location:     string;
    coreServices: string | null;
    rankingKeywords?: string[];
    maxServices:  number;
    apiKey:       string;
    timeoutMs?:   number;
}): Promise<DetectedService[]> {
    const {
        siteText,
        domain,
        location,
        coreServices,
        rankingKeywords = [],
        maxServices,
        apiKey,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;

    const brandWords = brandWordsFromDomain(domain);
    const domainRoot = domain.replace(/^www\./, "").split(".")[0];

    const coreServicesHint = coreServices
        ? `\nThe site owner describes their core services as: "${coreServices}". Treat this as the PRIMARY signal.`
        : "";

    const keywordsHint = rankingKeywords.length > 0
        ? `\nThe site currently ranks in Google for these keywords (strongest signal of actual services):\n${rankingKeywords.slice(0, 15).map(k => `  - ${k}`).join("\n")}`
        : "";

    const prompt = `You are a competitive intelligence analyst building SERP queries to find direct competitors of a website.

Domain: ${domain}
Location: ${location || "global"}${coreServicesHint}${keywordsHint}

Site content:
"""
${siteText.slice(0, MAX_SITE_TEXT_CHARS)}
"""

YOUR TASK: Return the GENERIC SERVICE CATEGORIES that this business sells — terms that a competitor would ALSO rank for.

MANDATORY RULES:
1. NEVER use the brand name, app name, or domain name ("${domainRoot}", "${domainRoot.toUpperCase()}", etc.) in any field.
   ❌ BAD: "OptiAISEO platform", "AISEO tool", "${domainRoot} SEO"
   ✅ GOOD: "AI SEO audit tool", "AEO visibility tracker", "SEO rank monitoring SaaS"
2. Use the GENERIC CATEGORY that any competitor could also describe themselves as.
3. Be SPECIFIC: "AI SEO audit tool" not "SEO". "Answer engine optimization platform" not "AI tool".
4. Only include services the site ACTIVELY SELLS to paying clients — not blog topics.
5. If location applies (local business), append city/country. Skip for SaaS/online tools.
6. Prefer ranking keywords as the strongest evidence of what the site actually does.
7. Max ${maxServices} services. Return fewer if the business is clearly single-product.
8. Return ONLY a valid JSON array — no markdown, no explanation.

Output format:
[
  { "name": "AI SEO audit tool", "label": "SEO Audit" },
  { "name": "answer engine optimization platform", "label": "AEO Platform" }
]`;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key":         apiKey,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            body: JSON.stringify({
                model:      "claude-haiku-4-5-20251001",
                max_tokens: 500,
                messages:   [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) throw new Error(`Anthropic ${res.status} ${res.statusText}`);

        const data    = await res.json() as { content?: Array<{ text?: string }> };
        const rawText = data.content?.[0]?.text ?? "";
        const cleaned = rawText.replace(/```json\s*|```\s*/g, "").trim();
        const parsed: unknown = JSON.parse(cleaned);

        if (isValidServiceArray(parsed)) {
            // Filter out any service where name or label contains a brand word.
            // This is the safety net if Claude ignores the prompt instruction.
            const sanitized = parsed.filter(s =>
                !containsBrandWord(s.name,  brandWords) &&
                !containsBrandWord(s.label, brandWords)
            );

            if (sanitized.length > 0) {
                return sanitized.slice(0, maxServices);
            }

            console.warn(
                `[competitor-detect] All ${parsed.length} extracted services contained brand words — falling back.`,
                parsed.map(s => s.name)
            );
        }
    } catch (err) {
        console.warn("[competitor-detect] AI extraction failed:", (err as Error).message);
    }

    // This is vastly better than using the brand name as a SERP query.
    return buildFallback(rankingKeywords, location, maxServices);
}

// Helpers

function isValidServiceArray(value: unknown): value is DetectedService[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
            (s) =>
                typeof s === "object" &&
                s !== null &&
                typeof (s as Record<string, unknown>).name  === "string" &&
                typeof (s as Record<string, unknown>).label === "string" &&
                ((s as Record<string, unknown>).name  as string).trim().length > 0 &&
                ((s as Record<string, unknown>).label as string).trim().length > 0
        )
    );
}

/**
 * Fallback when AI extraction fails or returns only brand-contaminated services.
 * Uses ranking keywords (generic, Google-indexed) instead of the brand name.
 * If no keywords, falls back to the absolute generic "online service".
 */
function buildFallback(
    rankingKeywords: string[],
    location:        string,
    maxServices:     number
): DetectedService[] {
    if (rankingKeywords.length > 0) {
        // Use up to maxServices ranking keywords as service descriptors
        return rankingKeywords.slice(0, maxServices).map(kw => {
            const name = location && !kw.toLowerCase().includes(location.toLowerCase())
                ? `${kw} ${location}`.trim()
                : kw;
            return { name, label: kw };
        });
    }
    // Absolute last resort — at least this produces real SERP results
    return [{ name: "online service platform", label: "Online Service" }];
}
