/**
 * Evidence extractor
 *
 * Converts the authoritative research snapshot and final article into an
 * auditable EvidencePacket.  It intentionally distinguishes a claim that is
 * merely unsourced from a claim that has been independently proven false:
 * absence of evidence is a review problem, not proof of fabrication.
 */

import {
    EvidencePacketSchema,
    type Claim,
    type EvidenceAvailability,
    type EvidencePacket,
    type ResearchPacket,
    type SourceEvidence,
} from "./contracts";

const EXTRACTOR_VERSION = "blog-evidence-v1";

const STATISTIC_PATTERN = /\b(?:\d{1,3}(?:\.\d+)?\s*%|\$\d[\d,.]*(?:\s*(?:million|billion|m|b|k))?|\d+(?:\.\d+)?x|\d[\d,]*\+?\s*(?:users?|customers?|companies|businesses|sites?|clients?))(?!\w)/gi;
const CASE_STUDY_RESULT_PATTERN = /(?:increased|decreased|improved|reduced|boosted|grew|dropped|rose|fell|achieved|generated|delivered)\s+(?:by\s+)?\d[\d,.]*(?:\.\d+)?\s*%/i;

interface ContentBlock {
    raw: string;
    text: string;
    sourceIds: string[];
}

function normalizeUrl(value: string): string | null {
    try {
        const url = new URL(value);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
        }
        const normalized = url.toString();
        return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    } catch {
        return null;
    }
}

function stripMarkup(value: string): string {
    return value
        .replace(/<[^>]+>/g, " ")
        .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function urlsIn(value: string): string[] {
    const urls = new Set<string>();
    const htmlLink = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    const markdownLink = /!?\[[^\]]*\]\((https?:\/\/[^)\s]+)[^)]*\)/gi;

    for (const pattern of [htmlLink, markdownLink]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(value)) !== null) {
            const normalized = normalizeUrl(match[1]);
            if (normalized) urls.add(normalized);
        }
    }

    return [...urls];
}

function sourceIdsFor(value: string, sourceIdsByUrl: Map<string, string>): string[] {
    return urlsIn(value)
        .map(url => sourceIdsByUrl.get(url))
        .filter((id): id is string => Boolean(id));
}

function extractBlocks(content: string, sourceIdsByUrl: Map<string, string>): ContentBlock[] {
    const htmlBlocks = content.match(/<(?:p|li|h[1-6]|blockquote|td|th)[^>]*>[\s\S]*?<\/(?:p|li|h[1-6]|blockquote|td|th)>/gi);
    const rawBlocks = htmlBlocks?.length
        ? htmlBlocks
        : content.split(/\n\s*\n+/).filter(Boolean);

    return rawBlocks
        .map(raw => ({
            raw,
            text: stripMarkup(raw),
            sourceIds: sourceIdsFor(raw, sourceIdsByUrl),
        }))
        .filter(block => block.text.length > 0);
}

function significantTerms(value: string): Set<string> {
    const stopWords = new Set([
        "according", "source", "research", "study", "report", "data", "that",
        "this", "with", "from", "they", "their", "about", "have", "were",
        "been", "will", "would", "could", "should", "which", "into", "than",
    ]);
    return new Set((value.toLowerCase().match(/\b[a-z][a-z0-9-]{3,}\b/g) ?? [])
        .filter(term => !stopWords.has(term)));
}

function candidateSentences(block: ContentBlock): string[] {
    const sentences = block.text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [block.text];
    return sentences.map(sentence => sentence.trim()).filter(Boolean);
}

function evidenceAvailability(researchPacket: ResearchPacket | null): EvidenceAvailability {
    if (!researchPacket || researchPacket.evidenceAvailability === "UNAVAILABLE") return "UNAVAILABLE";
    if (researchPacket.evidenceAvailability === "EMPTY" || researchPacket.sources.length === 0) return "EMPTY";
    return "AVAILABLE";
}

/**
 * Extracts provenance from the *final* content. Call this after every editorial
 * rewrite; using a packet extracted from an earlier draft would mask removed
 * citations or newly introduced statistics.
 */
