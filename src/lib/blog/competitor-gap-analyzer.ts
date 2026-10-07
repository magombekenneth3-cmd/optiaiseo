/**
 * competitor-gap-analyzer.ts — Evidence-based competitor gap analysis.
 *
 * Produces a CompetitorAnalysis for a specific competitor domain using ONLY
 * measured data from the already-fetched SERP context:
 *   - the competitor's own ranking page (scraped headings, body, schema, date)
 *   - the other ranking pages for the same keyword (peer consensus)
 *   - People Also Ask questions
 *
 * Rules:
 *   1. No LLM calls and no templated claims. Every strength, weakness, missing
 *      subtopic and missing question is backed by an `evidence` entry.
 *   2. If the competitor's page is not in the SERP (or could not be scraped),
 *      the analysis is UNAVAILABLE and makes no competitor-specific claims.
 *      Downstream code then falls back to SERP-wide gaps.
 *   3. Deterministic: same inputs (+ same `now`) → same output.
 */

import type { CompetitorAnalysis } from "./contracts";
import type { SerpContext, SerpResult } from "./serp";

const MIN_SCRAPED_CHARS = 200;
const MIN_PEER_SUPPORT = 2;
const HEADING_MATCH_RATIO = 0.5;
const BODY_MATCH_RATIO = 0.8;
const QUESTION_MATCH_RATIO = 0.75;
const THIN_CONTENT_RATIO = 0.6;
const STALE_MONTHS = 18;
const MAX_ITEMS = 10;

const STOPWORDS = new Set([
    "the", "and", "for", "with", "your", "you", "are", "was", "were", "this", "that",
    "these", "those", "what", "when", "where", "which", "while", "who", "why", "how",
    "does", "do", "can", "should", "will", "would", "could", "from", "into", "about",
    "than", "then", "them", "they", "their", "there", "have", "has", "had", "its",
    "our", "out", "all", "any", "more", "most", "best", "guide", "complete", "ultimate",
    "introduction", "conclusion", "overview", "summary", "faq", "faqs", "frequently",
    "asked", "questions", "final", "thoughts", "step", "steps",
]);

