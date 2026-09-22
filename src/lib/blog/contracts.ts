import { z } from "zod";

/**
 * Runtime contracts for the content pipeline.
 *
 * Keep every model boundary in this file. TypeScript interfaces are useful to
 * callers, but they cannot protect us from an LLM returning malformed JSON.
 */

const NonEmptyString = z.string().trim().min(1);
const ShortString = NonEmptyString.max(500);
const StringList = z.array(NonEmptyString).max(30);\n\nexport const SeoOpportunitySchema = z.object({\n    type: z.enum(["topic_gap", "question_gap", "serp_gap"]),\n    topic: ShortString,\n    score: z.number().min(0).max(100),\n    coverage: z.number().min(0).max(100),\n    competitorCount: z.number().int().nonnegative(),\n    competitorTotal: z.number().int().nonnegative(),\n    rankWeightedCoverage: z.number().min(0).max(100),\n    intentRelevance: z.number().min(0).max(100),\n    evidence: z.array(NonEmptyString).max(10),\n    reason: z.string().trim().max(1000),\n});

export const SourceTypeSchema = z.enum([
    "official",
    "research",
    "government",
    "company",
    "news",
    "expert",
    "other",
]);

export const ClaimTypeSchema = z.enum([
    "statistic",
    "fact",
    "quote",
    "comparison",
    "experience",
]);

/**
 * Availability is deliberately separate from pass/fail.  An article can have
 * evidence that is available but insufficient; it must never be promoted when
 * the evidence collection or extraction step was unavailable.
 */
export const EvidenceAvailabilitySchema = z.enum([
    "AVAILABLE",
    "EMPTY",
    "UNAVAILABLE",
]);

export const SourceEvidenceSchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/i),
    url: z.string().url(),
    title: ShortString,
    publisher: z.string().trim().max(200).optional(),
    publishedAt: z.string().datetime().optional(),
    retrievedAt: z.string().datetime(),
    claim: z.string().trim().min(1).max(1_000),
    evidence: z.string().trim().min(1).max(4_000),
    sourceType: SourceTypeSchema,
    confidence: z.number().min(0).max(1),
});

export const ClaimSchema = z.object({
    text: z.string().trim().min(1).max(1_500),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
    type: ClaimTypeSchema,
});

export const ResearchBrainSchema = z.object({
    intent: ShortString,
    searcherMindset: ShortString,
    contentGaps: StringList,
    entities: StringList,
    contrarianAngles: StringList,
    examplesNeeded: StringList,
    faqTargets: StringList,
    commonMisconceptions: StringList,
    industryMyths: StringList,
    whatPeopleAvoidSaying: StringList,
    informationGainDirective: z.string().trim().max(2_000).optional(),
});

export const CompetitorResearchSchema = z.object({
    title: ShortString,
    url: z.string().url(),
    snippet: z.string().trim().max(2_000),
    headings: z.array(z.string().trim().min(1).max(300)).max(50),
    wordCount: z.number().int().nonnegative().optional(),
});

export const PaaQuestionSchema = z.object({
    question: ShortString,
    answer: z.string().trim().max(2_000).optional(),
});

export const EntityEvidenceSchema = z.object({
    entity: ShortString,
    reason: z.string().trim().max(500).optional(),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
});

export const AuthorEvidenceSchema = z.object({
    name: ShortString,
    role: z.string().trim().max(300).optional(),
    bio: z.string().trim().max(2_000).optional(),
    experience: z.string().trim().max(4_000).optional(),
    realNumbers: z.string().trim().max(2_000).optional(),
    localContext: z.string().trim().max(2_000).optional(),
});

export const ResearchPacketSchema = z.object({
    /** Stable snapshot timestamp for the research used by this generation. */
    collectedAt: z.string().datetime(),
    /** Whether the research run produced usable source evidence. */
    evidenceAvailability: EvidenceAvailabilitySchema,
    keyword: ShortString,
    intent: ShortString,
    brain: ResearchBrainSchema,
    serp: z.object({
        competitors: z.array(CompetitorResearchSchema).max(10),
        paa: z.array(PaaQuestionSchema).max(20),
        format: z.string().trim().max(100).nullable(),
    }),
    sources: z.array(SourceEvidenceSchema).max(40),
    entities: z.array(EntityEvidenceSchema).max(30),
    authorEvidence: AuthorEvidenceSchema,
    informationGain: z.string().trim().max(2_000).optional(),
    contentGaps: StringList,
    misconceptions: StringList,
    contrarianAngles: StringList,
});

export const OutlineToneSchema = z.enum([
    "analytical",
    "skeptical",
    "instructional",
    "narrative",
    "direct",
    "contrarian",
]);

export const EvidenceTypeSchema = z.enum([
    "case_study",
    "data",
    "example",
    "opinion",
    "comparison",
    "how_to",
    "faq",
]);

export const VisualOpportunitySchema = z.enum([
    "none",
    "comparison_table",
    "process_flow",
    "data_chart",
    "checklist",
]);

