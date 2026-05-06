// =============================================================================
// Competitor detection engine — orchestrator v2
//
// Pipeline:
//   1. Build site fingerprint (structured identity)
//   2. Extract services via AI (existing, fingerprint-grounded)
//   3. Build intent-aware SERP queries per service
//   4. Run queries in parallel → collect domain frequency/position maps
//   5. For each candidate: build fingerprint + compute similarity (new)
//   6. Score with weighted formula: serp(30%) + similarity(40%) + intent(20%) + confidence(10%)
//   7. Filter by threshold 0.35 — no more forcing bad results to fill a 12-slot quota
//   8. AI verification: returns structured confidence scores, not binary YES/NO
//   9. Return ranked list with full scoreBreakdown for explainability
// =============================================================================

import { fetchSiteServicesText }  from "./scraper";
import { extractServicesWithAI }  from "./extractor";
import { buildSearchQueries, runSearchQueries } from "./search";
import { rankCompetitors, rankCompetitorsFallback, deduplicateCompetitors, SCORE_THRESHOLD } from "./ranker";
import { buildFingerprint }       from "./fingerprint";
import { computeSimilarity }      from "./similarity";
import { getVerificationCache, setVerificationCache, getCacheStats } from "./cache";
import { resolveCountryCode }     from "./country";
import { extractRoot }            from "./filters";
import { logger }                 from "@/lib/logger";
import { AI_MODELS }              from "@/lib/constants/ai-models";
import type {
    DetectedService,
    Competitor,
    CompetitorDetectionResult,
    BusinessFingerprint,
    SimilarityResult,
    VerificationVerdict,
} from "./types";

export type { DetectedService, Competitor, CompetitorDetectionResult };

/** Hard output cap */
const MAX_COMPETITORS = 12;

// Re-export individual utilities so callers can import from one place
export { resolveCountryCode };
export { shouldExclude, isSameBrand, isBlockedDomain, isContentSite, isHostingPlatform }
    from "./filters";
export { buildSearchQueries } from "./search";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
    maxServices:             4,
    maxCompetitorsPerService: 10,
    minFrequencyThreshold:   1.5,
    scoreThreshold:          SCORE_THRESHOLD,  // 0.35
    timeouts: {
        siteFetch:   6_000,
        aiExtract:  15_000,
        serperQuery: 8_000,
    },
} as const;