export interface AnalyzeCompetitorGapParams {
    keyword: string;
    competitorDomain: string;
    serpContext: SerpContext | null;
    searchVolume?: number;
    difficulty?: number;
    /** Injected for deterministic freshness checks in tests. */
    now?: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalizeDomain(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, "")
        .replace(/^www\./, "")
        .replace(/[/?#].*$/, "")
        .replace(/:\d+$/, "");
}

/** Exact host or subdomain match — avoids `includes()` false positives. */
export function urlBelongsToDomain(url: string, domain: string): boolean {
    const target = normalizeDomain(domain);
    if (!target) return false;
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return false;
    }
    return host === target || host.endsWith(`.${target}`);
}

function terms(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
    return [...new Set(tokens)];
}

/** Share of `a`'s terms present in `b` (asymmetric containment). */
function containment(a: string[], b: Set<string>): number {
    if (a.length === 0) return 0;
    return a.filter(t => b.has(t)).length / a.length;
}

/**
 * Two headings express the same subtopic when their shared terms make up at
 * least HEADING_MATCH_RATIO of the LARGER term set. Using the larger set stops
 * short generic headings ("What is CRM") from matching every specific topic.
 */
function headingsMatch(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return false;
    const setB = new Set(b);
    const shared = a.filter(t => setB.has(t)).length;
    return shared / Math.max(a.length, b.length) >= HEADING_MATCH_RATIO;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function wordCountOf(result: SerpResult): number {
    if (typeof result.wordCount === "number" && result.wordCount > 0) return result.wordCount;
    return (result.scrapedContent ?? "").split(/\s+/).filter(Boolean).length;
}

function isScraped(result: SerpResult): boolean {
    return (result.scrapedContent ?? "").length >= MIN_SCRAPED_CHARS;
}

function monthsBetween(from: Date, to: Date): number {
    return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function unavailable(
    params: AnalyzeCompetitorGapParams,
    reason: string,
    match?: SerpResult,
): CompetitorAnalysis {
    return {
        competitorDomain: normalizeDomain(params.competitorDomain) || params.competitorDomain,
        availability: "UNAVAILABLE",
        unavailableReason: reason,
        searchVolume: params.searchVolume,
        difficulty: params.difficulty,
        competitorRankingUrl: match?.link,
        competitorTitle: match?.title,
        headings: [],
        evidence: [],
        // differentiationOpportunities deliberately omitted so downstream
        // checks fall back to SERP-wide opportunities.
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzeCompetitorGap(params: AnalyzeCompetitorGapParams): CompetitorAnalysis {
    const { keyword, competitorDomain, serpContext } = params;
    const now = params.now ?? new Date();
    const results = serpContext?.results ?? [];

    if (results.length === 0) {
        return unavailable(params, `No SERP results were available for "${keyword}".`);
    }

    const competitorIndex = results.findIndex(r => urlBelongsToDomain(r.link, competitorDomain));
    if (competitorIndex === -1) {
        return unavailable(
            params,
            `${normalizeDomain(competitorDomain)} does not appear in the fetched top ${results.length} results for "${keyword}".`,
        );
    }

    const competitor = results[competitorIndex];
    const competitorRank = competitorIndex + 1;
    if (!isScraped(competitor)) {
        return unavailable(
            params,
            `${normalizeDomain(competitorDomain)} ranks #${competitorRank} but its page could not be scraped; no content-level claims are possible.`,
            competitor,
        );
    }

    const peers = results
        .map((r, i) => ({ result: r, rank: i + 1 }))
        .filter(({ result, rank }) =>
            rank !== competitorRank &&
            !urlBelongsToDomain(result.link, competitorDomain) &&
            isScraped(result),
        );

    const competitorHeadings = competitor.scrapedHeadings ?? [];
    const competitorHeadingTerms = competitorHeadings.map(terms);
    const competitorBodyTerms = new Set(terms(`${competitor.scrapedContent ?? ""} ${competitorHeadings.join(" ")}`));

    const evidence: string[] = [];
    const structuralStrengths: string[] = [];
    const contentWeaknesses: string[] = [];
    const missingSubtopics: string[] = [];
    const missingQuestions: string[] = [];

    // ── Strengths: measured rank + structure ────────────────────────────────
    structuralStrengths.push(`Ranks #${competitorRank} of ${results.length} fetched results for "${keyword}"`);
    evidence.push(`Competitor URL ${competitor.link} found at SERP position ${competitorRank}.`);

    const peerHeadingCounts = peers.map(p => (p.result.scrapedHeadings ?? []).length);
    const medianPeerHeadings = median(peerHeadingCounts);
    if (competitorHeadings.length > 0 && peers.length > 0 && competitorHeadings.length >= medianPeerHeadings) {
        structuralStrengths.push(`Structured into ${competitorHeadings.length} H2/H3 sections (peer median ${medianPeerHeadings})`);
        evidence.push(`Competitor has ${competitorHeadings.length} headings vs peer median ${medianPeerHeadings} across ${peers.length} scraped peers.`);
    }

    // ── Missing subtopics: peer consensus the competitor lacks ──────────────
    const seenTopics: string[][] = [];
    for (const peer of peers) {
        for (const heading of peer.result.scrapedHeadings ?? []) {
            const headingTerms = terms(heading);
            if (headingTerms.length === 0) continue;
            if (seenTopics.some(t => headingsMatch(t, headingTerms))) continue;
            seenTopics.push(headingTerms);

            const supportingRanks = peers
                .filter(p => (p.result.scrapedHeadings ?? []).some(h => headingsMatch(terms(h), headingTerms)))
                .map(p => p.rank);
            if (supportingRanks.length < MIN_PEER_SUPPORT) continue;

            const inCompetitorHeadings = competitorHeadingTerms.some(t => headingsMatch(t, headingTerms));
            const inCompetitorBody = containment(headingTerms, competitorBodyTerms) >= BODY_MATCH_RATIO;
            if (inCompetitorHeadings || inCompetitorBody) continue;

            missingSubtopics.push(heading);
            evidence.push(
                `Subtopic "${heading}" is covered by ${supportingRanks.length}/${peers.length} other ranking pages (ranks ${supportingRanks.join(", ")}) but absent from the competitor's headings and body.`,
            );
            if (missingSubtopics.length >= MAX_ITEMS) break;
        }
        if (missingSubtopics.length >= MAX_ITEMS) break;
    }

    // ── Missing questions: PAA the competitor doesn't address ───────────────
    for (const paa of serpContext?.peopleAlsoAsk ?? []) {
        const question = paa.question?.trim();
        if (!question) continue;
        const questionTerms = terms(question);
        if (questionTerms.length === 0) continue;
        const ratio = containment(questionTerms, competitorBodyTerms);
        if (ratio >= QUESTION_MATCH_RATIO) continue;
        missingQuestions.push(question);
        evidence.push(
            `People Also Ask "${question}": only ${Math.round(ratio * 100)}% of its key terms appear in the competitor page.`,
        );
        if (missingQuestions.length >= MAX_ITEMS) break;
    }

    // ── Weakness: thin content relative to peers ────────────────────────────
    const competitorWords = wordCountOf(competitor);
    const peerWordCounts = peers.map(p => wordCountOf(p.result)).filter(n => n > 0);
    const medianPeerWords = median(peerWordCounts);
    if (peerWordCounts.length >= MIN_PEER_SUPPORT && medianPeerWords > 0 && competitorWords < medianPeerWords * THIN_CONTENT_RATIO) {
        contentWeaknesses.push(`Thinner than peers: ~${competitorWords} words vs peer median ~${Math.round(medianPeerWords)}`);
        evidence.push(`Competitor word count ${competitorWords} is below ${THIN_CONTENT_RATIO * 100}% of the peer median ${Math.round(medianPeerWords)} (${peerWordCounts.length} peers).`);
    }

    // ── Weakness: schema gaps peers exploit ─────────────────────────────────
    const competitorSchemas = new Set(competitor.scrapedSchemaTypes ?? []);
    const hasPaa = (serpContext?.peopleAlsoAsk.length ?? 0) > 0;
    const peersWithFaqSchema = peers.filter(p => (p.result.scrapedSchemaTypes ?? []).includes("FAQPage")).map(p => p.rank);
    if (!competitorSchemas.has("FAQPage") && hasPaa && peersWithFaqSchema.length > 0) {
        contentWeaknesses.push("No FAQPage schema despite People Also Ask demand");
        evidence.push(`FAQPage schema not detected on competitor; present on peers at ranks ${peersWithFaqSchema.join(", ")}; SERP shows ${serpContext?.peopleAlsoAsk.length} PAA questions.`);
    }

    // ── Weakness: stale content ─────────────────────────────────────────────
    if (competitor.scrapedPublishedDate) {
        const published = new Date(competitor.scrapedPublishedDate);
        if (!Number.isNaN(published.getTime())) {
            const age = monthsBetween(published, now);
            if (age >= STALE_MONTHS) {
                contentWeaknesses.push(`Stale: last published/modified ~${age} months ago`);
                evidence.push(`Competitor page date ${published.toISOString().slice(0, 10)} is ${age} months old (threshold ${STALE_MONTHS}).`);
            }
        }
    }

    if (missingSubtopics.length > 0) {
        contentWeaknesses.push(`Misses ${missingSubtopics.length} subtopic(s) that other ranking pages agree on`);
    }
    if (missingQuestions.length > 0) {
        contentWeaknesses.push(`Leaves ${missingQuestions.length} People Also Ask question(s) unaddressed`);
    }

    // Opportunities are the concrete, content-checkable gaps only.
    const differentiationOpportunities = [...missingSubtopics, ...missingQuestions].slice(0, MAX_ITEMS * 2);

    return {
        competitorDomain: normalizeDomain(competitorDomain) || competitorDomain,
        availability: "AVAILABLE",
        searchVolume: params.searchVolume,
        difficulty: params.difficulty,
        competitorRankingUrl: competitor.link,
        competitorTitle: competitor.title,
        headings: competitorHeadings.slice(0, 50),
        scrapedText: (competitor.scrapedContent ?? "").slice(0, 5000) || undefined,
        wordCount: competitorWords,
        evidence: evidence.slice(0, 30),
        structuralStrengths,
        contentWeaknesses,
        missingSubtopics,
        missingQuestions,
        // Omit when empty so downstream checks fall back to SERP-wide opportunities.
        ...(differentiationOpportunities.length > 0 ? { differentiationOpportunities } : {}),
    };
}