export function extractEvidencePacket(
    researchPacket: ResearchPacket | null,
    content: string,
): EvidencePacket {
    const availability = evidenceAvailability(researchPacket);
    const sources = researchPacket?.sources ?? [];
    const sourceIdsByUrl = new Map(
        sources.flatMap(source => {
            const normalized = normalizeUrl(source.url);
            return normalized ? [[normalized, source.id] as const] : [];
        }),
    );
    const blocks = extractBlocks(content, sourceIdsByUrl);
    const claims: Claim[] = [];
    const claimSourceMap: EvidencePacket["claimSourceMap"] = [];
    const unsupportedClaims: string[] = [];
    const unsourcedStatistics: string[] = [];
    const unverifiedCaseStudies: string[] = [];
    const seenClaims = new Set<string>();
    let sourceCitationCount = 0;

    for (const block of blocks) {
        sourceCitationCount += block.sourceIds.length;
        for (const sentence of candidateSentences(block)) {
            const hasStatistic = STATISTIC_PATTERN.test(sentence);
            STATISTIC_PATTERN.lastIndex = 0;
            const hasCitation = block.sourceIds.length > 0;
            const hasFactSignal = /(?:according to|research|study|survey|report|data|found|shows?|reported)/i.test(sentence);

            // A source link makes an otherwise ordinary declarative sentence
            // auditable. Conversely, phrases such as "research shows" must
            // be checked even if the writer forgot the source link.
            if (!hasStatistic && !hasCitation && !hasFactSignal) continue;

            const normalizedClaim = sentence.replace(/\s+/g, " ").trim();
            const dedupeKey = normalizedClaim.toLowerCase();
            if (!normalizedClaim || seenClaims.has(dedupeKey) || claims.length >= 100) continue;
            seenClaims.add(dedupeKey);

            const matchedSourceIds = block.sourceIds;
            const matchMethod = matchedSourceIds.length > 0
                ? "explicit_citation" as const
                : "unsupported" as const;
            const claimId = `claim-${claims.length + 1}`;
            const type = hasStatistic ? "statistic" as const : "fact" as const;

            claims.push({
                text: normalizedClaim.slice(0, 1_500),
                sourceIds: matchedSourceIds,
                type,
            });
            claimSourceMap.push({
                claimId,
                claim: normalizedClaim.slice(0, 1_500),
                sourceIds: matchedSourceIds,
                matchMethod,
            });

            if (matchedSourceIds.length === 0) {
                const issue = `Unsupported ${type}: "${normalizedClaim.slice(0, 180)}${normalizedClaim.length > 180 ? "…" : ""}"`;
                unsupportedClaims.push(issue);
                if (hasStatistic) unsourcedStatistics.push(issue);
                if (CASE_STUDY_RESULT_PATTERN.test(normalizedClaim)) {
                    unverifiedCaseStudies.push(
                        `Unverified case-study result: "${normalizedClaim.slice(0, 180)}${normalizedClaim.length > 180 ? "…" : ""}"`,
                    );
                }
            }
        }
    }

    const payload = {
        availability,
        claims,
        sources,
        claimSourceMap,
        examples: [],
        caseStudies: [],
        visuals: [],
        unsupportedClaims: unsupportedClaims.slice(0, 50),
        unsourcedStatistics: unsourcedStatistics.slice(0, 50),
        unverifiedCaseStudies: unverifiedCaseStudies.slice(0, 20),
        // The extractor is deliberately conservative. Only an independent,
        // trusted verifier may populate this field with proven fabrication.
        fabricatedClaims: [],
        extraction: {
            extractedAt: new Date().toISOString(),
            extractorVersion: EXTRACTOR_VERSION,
            researchAvailability: researchPacket?.evidenceAvailability ?? "UNAVAILABLE",
            researchCollectedAt: researchPacket?.collectedAt ?? null,
            sourceCitationCount,
            claimCount: claims.length,
        },
    };

    // Use safeParse so a Zod schema mismatch degrades gracefully to an
    // UNAVAILABLE packet rather than crashing the Inngest job and marking
    // the entire blog as FAILED.
    const result = EvidencePacketSchema.safeParse(payload);
    if (!result.success) {
        // Log the schema violation for debugging but do not throw.
        // The blog will route to EVIDENCE_REVIEW (human review) instead of FAILED.
        const topIssue = result.error.issues[0];
        console.warn(
            `[EvidenceExtractor] Schema validation failed — degrading to UNAVAILABLE packet. ` +
            `Path: ${topIssue?.path.join(".")}, Issue: ${topIssue?.message}`
        );
        return EvidencePacketSchema.parse({
            availability: "UNAVAILABLE",
            claims: [],
            sources: [],
            claimSourceMap: [],
            examples: [],
            caseStudies: [],
            visuals: [],
            unsupportedClaims: [],
            unsourcedStatistics: [],
            unverifiedCaseStudies: [],
            fabricatedClaims: [],
            extraction: {
                extractedAt: new Date().toISOString(),
                extractorVersion: EXTRACTOR_VERSION,
                researchAvailability: "UNAVAILABLE",
                researchCollectedAt: null,
                sourceCitationCount: 0,
                claimCount: 0,
            },
        });
    }

    return result.data;
}
