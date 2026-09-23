import { classifySerpFormat } from "./serp";
import type { AuthorProfile } from "./index";
import type { SerpContext, SerpResult } from "./serp";
import {
    AuthorEvidenceSchema,
    ClaimSchema,
    type OutlineSection,
    type ResearchBrain,
    type ResearchPacket,
    ResearchPacketSchema,
    type SectionResearch,
    SectionResearchSchema,
    SourceEvidenceSchema,
    type SourceEvidence,
    type SourceType,
} from "./contracts";

// Each section is 300–400 words and can meaningfully cite at most 2–3 sources.
// Extra sources inflate input tokens (~3,500 chars each) with no citation-rate gain.
const MAX_SOURCES_PER_SECTION = 3;

function compact(values: readonly string[] | undefined, max = 16): string[] {
    return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))].slice(0, max);
}

function truncate(value: string, max: number): string {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function isUrl(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function publisher(url: string): string | undefined {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return undefined;
    }
}

function sourceType(url: string): SourceType {
    const host = publisher(url)?.toLowerCase() ?? "";
    if (host.endsWith(".gov") || host.includes("who.int") || host.includes("europa.eu")) return "government";
    if (
        host.endsWith(".edu") ||
        /(journal|research|arxiv|nih\.gov|ncbi|nature\.com|science\.org)/.test(host)
    ) return "research";
    if (
        /(developers\.google|support\.google|web\.dev|learn\.microsoft|docs\.microsoft|platform\.openai|docs\.anthropic)/.test(host)
    ) return "official";
    if (/(reuters|apnews|bbc\.|nytimes|theguardian|bloomberg)/.test(host)) return "news";
    if (/(google|microsoft|openai|anthropic|mozilla|hubspot|salesforce|shopify|ahrefs|semrush)/.test(host)) return "company";
    return "other";
}

function sourceAuthority(type: SourceType): number {
    const base: Record<SourceType, number> = {
        official: 0.95,
        government: 0.92,
        research: 0.88,
        company: 0.72,
        news: 0.68,
        expert: 0.62,
        other: 0.45,
    };
    return base[type];
}

function confidence(type: SourceType, evidence: string): number {
    const base = sourceAuthority(type);
    return evidence.length >= 100 ? base : Math.max(0.3, base - 0.12);
}

export function sourceFromSerpResult(result: SerpResult, id: string, retrievedAt = new Date().toISOString()): SourceEvidence | null {
    if (!isUrl(result.link) || !result.title.trim() || !result.snippet.trim()) return null;
    const evidence = truncate(result.scrapedContent || result.snippet || "", 3_500);
    const type = sourceType(result.link);
    const publishedAt = result.scrapedPublishedDate && Number.isFinite(Date.parse(result.scrapedPublishedDate))
        ? new Date(result.scrapedPublishedDate).toISOString()
        : undefined;
    const candidate = {
        id,
        url: result.link,
        title: truncate(result.title, 500),
        publisher: publisher(result.link),
        ...(publishedAt ? { publishedAt } : {}),
        retrievedAt,
        claim: truncate(result.snippet, 1_000),
        evidence,
        sourceType: type,
        confidence: confidence(type, evidence),
        authorityScore: sourceAuthority(type),
    };
    const parsed = SourceEvidenceSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
}

function topicTerms(value: string): string[] {
    const stop = new Set(["with", "from", "that", "this", "your", "about", "into", "what", "when", "where", "which", "guide", "best"]);
    return (value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter(term => !stop.has(term));
}

function relevance(text: string, terms: string[]): number {
    const lower = text.toLowerCase();
    return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

function authorEvidence(author: AuthorProfile) {
    return AuthorEvidenceSchema.parse({
        name: author.name || "Site author",
        ...(author.role ? { role: author.role } : {}),
        ...(author.bio ? { bio: author.bio } : {}),
        ...(author.realExperience ? { experience: author.realExperience } : {}),
        ...(author.realNumbers ? { realNumbers: author.realNumbers } : {}),
        ...(author.localContext ? { localContext: author.localContext } : {}),
    });
}

/**
 * Builds the single research snapshot for a generation attempt.
 *
 * Source deepening happens before the packet is parsed so the section writer
 * and publication gate see the exact same source set.  Do not rebuild this
 * packet later in the pipeline: that would allow the article and its gate to
 * evaluate different research snapshots.
 */
export async function buildResearchPacket(params: {
    keyword: string;
    brain: ResearchBrain;
    serpContext: SerpContext | null;
    author: AuthorProfile;
    sections?: OutlineSection[];
}): Promise<ResearchPacket> {
    const retrievedAt = new Date().toISOString();
    const { keyword, brain, serpContext, author, sections = [] } = params;
    const serpSources = (serpContext?.results ?? [])
        .map((result, index) => sourceFromSerpResult(result, `serp-${index + 1}`, retrievedAt))
        .filter((source): source is SourceEvidence => source !== null);

    // Research evidence required by data/comparison/case-study sections is
    // collected before packet construction. This prevents a private set of
    // writer-only facts from drifting away from gate evidence.
    const additionalSources: SourceEvidence[] = [];
    for (let index = 0; index < sections.length; index += 2) {
        const batch = sections.slice(index, index + 2);
        const discovered = await Promise.all(batch.map(async (section, offset) => {
            if (!needsExternalEvidence(section)) return [];
            const relevant = sourceForSection(section, serpSources);
            if (relevant.length >= 2) return [];
            return deepenSources(section, keyword, index + offset, retrievedAt);
        }));
        additionalSources.push(...discovered.flat());
    }

    const dedupedSources = new Map<string, SourceEvidence>();
    for (const source of [...serpSources, ...additionalSources]) {
        // The first source wins so a stable SERP source ID remains stable.
        if (!dedupedSources.has(source.url)) dedupedSources.set(source.url, source);
    }
    const sources = [...dedupedSources.values()].slice(0, 40);
    const competitors = (serpContext?.results ?? [])
        .filter(result => isUrl(result.link) && result.title.trim())
        .slice(0, 8)
        .map(result => ({
            title: truncate(result.title, 500),
            url: result.link,
            snippet: truncate(result.snippet, 2_000),
            headings: compact(result.scrapedHeadings, 50),
            ...(typeof result.wordCount === "number" ? { wordCount: result.wordCount } : {}),
        }));

    return ResearchPacketSchema.parse({
        collectedAt: retrievedAt,
        evidenceAvailability: sources.length > 0
            ? "AVAILABLE"
            : serpContext
                ? "EMPTY"
                : "UNAVAILABLE",
        keyword,
        intent: brain.intent,
        brain,
        serp: {
            competitors,
            paa: (serpContext?.peopleAlsoAsk ?? []).slice(0, 20).map(item => ({
                question: truncate(item.question, 500),
                ...(item.answer ? { answer: truncate(item.answer, 2_000) } : {}),
            })),
            format: serpContext ? classifySerpFormat(serpContext.results).format : null,
            tableStakes: serpContext?.opportunityAnalysis?.tableStakes ?? [],
            opportunities: serpContext?.opportunityAnalysis?.opportunities ?? [],
            unansweredQuestions: serpContext?.opportunityAnalysis?.unansweredQuestions ?? [],
        },
        sources,
        entities: compact(brain.entities, 20).map(entity => ({
            entity,
            reason: "Identified during research planning.",
            sourceIds: sources
                .filter(source => `${source.title} ${source.evidence}`.toLowerCase().includes(entity.toLowerCase()))
                .map(source => source.id),
        })),
        authorEvidence: authorEvidence(author),
        ...(brain.informationGainDirective ? { informationGain: brain.informationGainDirective } : {}),
        contentGaps: compact(brain.contentGaps),
        misconceptions: compact(brain.commonMisconceptions),
        contrarianAngles: compact(brain.contrarianAngles),
        ...(serpContext?.opportunityAnalysis ? { opportunityAnalysis: serpContext.opportunityAnalysis } : {}),
    });
}

function needsExternalEvidence(section: OutlineSection): boolean {
    return section.evidenceType === "data" ||
        section.evidenceType === "comparison" ||
        section.evidenceType === "case_study";
}

function selectedAuthorEvidence(section: OutlineSection, packet: ResearchPacket): string | undefined {
    const candidate = [
        packet.authorEvidence.experience && `Direct experience: ${packet.authorEvidence.experience}`,
        packet.authorEvidence.realNumbers && `Verified author numbers: ${packet.authorEvidence.realNumbers}`,
        packet.authorEvidence.localContext && `Local context: ${packet.authorEvidence.localContext}`,
    ].filter((value): value is string => Boolean(value));
    if (candidate.length === 0) return undefined;
    const terms = [...topicTerms(section.heading), ...section.keyEntities.map(entity => entity.toLowerCase())];
    const directlyRelevant = relevance(candidate.join(" "), terms) > 0;
    const narrativeFit = section.evidenceType === "example" || section.evidenceType === "opinion";
    return directlyRelevant || narrativeFit ? truncate(candidate.join("\n"), 3_500) : undefined;
}

function freshnessBonus(source: SourceEvidence, section: OutlineSection): number {
    if (!source.publishedAt) return section.evidenceType === "data" ? -1 : 0;
    const ageDays = Math.max(0, (Date.now() - Date.parse(source.publishedAt)) / 86_400_000);
    const windowDays =
        section.evidenceType === "data" ? 365 :
        section.evidenceType === "comparison" ? 180 :
        section.evidenceType === "case_study" ? 730 :
        365;
    return ageDays <= windowDays ? 2 : -4;
}

function sourceForSection(section: OutlineSection, sources: SourceEvidence[]): SourceEvidence[] {
    const terms = [...topicTerms(section.heading), ...section.keyEntities.map(entity => entity.toLowerCase())];
    return sources
        .map(source => ({
            source,
            score:
                relevance(`${source.title} ${source.claim} ${source.evidence}`, terms) * 10 +
                (source.authorityScore ?? source.confidence) * 4 +
                freshnessBonus(source, section),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) =>
            b.score - a.score ||
            (b.source.authorityScore ?? b.source.confidence) - (a.source.authorityScore ?? a.source.confidence)
        )
        .slice(0, MAX_SOURCES_PER_SECTION)
        .map(item => item.source);
}

function sectionSourceId(section: OutlineSection, index: number): string {
    const preferred = section.id ?? section.heading;
    const safe = preferred
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || `section-${index + 1}`;
    return `section-${index + 1}-${safe}`;
}

async function deepenSources(
    section: OutlineSection,
    keyword: string,
    sectionIndex: number,
    retrievedAt: string,
): Promise<SourceEvidence[]> {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey || !needsExternalEvidence(section)) return [];
    const suffix = section.evidenceType === "data"
        ? "statistics official research"
        : section.evidenceType === "case_study"
            ? "case study documented results"
            : "comparison official documentation";
    try {
        const response = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: `${section.heading} ${keyword} ${suffix}`, num: 5 }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return [];
        const data = await response.json() as {
            organic?: Array<{ title?: string; link?: string; snippet?: string }>;
        };
        return (data.organic ?? [])
            .map((result, index) => sourceFromSerpResult({
                title: result.title ?? "",
                link: result.link ?? "",
                snippet: result.snippet ?? "",
            }, `${sectionSourceId(section, sectionIndex)}-source-${index + 1}`, retrievedAt))
            .filter((source): source is SourceEvidence => source !== null)
            .filter(source => source.confidence >= 0.55)
            .slice(0, MAX_SOURCES_PER_SECTION);
    } catch {
        return [];
    }
}

function verifiedCaseStudyAvailable(sources: SourceEvidence[]): boolean {
    return sources.some(source =>
        source.confidence >= 0.6 &&
        /case study|customer story|documented results?|before and after|outcome/i.test(
            `${source.title} ${source.claim} ${source.evidence}`
        )
    );
}

function assembleSectionResearch(section: OutlineSection, packet: ResearchPacket, sources: SourceEvidence[]): SectionResearch {
    const terms = topicTerms(section.heading);
    const warnings: string[] = [];
    if (section.evidenceType === "case_study" && !verifiedCaseStudyAvailable(sources)) {
        warnings.push("Verified case-study evidence is unavailable. Use a clearly labelled example; do not invent company names, outcomes, or metrics.");
    }
    if (needsExternalEvidence(section) && sources.length === 0) {
        warnings.push("No verified external sources are available. Do not include externally verifiable facts or statistics.");
    }
    if (section.evidenceType === "data" && sources.length > 0 && sources.every(source => freshnessBonus(source, section) < 0)) {
        warnings.push("Available data sources are stale for a data-heavy section. Prefer a current source or state the limitation explicitly.");
    }
    return SectionResearchSchema.parse({
        sectionId: section.id ?? "section",
        competitorCoverage: packet.serp.competitors
            .flatMap(competitor => [
                ...competitor.headings.filter(heading => relevance(heading, terms) > 0),
                relevance(competitor.snippet, terms) > 0 ? competitor.snippet : "",
            ])
            .filter(Boolean)
            .map(value => truncate(value, 1_500))
            .slice(0, 8),
        contentGaps: compact(packet.contentGaps.filter(gap => relevance(gap, terms) > 0), 8),
        relevantSources: sources,
        relevantClaims: sources.map(source => ClaimSchema.parse({
            text: source.claim,
            sourceIds: [source.id],
            type: /\d|percent|study|survey|report/i.test(source.claim) ? "fact" : "comparison",
        })),
        relevantEntities: compact([
            ...section.keyEntities,
            ...packet.entities
                .filter(entity => relevance(`${entity.entity} ${entity.reason ?? ""}`, terms) > 0)
                .map(entity => entity.entity),
        ], 12),
        examples: compact([
            ...packet.brain.examplesNeeded.filter(example => relevance(example, terms) > 0),
            ...packet.brain.contrarianAngles.filter(angle => relevance(angle, terms) > 0),
        ], 8),
        ...(selectedAuthorEvidence(section, packet) ? { authorEvidence: selectedAuthorEvidence(section, packet) } : {}),
        warnings,
    });
}

export async function buildSectionResearchMap(
    sections: OutlineSection[],
    packet: ResearchPacket,
    isCancelled?: () => Promise<boolean> | boolean,
): Promise<SectionResearch[]> {
    const output: SectionResearch[] = new Array(sections.length);
    for (let index = 0; index < sections.length; index += 2) {
        if (await isCancelled?.()) throw new Error("Generation cancelled.");
        const batch = sections.slice(index, index + 2);
        const researched = await Promise.all(batch.map(async (section, offset) => {
            const sources = sourceForSection(section, packet.sources);
            return { index: index + offset, research: assembleSectionResearch(section, packet, sources) };
        }));
        researched.forEach(item => { output[item.index] = item.research; });
    }
    return output;
}

export function renderSourceContext(sources: SourceEvidence[]): string {
    if (sources.length === 0) return "No external sources are available for this section.";
    return sources.map(source => `[${source.id}] ${source.title}${source.publisher ? ` — ${source.publisher}` : ""}
URL: ${source.url}
Evidence: ${truncate(source.evidence, 900)}`).join("\n\n");
}

export function getVerifiedCaseStudyAvailability(sources: SourceEvidence[]): boolean {
    return verifiedCaseStudyAvailable(sources);
}