// Strip-geo regex: remove country/city words so we can retry globally
const GEO_STRIP_PATTERN =
    /\b(uganda|kenya|nigeria|ghana|ethiopia|tanzania|south africa|rwanda|zambia|zimbabwe|botswana|senegal|morocco|egypt|uk|us|usa|india|australia|new zealand|singapore|malaysia|philippines|indonesia|thailand|vietnam|japan|south korea|china|pakistan|bangladesh|sri lanka|uae|dubai|saudi arabia|qatar|israel|turkey|brazil|argentina|colombia|chile|peru|mexico|canada|germany|france|netherlands|spain|italy|sweden|norway|denmark|finland|poland|portugal|kampala|nairobi|lagos|accra|cairo|johannesburg|cape town|london|manchester|berlin|paris|amsterdam|madrid|rome|new york|los angeles|chicago|san francisco|seattle|austin|toronto|vancouver|sydney|melbourne|mumbai|delhi|bangalore)\b/gi;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DetectorOptions {
    anthropicApiKey?: string;
    serperApiKey?:    string;
    location?:        string;
    countryCode?:     string;
    /** Caller-supplied description of the site's core services (bypasses AI). */
    coreServices?:    string;
    /** Single keyword — used as additional context (not sole service descriptor). */
    targetKeyword?:   string;
    /** Real keywords from RankSnapshot — enriches extraction and adds direct queries. */
    rankingKeywords?: string[];
    maxServices?:     number;
    maxCompetitorsPerService?: number;
    minFrequencyThreshold?:   number;
    /** Override the minimum score threshold (0–1). Default: 0.35 */
    scoreThreshold?:           number;
    additionalBlockedDomains?: string[];
    /**
     * Subscription tier — controls Serper query budget per service.
     * FREE/STARTER: 3 queries (covers direct, company, alternatives)
     * PRO:          5 queries
     * AGENCY:       6 queries (full suite)
     * Default: 6 (full) when unspecified.
     */
    subscriptionTier?: "FREE" | "STARTER" | "PRO" | "AGENCY";
    timeouts?: {
        siteFetch?:   number;
        aiExtract?:   number;
        serperQuery?: number;
    };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function detectCompetitorsCore(
    domain:  string,
    options: DetectorOptions = {},
): Promise<CompetitorDetectionResult> {
    const warnings: string[] = [];

    const anthropicApiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    const serperApiKey    = options.serperApiKey    ?? process.env.SERPER_API_KEY    ?? "";

    if (!anthropicApiKey) throw new Error("[competitor-detect] ANTHROPIC_API_KEY is required.");
    if (!serperApiKey)    throw new Error("[competitor-detect] SERPER_API_KEY is required.");

    const cleanDomain = domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .toLowerCase();

    const location    = options.location   ?? "";
    const countryCode = options.countryCode ?? resolveCountryCode(location);
    const maxServices = options.maxServices ?? DEFAULTS.maxServices;
    const maxPerSvc   = options.maxCompetitorsPerService ?? DEFAULTS.maxCompetitorsPerService;
    const minFreq     = options.minFrequencyThreshold    ?? DEFAULTS.minFrequencyThreshold;
    const scoreThresh = options.scoreThreshold           ?? DEFAULTS.scoreThreshold;
    const timeouts    = { ...DEFAULTS.timeouts, ...(options.timeouts ?? {}) };
    const rankingKeywords = options.rankingKeywords ?? [];

    // Tier-aware Serper query budget:
    // Lower tiers get fewer queries — they have lower competitor caps anyway (2/site for STARTER).
    // This prevents burning 24 API calls when 3 well-chosen queries are sufficient.
    const QUERY_CAPS: Record<string, number> = {
        FREE:    3,   // direct + company + alternatives
        STARTER: 3,
        PRO:     5,   // + software tools + comparison pages
        AGENCY:  6,   // full suite
    };
    const queryCap = QUERY_CAPS[options.subscriptionTier ?? ""] ?? 6;

    const extraBlockedRoots = new Set<string>(
        (options.additionalBlockedDomains ?? []).map(extractRoot)
    );

    // ── Step 1: Build site fingerprint ────────────────────────────────────────
    const siteFingerprint = await buildFingerprint(cleanDomain, {
        apiKey:          anthropicApiKey,
        rankingKeywords,
        coreServices:    options.coreServices,
        timeoutMs:       timeouts.siteFetch,
    });

    logger.info("[competitor-detect] Site fingerprint built", {
        domain:        cleanDomain,
        industry:      siteFingerprint.industry,
        businessModel: siteFingerprint.businessModel,
        intentType:    siteFingerprint.intentType,
        confidence:    siteFingerprint.confidence,
        cacheStats:    getCacheStats(),
    });

    // ── Step 2: Extract services ──────────────────────────────────────────────
    let services: DetectedService[];

    if (rankingKeywords.length >= 3) {
        const siteText  = await fetchSiteServicesText(cleanDomain, timeouts.siteFetch);
        const aiServices = await extractServicesWithAI({
            siteText:    siteText ?? "",
            domain:      cleanDomain,
            location,
            coreServices: options.coreServices ?? null,
            rankingKeywords,
            maxServices,
            apiKey:      anthropicApiKey,
            timeoutMs:   timeouts.aiExtract,
        });
        // Supplement with direct ranking keyword services
        const kwServices: DetectedService[] = rankingKeywords.slice(0, 3).map(kw => ({
            name:  location && !kw.toLowerCase().includes(location.toLowerCase())
                       ? `${kw} ${location}`.trim()
                       : kw,
            label: kw,
        }));
        const seen = new Set(aiServices.map(s => s.label.toLowerCase()));
        services = [
            ...aiServices,
            ...kwServices.filter(s => !seen.has(s.label.toLowerCase())),
        ].slice(0, maxServices);
    } else {
        const siteText = await fetchSiteServicesText(cleanDomain, timeouts.siteFetch);
        if (!siteText) {
            warnings.push(`Could not fetch homepage for ${cleanDomain}. Using domain name as fallback.`);
        }
        services = await extractServicesWithAI({
            siteText:    siteText ?? "",
            domain:      cleanDomain,
            location,
            coreServices: options.coreServices ?? null,
            rankingKeywords,
            maxServices,
            apiKey:      anthropicApiKey,
            timeoutMs:   timeouts.aiExtract,
        });
    }

    // ── GATE 1: Require at least one service to search for ────────────────────
    if (services.length === 0) {
        throw new Error(
            `[competitor-detect] Service extraction returned 0 services for "${cleanDomain}". ` +
            `Cannot run SERP queries without knowing what the site offers. ` +
            `Ensure ANTHROPIC_API_KEY is valid and the site homepage is reachable.`
        );
    }

    // ── Step 3 & 4: SERP queries in parallel ─────────────────────────────────
    const allCandidates: Competitor[] = [];
    // Accumulated snippets across all service queries — used in verification
    const allSnippets = new Map<string, string>();
    // Track how many services actually returned SERP results (vs timed out / errored)
    let servicesWithResults = 0;

    await Promise.allSettled(
        services.map(async (service) => {
            const queries = buildSearchQueries(service.name, location).slice(0, queryCap);

            const result = await runSearchQueries({
                queries,
                countryCode,
                ownRoot:          cleanDomain,
                apiKey:           serperApiKey,
                extraBlockedRoots,
                timeoutMs:        timeouts.serperQuery,
            });

            // Accumulate snippets (first seen wins — keeps richest position-1 text)
            for (const [domain, snippet] of result.domainSnippets) {
                if (!allSnippets.has(domain)) allSnippets.set(domain, snippet);
            }

            // Preliminary rank (no similarity yet — we do that in the next step)
            let candidates = rankCompetitors(result, service, maxPerSvc * 2, minFreq);

            // Geo-strip fallback
            if (candidates.length === 0) {
                const stripped = service.name
                    .replace(GEO_STRIP_PATTERN, "")
                    .replace(/\s+/g, " ")
                    .trim();

                if (stripped.length > 3) {
                    const fallbackResult = await runSearchQueries({
                        queries:          buildSearchQueries(stripped, ""),
                        countryCode,
                        ownRoot:          cleanDomain,
                        apiKey:           serperApiKey,
                        extraBlockedRoots,
                        timeoutMs:        timeouts.serperQuery,
                    });
                    candidates = rankCompetitorsFallback(fallbackResult, service, Math.min(maxPerSvc, 5));
                    if (candidates.length > 0) {
                        warnings.push(`No local competitors found for "${service.label}" — showing global results.`);
                    }
                }
            }

            if (candidates.length > 0) servicesWithResults++;
            allCandidates.push(...candidates);
        })
    );

    // ── GATE 2: At least one service must have produced SERP results ──────────
    // If servicesWithResults === 0 it means every Serper call failed (quota,
    // network, invalid key). Do not proceed — saving nothing is safer than
    // saving whatever scraped noise survived.
    if (servicesWithResults === 0) {
        throw new Error(
            `[competitor-detect] All SERP queries returned 0 results for "${cleanDomain}". ` +
            `This is likely a Serper API key/quota issue or a network failure. ` +
            `Services attempted: ${services.map(s => s.label).join(", ")}.`
        );
    }

    // ── Step 5: Deduplicate ───────────────────────────────────────────────────
    const deduped = deduplicateCompetitors(allCandidates);

    // ── GATE 3: Require at least 1 candidate after dedup/filtering ────────────
    if (deduped.length === 0) {
        throw new Error(
            `[competitor-detect] All ${allCandidates.length} SERP candidates were removed by the ` +
            `domain filter (blocked list, hosting platform, same brand, or content site). ` +
            `No competitors will be saved.`
        );
    }

    // ── Step 6: Build candidate fingerprints + similarity in parallel ─────────
    const verifyPool = deduped.slice(0, MAX_COMPETITORS + 6); // verify a few extra then trim
    const similarityMap = new Map<string, SimilarityResult>();

    await Promise.allSettled(
        verifyPool.map(async (c) => {
            try {
                const fp = await buildFingerprint(c.domain, {
                    apiKey:    anthropicApiKey,
                    timeoutMs: Math.min(timeouts.siteFetch, 4_000),
                });
                const sim = computeSimilarity(siteFingerprint, fp);
                similarityMap.set(c.domain, sim);
            } catch {
                // Leave absent — ranker uses 0.5 neutral default
            }
        })
    );

    // ── Step 7: AI verification (structured confidence, not binary) ───────────
    const serviceLabels = services.map(s => s.label).join(", ");
    const verificationMap = await verifyCompetitorServices(
        verifyPool,
        siteFingerprint,
        serviceLabels,
        anthropicApiKey,
        timeouts.siteFetch,
        allSnippets,   // ← pass SERP snippets — avoids re-fetching homepages
    );

    // ── Step 8: Re-score with full weighted formula ───────────────────────────
    const rescored: Competitor[] = verifyPool
        .map(c => {
            const sim     = similarityMap.get(c.domain);
            const verdict = verificationMap.get(c.domain);

            // If AI says irrelevant and similarity is low → hard reject
            if (verdict?.type === "irrelevant" && (sim?.overall ?? 0) < 0.3) {
                return null;
            }

            const similarity   = sim?.overall   ?? 0.5;
            const intentScore  = sim ? typePenaltyFromType(sim.competitorType) : 0.5;
            const confidence   = verdict?.confidence ?? 0.5;
            const competitorType = (sim?.competitorType ?? verdict?.type) as Competitor["competitorType"];

            // Normalised SERP score from the original candidate
            const serpScore = c.serpScore ?? Math.min(c.frequency * (1 / Math.sqrt(c.bestPosition)) / 8, 1);

            // FIX: remove double intent penalty.
            // similarity (40%) already encodes businessModel which penalises content/platform.
            // intentScore was duplicating that signal. Now confidence (10%) absorbs its weight,
            // and we add a lighter direct-competitor bonus instead.
            const directBonus   = competitorType === "direct" ? 0.05 : 0;

            const finalScore =
                serpScore    * 0.30 +
                similarity   * 0.50 +   // ↑ from 0.40 — primary signal
                confidence   * 0.15 +   // ↑ from 0.10
                directBonus  * 0.05;    // small bonus for confirmed direct competitors

            if (finalScore < scoreThresh) return null;

            const scored: Competitor = {
                domain:      c.domain,
                service:     c.service,
                bestPosition: c.bestPosition,
                frequency:   c.frequency,
                score:         finalScore,
                serpScore,
                similarityScore: similarity,
                competitorType,
                confidence,
                reason:        verdict?.reason,
                scoreBreakdown: {
                    serp:       +(serpScore    * 0.30).toFixed(3),
                    similarity: +(similarity   * 0.50).toFixed(3),
                    intent:     0,   // removed — was double-counting businessModel axis
                    confidence: +(confidence   * 0.15).toFixed(3),
                },
            };
            return scored;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null) as Competitor[];

    rescored.sort((a, b) => b.score - a.score);

    // ── Step 9: Final gate — never return the raw unverified fallback ─────────
    // If scoring filtered everything out, return 0 competitors with a clear
    // warning. Callers (autoDetectAndSaveCompetitors) must NOT save on empty.
    if (rescored.length === 0) {
        warnings.push(
            `Similarity/confidence scoring filtered all ${deduped.length} candidates below ` +
            `the ${scoreThresh} threshold. No competitors saved. ` +
            `Consider lowering scoreThreshold or checking site fingerprint quality.`
        );
    }

    const finalList = rescored.slice(0, MAX_COMPETITORS);

    logger.info("[competitor-detect] Detection complete", {
        services:    services.map(s => s.label),
        candidates:  deduped.length,
        afterFilter: rescored.length,
        returned:    finalList.length,
        topScores:   finalList.slice(0, 5).map(c => ({
            domain: c.domain,
            score:  c.score.toFixed(3),
            type:   c.competitorType,
        })),
        warnings,
    });

    return {
        domain:      cleanDomain,
        services,
        competitors: finalList,
        warnings,
    };
}

// ---------------------------------------------------------------------------
// Structured AI verification pass (replaces binary YES/NO)
// ---------------------------------------------------------------------------

/**
 * Fetches title+meta of each candidate, then asks Claude for a STRUCTURED
 * verdict per domain: type, similarity (0–1), confidence (0–1), reason.
 *
 * Results are cached so re-detection of the same site is free.
 */
async function verifyCompetitorServices(
    candidates:      Competitor[],
    siteFingerprint: BusinessFingerprint,
    serviceLabels:   string,
    apiKey:          string,
    timeoutMs:       number,
    serpSnippets:    Map<string, string> = new Map(),
): Promise<Map<string, VerificationVerdict>> {
    const resultMap = new Map<string, VerificationVerdict>();
    if (!apiKey || candidates.length === 0) return resultMap;

    // Cache key based on domain set + service labels
    const cacheKey = `verify:${candidates.map(c => c.domain).sort().join(",")}:${serviceLabels}`;
    const cached   = await getVerificationCache(cacheKey);
    if (cached) {
        cached.forEach(v => resultMap.set(v.domain, v));
        return resultMap;
    }

    // ── Use SERP snippets first; fall back to homepage fetch for gaps ────────
    const list: { domain: string; text: string }[] = [];
    const missingDomains = candidates.filter(c => !serpSnippets.has(c.domain));

    // Domains already covered by SERP snippets
    for (const c of candidates) {
        const snippet = serpSnippets.get(c.domain);
        if (snippet) list.push({ domain: c.domain, text: snippet });
    }

    // Domains not in SERP snippets — fetch their homepage (limited to 5 to cap latency)
    if (missingDomains.length > 0) {
        const fetched = await Promise.allSettled(
            missingDomains.slice(0, 5).map(async (c) => {
                try {
                    const res = await fetch(`https://${c.domain}`, {
                        signal:  AbortSignal.timeout(Math.min(timeoutMs, 3_000)),
                        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
                    });
                    if (!res.ok) return { domain: c.domain, text: "" };
                    const html     = await res.text();
                    const title    = html.match(/<title[^>]*>([^<]{3,100})<\/title>/i)?.[1]?.trim() ?? "";
                    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,200})["']/i)?.[1]?.trim() ?? "";
                    const ogDesc   = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,200})["']/i)?.[1]?.trim() ?? "";
                    return { domain: c.domain, text: [title, ogDesc || metaDesc].filter(Boolean).join(" — ") };
                } catch {
                    return { domain: c.domain, text: "" };
                }
            })
        );
        for (const r of fetched) {
            if (r.status === "fulfilled") list.push(r.value);
        }
    }

    const prompt = `You are a competitive intelligence analyst. The target business has this profile:
Industry: ${siteFingerprint.industry}
Business model: ${siteFingerprint.businessModel}
Core services: ${siteFingerprint.coreServices.join(", ") || serviceLabels}
Intent: ${siteFingerprint.intentType}
Audience: ${siteFingerprint.audience}

For each candidate domain below, classify its relationship to the target business.

RESPOND ONLY with a valid JSON array. No markdown, no explanation.

Each object must have:
- "domain": string
- "type": one of "direct" | "indirect" | "content" | "platform" | "irrelevant"
- "similarity": number 0.0-1.0 (how similar their offering is)
- "confidence": number 0.0-1.0 (your confidence in this verdict)
- "reason": short string (max 12 words)

Type definitions:
- "direct": sells the SAME service to the SAME audience
- "indirect": adjacent service or different audience segment
- "content": blog, media, review site — does NOT sell the service
- "platform": aggregator, marketplace, or infrastructure provider
- "irrelevant": unrelated business entirely

Candidates:
${list.map(l => `${l.domain}: ${l.text || "(no description)"}`).join("\n")}

JSON array:`;

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
                max_tokens: 1200,
                messages:   [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) return resultMap;

        const data    = await res.json() as { content?: Array<{ text?: string }> };
        const rawText = data.content?.[0]?.text ?? "";
        const cleaned = rawText.replace(/```json\s*|```\s*/g, "").trim();
        const parsed  = JSON.parse(cleaned);

        if (Array.isArray(parsed)) {
            const verdicts: VerificationVerdict[] = [];
            for (const item of parsed) {
                if (
                    typeof item.domain     === "string" &&
                    typeof item.type       === "string" &&
                    typeof item.similarity === "number" &&
                    typeof item.confidence === "number" &&
                    typeof item.reason     === "string"
                ) {
                    const verdict: VerificationVerdict = {
                        domain:     item.domain.toLowerCase(),
                        type:       item.type as VerificationVerdict["type"],
                        similarity: Math.max(0, Math.min(1, item.similarity)),
                        confidence: Math.max(0, Math.min(1, item.confidence)),
                        reason:     item.reason,
                    };
                    verdicts.push(verdict);
                    resultMap.set(verdict.domain, verdict);
                }
            }
                await setVerificationCache(cacheKey, verdicts);
        }
    } catch {
        // Verification failed — resultMap remains empty, callers use defaults
    }

    return resultMap;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function typePenaltyFromType(type: SimilarityResult["competitorType"]): number {
    const MAP: Record<SimilarityResult["competitorType"], number> = {
        direct:   1.0,
        indirect: 0.65,
        content:  0.15,
        platform: 0.20,
    };
    return MAP[type] ?? 0.5;
}