export const OutlineSectionSchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/i).optional(),
    heading: ShortString,
    goal: ShortString,
    tone: OutlineToneSchema,
    evidenceType: EvidenceTypeSchema,
    wordTarget: z.number().int().min(80).max(1_800),
    keyEntities: StringList,
    isIntro: z.boolean().optional(),
    isOutro: z.boolean().optional(),
    caseStudyAvailable: z.boolean().optional(),
    visualOpportunity: VisualOpportunitySchema.optional(),
});

export const OutlinePlanSchema = z.object({
    title: z.string().trim().min(10).max(90),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
    quickAnswer: z.string().trim().min(20).max(500),
    metaDescription: z.string().trim().min(50).max(180),
    sections: z.array(OutlineSectionSchema).min(5).max(8),
    estimatedTotal: z.number().int().min(500).max(8_000),
});

export const SectionResearchSchema = z.object({
    sectionId: z.string().regex(/^[a-z0-9_-]+$/i),
    competitorCoverage: z.array(z.string().trim().min(1).max(1_500)).max(8),
    contentGaps: StringList,
    relevantSources: z.array(SourceEvidenceSchema).max(10),
    relevantClaims: z.array(ClaimSchema).max(15),
    relevantEntities: StringList,
    examples: StringList,
    authorEvidence: z.string().trim().max(4_000).optional(),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const FAQItemSchema = z.object({
    question: ShortString,
    answer: z.string().trim().min(2).max(1_000),
});

export const GeneratedSectionSchema = z.object({
    heading: ShortString,
    paragraphs: z.array(z.string().trim().min(1).max(4_000)).min(1).max(20),
    claims: z.array(ClaimSchema).max(20),
    entitiesUsed: StringList,
    examplesUsed: StringList,
    faq: z.array(FAQItemSchema).min(3).max(7).optional(),
});

export const EditorialAuditSchema = z.object({
    changed: z.boolean(),
    repetitionIssues: z.array(z.string()).max(30),
    transitionIssues: z.array(z.string()).max(30),
    preservedFacts: z.boolean(),
});

export const ClaimAuditSchema = z.object({
    claim: z.string().trim().min(1).max(1_500),
    supported: z.boolean(),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
    action: z.enum(["keep", "rewrite", "remove"]),
    reason: z.string().trim().max(800).optional(),
});

export const FactAuditSchema = z.object({
    passed: z.boolean(),
    score: z.number().int().min(0).max(100),
    claims: z.array(ClaimAuditSchema).max(100),
    unsupportedClaims: z.array(z.string()).max(30),
});

export const SeoAuditSchema = z.object({
    titleValid: z.boolean(),
    slugValid: z.boolean(),
    metaValid: z.boolean(),
    keywordIntentSatisfied: z.boolean(),
    headingStructureValid: z.boolean(),
    faqValid: z.boolean(),
    wordCountValid: z.boolean(),
    internalLinksValid: z.boolean(),
    externalCitationsValid: z.boolean(),
    issues: z.array(z.string()).max(30),
});

export const GeneratedBlogSchema = z.object({
    title: z.string().trim().min(10).max(90),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    quickAnswer: z.string().trim().min(20),
    metaDescription: z.string().trim().min(50).max(180),
    content: z.string().trim().min(100),
    research: ResearchPacketSchema,
    outline: OutlinePlanSchema,
    claims: z.array(ClaimSchema).max(100),
    sources: z.array(SourceEvidenceSchema).max(40),
    audits: z.object({
        editorial: EditorialAuditSchema,
        factual: FactAuditSchema,
        seo: SeoAuditSchema,
    }),
    generation: z.object({
        id: z.string().min(1),
        durationMs: z.number().nonnegative(),
        attempts: z.number().int().positive(),
        stages: z.array(z.string().min(1)).min(1),
    }),
});

// ─── Evidence Gate Contracts ───────────────────────────────────────────────
//
// These schemas enforce the evidence-gated editorial system.
// Every important claim must trace to a source. Case studies must be verified.
// Publication is conditional on passing hard gates, not beating a score.

export const ExampleKindSchema = z.enum(["hypothetical", "real"]);

export const ArticleExampleSchema = z.object({
    kind: ExampleKindSchema,
    description: z.string().trim().min(1).max(2_000),
    verified: z.boolean(),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
    label: z.string().trim().max(200).optional(), // e.g. "Hypothetical example"
});

export const CaseStudySchema = z.object({
    subject: z.string().trim().min(1).max(500),
    timeframe: z.string().trim().max(200).optional(),
    methodology: z.string().trim().max(1_000).optional(),
    outcome: z.string().trim().max(1_000),
    isVerified: z.boolean(),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
});

export const ArticleVisualSchema = z.object({
    type: z.enum([
        "screenshot", "chart", "diagram", "table",
        "illustration", "photo", "svg_evidence",
    ]),
    purpose: z.string().trim().min(1).max(500),
    evidenceSource: z.string().trim().max(500).optional(),
    sectionId: z.string().trim().max(100).optional(),
});

/** Explicit, auditable claim-to-source provenance produced by the extractor. */
export const ClaimSourceMappingSchema = z.object({
    claimId: z.string().regex(/^claim-[a-z0-9_-]+$/i),
    claim: z.string().trim().min(1).max(1_500),
    sourceIds: z.array(z.string().regex(/^[a-z0-9_-]+$/i)).max(8),
    matchMethod: z.enum([
        "explicit_citation",
        "source_text_match",
        "first_party",
        "unsupported",
    ]),
});

export const EvidenceExtractionMetadataSchema = z.object({
    extractedAt: z.string().datetime(),
    extractorVersion: z.string().trim().min(1).max(100),
    researchAvailability: EvidenceAvailabilitySchema,
    /** Ties this extraction to the exact ResearchPacket used by the writer. */
    researchCollectedAt: z.string().datetime().nullable(),
    sourceCitationCount: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(),
});

export const EvidencePacketSchema = z.object({
    availability: EvidenceAvailabilitySchema,
    claims: z.array(ClaimSchema).max(100),
    sources: z.array(SourceEvidenceSchema).max(40),
    claimSourceMap: z.array(ClaimSourceMappingSchema).max(100),
    examples: z.array(ArticleExampleSchema).max(20),
    caseStudies: z.array(CaseStudySchema).max(10),
    visuals: z.array(ArticleVisualSchema).max(20),
    unsupportedClaims: z.array(z.string()).max(50),
    /** Statistics without traceable evidence; these require review, not rejection. */
    unsourcedStatistics: z.array(z.string()).max(50),
    /** Case-study results without a verified source; these require review. */
    unverifiedCaseStudies: z.array(z.string()).max(20),
    /** Claims independently proven false by a trusted verifier. */
    fabricatedClaims: z.array(z.string()).max(20),
    extraction: EvidenceExtractionMetadataSchema,
});

export const PublicationGateResultSchema = z.object({
    passed: z.boolean(),
    status: z.enum(["DRAFT", "NEEDS_REVIEW", "EVIDENCE_REVIEW", "REJECTED"]),
    evidenceAvailability: EvidenceAvailabilitySchema,
    blockingIssues: z.array(z.string()).max(50),
    warnings: z.array(z.string()).max(50),
    evidenceIssues: z.array(z.string()).max(30),
    originalityIssues: z.array(z.string()).max(20),
    repetitionIssues: z.array(z.string()).max(20),
    fabricationIssues: z.array(z.string()).max(20),
});

export const OriginalValueResultSchema = z.object({
    passed: z.boolean(),
    uniqueContributions: z.array(z.string()).max(20),
    weakSections: z.array(z.string()).max(20),
    duplicateSections: z.array(z.string()).max(10),
    missingEvidence: z.array(z.string()).max(20),
    /** Plain-language editorial reasons for a non-passing originality result. */
    missingValue: z.array(z.string()).max(20),
});

export type SourceType = z.infer<typeof SourceTypeSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type EvidenceAvailability = z.infer<typeof EvidenceAvailabilitySchema>;
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export type ResearchBrain = z.infer<typeof ResearchBrainSchema>;
export type CompetitorResearch = z.infer<typeof CompetitorResearchSchema>;
export type PaaQuestion = z.infer<typeof PaaQuestionSchema>;
export type EntityEvidence = z.infer<typeof EntityEvidenceSchema>;
export type AuthorEvidence = z.infer<typeof AuthorEvidenceSchema>;
export type ResearchPacket = z.infer<typeof ResearchPacketSchema>;
export type OutlineTone = z.infer<typeof OutlineToneSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;
export type OutlinePlan = z.infer<typeof OutlinePlanSchema>;
export type SectionResearch = z.infer<typeof SectionResearchSchema>;
export type FAQItem = z.infer<typeof FAQItemSchema>;
export type GeneratedSection = z.infer<typeof GeneratedSectionSchema>;
export type EditorialAudit = z.infer<typeof EditorialAuditSchema>;
export type FactAudit = z.infer<typeof FactAuditSchema>;
export type SeoAudit = z.infer<typeof SeoAuditSchema>;
export type GeneratedBlog = z.infer<typeof GeneratedBlogSchema>;
export type ArticleExample = z.infer<typeof ArticleExampleSchema>;
export type CaseStudy = z.infer<typeof CaseStudySchema>;
export type ArticleVisual = z.infer<typeof ArticleVisualSchema>;
export type ClaimSourceMapping = z.infer<typeof ClaimSourceMappingSchema>;
export type EvidenceExtractionMetadata = z.infer<typeof EvidenceExtractionMetadataSchema>;
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
export type PublicationGateResult = z.infer<typeof PublicationGateResultSchema>;
export type OriginalValueResult = z.infer<typeof OriginalValueResultSchema>;

export const FAQ_OPENER = /^(yes|no|\d|never|always|most|few|it takes|within|about|roughly|typically|around|immediately|[A-Z][A-Za-z0-9+.-]*(?:\s+(?:is|does|can|helps?))?)/i;

export function isValidFaqOpener(answer: string): boolean {
    return FAQ_OPENER.test(answer.trim());
}
