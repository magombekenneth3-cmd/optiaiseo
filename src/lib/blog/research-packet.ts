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

const MAX_SOURCES_PER_SECTION = 6;

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
    if (host.endsWith(".edu") || /(journal|research|arxiv|nih\.gov|ncbi)/.test(host)) return "research";
    if (/(reuters|apnews|bbc\.|nytimes|theguardian|bloomberg)/.test(host)) return "news";
    if (/(google|microsoft|openai|anthropic|mozilla|hubspot|salesforce|shopify|ahrefs|semrush)/.test(host)) return "company";
    return "other";
}

function confidence(type: SourceType, evidence: string): number {
    const base: Record<SourceType, number> = {
        official: 0.95,
        government: 0.92,
        research: 0.88,
        company: 0.72,
        news: 0.68,
        expert: 0.62,
        other: 0.45,
    };
    return evidence.length >= 100 ? base[type] : Math.max(0.3, base[type] - 0.12);
}

export function sourceFromSerpResult(result: SerpResult, id: string, retrievedAt = new Date().toISOString()): SourceEvidence | null {
    if (!isUrl(result.link) || !result.title.trim() || !result.snippet.trim()) return null;
    const evidence = truncate(result.snippet || result.scrapedContent || "", 3_500);
    const type = sourceType(result.link);
    const candidate = {
        id,
        url: result.link,
        title: truncate(result.title, 500),
        publisher: publisher(result.link),
        retrievedAt,
        claim: truncate(result.snippet, 1_000),
        evidence,
        sourceType: type,
        confidence: confidence(type, evidence),
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

export function buildResearchPacket(params: {
    keyword: string;
    brain: ResearchBrain;
    serpContext: SerpContext | null;
    author: AuthorProfile;
}): ResearchPacket {
    const retrievedAt = new Date().toISOString();
    const { keyword, brain, serpContext, author } = params;
    const sources = (serpContext?.results ?? [])
        .map((result, index) => sourceFromSerpResult(result, `serp-${index + 1}`, retrievedAt))
        .filter((source): source is SourceEvidence => source !== null);
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

function sourceForSection(section: OutlineSection, packet: ResearchPacket): SourceEvidence[] {
    const terms = [...topicTerms(section.heading), ...section.keyEntities.map(entity => entity.toLowerCase())];
    return packet.sources
        .map(source => ({ source, score: relevance(`${source.title} ${source.claim} ${source.evidence}`, terms) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.source.confidence - a.source.confidence)
        .slice(0, MAX_SOURCES_PER_SECTION)
        .map(item => item.source);
}

async function deepenSources(section: OutlineSection, keyword: string): Promise<SourceEvidence[]> {
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
            }, `section-${section.id ?? "research"}-source-${index + 1}`))
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
            let sources = sourceForSection(section, packet);
            if (needsExternalEvidence(section) && sources.length < 2) {
                const extra = await deepenSources(section, packet.keyword);
                const deduped = new Map(sources.map(source => [source.url, source]));
                extra.forEach(source => deduped.set(source.url, source));
                sources = [...deduped.values()].slice(0, MAX_SOURCES_PER_SECTION);
            }
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
