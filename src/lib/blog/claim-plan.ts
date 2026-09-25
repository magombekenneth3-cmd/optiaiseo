import type { ResearchPacket, SourceEvidence } from "./contracts";
import type { ResearchEvidenceLedger, LedgerEvidenceItem } from "./evidence-ledger";
import type { OutlineSection } from "./pipeline";

export type PlannedClaimType =
    | "FACT"
    | "STATISTIC"
    | "CASE_STUDY"
    | "FIRST_PARTY_EXPERIENCE"
    | "GSC_OBSERVATION"
    | "SERP_OBSERVATION"
    | "INFERENCE"
    | "OPINION"
    | "RECOMMENDATION";

export type ClaimImportance = "CRITICAL" | "SUPPORTING" | "OPTIONAL";

export type AllowedInterpretation =
    | "VERBATIM"
    | "PARAPHRASE"
    | "QUALITATIVE_ONLY"
    | "HYPOTHETICAL_ONLY"
    | "EDITORIAL_STANCE";

export interface PlannedClaim {
    id: string;
    claim: string;
    type: PlannedClaimType;
    importance: ClaimImportance;
    evidenceIds: string[];
    evidenceRequired: boolean;
    allowedInterpretation: AllowedInterpretation;
    sectionId: string | null;
    sourceExcerpt: string | null;
    sourceUrl: string | null;
}

export interface SectionClaimPlan {
    sectionHeading: string;
    sectionGoal: string;
    claims: PlannedClaim[];
    evidenceInstructions: string;
}

export interface ClaimPlan {
    topic: string;
    totalPlannedClaims: number;
    evidenceBackedCount: number;
    firstPartyCount: number;
    inferenceCount: number;
    opinionCount: number;
    sectionPlans: SectionClaimPlan[];
    generationGuardrails: string;
}

function generatePlanId(index: number, prefix: string): string {
    return `plan-${prefix}-${index}`;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

function matchEvidenceToSection(
    sectionHeading: string,
    sectionGoal: string,
    evidenceItems: LedgerEvidenceItem[],
): LedgerEvidenceItem[] {
    const headingWords = sectionHeading.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    const goalWords = sectionGoal.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    const sectionWords = new Set([...headingWords, ...goalWords]);

    return evidenceItems.filter(item => {
        const itemWords = (item.content + " " + (item.excerpt ?? ""))
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 3);
        const overlap = itemWords.filter(w => sectionWords.has(w)).length;
        return overlap >= 2;
    });
}

function matchSourcesToSection(
    sectionHeading: string,
    sectionGoal: string,
    sources: SourceEvidence[],
): SourceEvidence[] {
    const headingWords = sectionHeading.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    const goalWords = sectionGoal.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3);
    const sectionWords = new Set([...headingWords, ...goalWords]);

    return sources.filter(source => {
        const srcWords = (source.claim + " " + source.evidence)
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 3);
        const overlap = srcWords.filter(w => sectionWords.has(w)).length;
        return overlap >= 2;
    });
}

function claimTypeFromEvidence(item: LedgerEvidenceItem): PlannedClaimType {
    const sourceType = item.provenance.sourceType;
    if (sourceType === "FIRST_PARTY_EXPERIENCE") return "FIRST_PARTY_EXPERIENCE";
    if (sourceType === "FIRST_PARTY_DATA") return "FIRST_PARTY_EXPERIENCE";
    if (sourceType === "GSC_DATA") return "GSC_OBSERVATION";
    if (sourceType === "SERP_OBSERVATION") return "SERP_OBSERVATION";
    if (sourceType === "INFERENCE") return "INFERENCE";
    if (/\b\d+(?:\.\d+)?(?:\s*%|\s*x\b|\s*times\b)/i.test(item.content)) return "STATISTIC";
    if (/case study|customer|client|company.*(?:saw|achieved|gained)/i.test(item.content)) return "CASE_STUDY";
    return "FACT";
}

function claimTypeFromSource(source: SourceEvidence): PlannedClaimType {
    if (/\b\d+(?:\.\d+)?(?:\s*%|\s*x\b|\s*times\b)/i.test(source.claim)) return "STATISTIC";
    if (/case study|customer|client|company.*(?:saw|achieved|gained)/i.test(source.claim)) return "CASE_STUDY";
    return "FACT";
}

function importanceFromType(type: PlannedClaimType): ClaimImportance {
    if (type === "STATISTIC" || type === "CASE_STUDY" || type === "FACT") return "CRITICAL";
    if (type === "FIRST_PARTY_EXPERIENCE" || type === "GSC_OBSERVATION") return "SUPPORTING";
    return "OPTIONAL";
}

function interpretationFromType(type: PlannedClaimType): AllowedInterpretation {
    if (type === "STATISTIC") return "VERBATIM";
    if (type === "CASE_STUDY") return "PARAPHRASE";
    if (type === "FACT") return "PARAPHRASE";
    if (type === "INFERENCE") return "QUALITATIVE_ONLY";
    if (type === "OPINION" || type === "RECOMMENDATION") return "EDITORIAL_STANCE";
    return "PARAPHRASE";
}

function evidenceRequiredForType(type: PlannedClaimType): boolean {
    return type === "FACT" || type === "STATISTIC" || type === "CASE_STUDY";
}

function buildClaimsFromLedgerItems(
    items: LedgerEvidenceItem[],
    sectionId: string,
): PlannedClaim[] {
    return items
        .filter(item =>
            item.provenance.sourceType !== "LLM_GENERATED" &&
            item.provenance.sourceType !== "INFERENCE",
        )
        .map((item, i) => {
            const type = claimTypeFromEvidence(item);
            return {
                id: generatePlanId(i, sectionId),
                claim: truncate(item.excerpt ?? item.content, 500),
                type,
                importance: importanceFromType(type),
                evidenceIds: [item.id],
                evidenceRequired: evidenceRequiredForType(type),
                allowedInterpretation: interpretationFromType(type),
                sectionId,
                sourceExcerpt: truncate(item.content, 300),
                sourceUrl: item.provenance.sourceUrl,
            };
        });
}

function buildClaimsFromSources(
    sources: SourceEvidence[],
    sectionId: string,
    existingClaimTexts: Set<string>,
): PlannedClaim[] {
    return sources
        .filter(source => !existingClaimTexts.has(source.claim.toLowerCase().trim()))
        .map((source, i) => {
            const type = claimTypeFromSource(source);
            return {
                id: generatePlanId(i + 100, sectionId),
                claim: truncate(source.claim, 500),
                type,
                importance: importanceFromType(type),
                evidenceIds: [source.id],
                evidenceRequired: evidenceRequiredForType(type),
                allowedInterpretation: interpretationFromType(type),
                sectionId,
                sourceExcerpt: truncate(source.evidence, 300),
                sourceUrl: source.url,
            };
        });
}

function buildSectionPlan(
    section: OutlineSection,
    sectionIndex: number,
    ledger: ResearchEvidenceLedger | null,
    researchPacket: ResearchPacket,
): SectionClaimPlan {
    const sectionId = `s${sectionIndex}`;
    const heading = section.heading;
    const goal = section.goal;

    const ledgerItems = ledger
        ? matchEvidenceToSection(heading, goal, ledger.evidenceItems)
        : [];
    const packetSources = matchSourcesToSection(heading, goal, researchPacket.sources);

    const ledgerClaims = buildClaimsFromLedgerItems(ledgerItems, sectionId);
    const existingTexts = new Set(ledgerClaims.map(c => c.claim.toLowerCase().trim()));
    const sourceClaims = buildClaimsFromSources(packetSources, sectionId, existingTexts);

    const claims = [...ledgerClaims, ...sourceClaims];

    if (section.evidenceType === "opinion" || section.evidenceType === "comparison") {
        claims.push({
            id: generatePlanId(200, sectionId),
            claim: `Editorial stance on ${heading}`,
            type: "OPINION",
            importance: "SUPPORTING",
            evidenceIds: [],
            evidenceRequired: false,
            allowedInterpretation: "EDITORIAL_STANCE",
            sectionId,
            sourceExcerpt: null,
            sourceUrl: null,
        });
    }

    const hasCaseStudyEvidence = claims.some(c => c.type === "CASE_STUDY");
    const evidenceInstructions = buildSectionEvidenceInstructions(section, hasCaseStudyEvidence, claims.length);

    return {
        sectionHeading: heading,
        sectionGoal: goal,
        claims,
        evidenceInstructions,
    };
}

function buildSectionEvidenceInstructions(
    section: OutlineSection,
    hasCaseStudyEvidence: boolean,
    claimCount: number,
): string {
    const lines: string[] = [];

    if (section.evidenceType === "case_study" && !hasCaseStudyEvidence) {
        lines.push("NO VERIFIED CASE STUDY DATA AVAILABLE. Use a clearly labelled hypothetical example. Do NOT invent a company, metric, or outcome.");
    }

    if (section.evidenceType === "data" && claimCount === 0) {
        lines.push("NO STATISTICAL EVIDENCE AVAILABLE for this section. Write the insight qualitatively. Do NOT invent a statistic.");
    }

    if (claimCount > 0) {
        lines.push(`${claimCount} evidence-backed claim(s) available. Use them as the factual backbone of this section.`);
    }

    lines.push("NEVER invent a statistic, case study result, customer outcome, or source.");
    lines.push("NEVER treat LLM output as evidence that a claim is true.");
    lines.push("If you must infer, use hedging language: 'likely', 'suggests', 'based on this'.");

    return lines.join("\n");
}

const GENERATION_GUARDRAILS = `CLAIM PLAN GUARDRAILS — MANDATORY:

1. STATISTICS: Use ONLY the statistics provided in the claim plan with their exact values.
   Do NOT round, estimate, extrapolate, or invent new statistics.
   If no statistic is provided for a point, write the insight qualitatively.

2. CASE STUDIES: Use ONLY case studies that appear in the claim plan with evidence IDs.
   Do NOT invent company names, customer results, traffic increases, conversion rates, or revenue figures.
   If no case study evidence exists, label the example as "Hypothetical example:" explicitly.

3. FIRST-PARTY CLAIMS: Use "our team", "we found", "our data" ONLY when a FIRST_PARTY_EXPERIENCE
   claim exists in the plan. Do NOT fabricate personal experience.

4. FACTS: Every factual claim must trace to a claim plan entry with evidence.
   If you want to make a factual statement not in the plan, write it as opinion or inference instead.

5. INFERENCE: Mark inferences explicitly: "This suggests...", "This likely means...", "Based on this..."
   NEVER present an inference as established fact.

6. LLM OUTPUT IS NOT EVIDENCE: Your own reasoning, pattern matching, or training data
   cannot validate a factual claim. Only the supplied evidence can.

7. SOURCE ATTRIBUTION: When using a statistic or fact from the plan, cite the source inline
   using the source URL or title provided in the claim plan entry.`;

export function buildClaimPlan(
    sections: OutlineSection[],
    researchPacket: ResearchPacket,
    ledger: ResearchEvidenceLedger | null,
    topic: string,
): ClaimPlan {
    const sectionPlans = sections.map((section, i) =>
        buildSectionPlan(section, i, ledger, researchPacket),
    );

    const allClaims = sectionPlans.flatMap(sp => sp.claims);
    const evidenceBacked = allClaims.filter(c => c.evidenceIds.length > 0).length;
    const firstParty = allClaims.filter(c => c.type === "FIRST_PARTY_EXPERIENCE").length;
    const inference = allClaims.filter(c => c.type === "INFERENCE").length;
    const opinion = allClaims.filter(c => c.type === "OPINION" || c.type === "RECOMMENDATION").length;

    return {
        topic,
        totalPlannedClaims: allClaims.length,
        evidenceBackedCount: evidenceBacked,
        firstPartyCount: firstParty,
        inferenceCount: inference,
        opinionCount: opinion,
        sectionPlans,
        generationGuardrails: GENERATION_GUARDRAILS,
    };
}

export function renderClaimPlanForSection(sectionPlan: SectionClaimPlan): string {
    if (sectionPlan.claims.length === 0) {
        return `CLAIM PLAN: No pre-planned claims for this section.\n${sectionPlan.evidenceInstructions}`;
    }

    const claimLines = sectionPlan.claims.map(c => {
        const evidenceNote = c.evidenceIds.length > 0
            ? `[Evidence: ${c.evidenceIds.join(", ")}]`
            : "[No evidence — opinion/inference only]";
        const interpretation = `[Interpretation: ${c.allowedInterpretation}]`;
        const source = c.sourceUrl ? `[Source: ${c.sourceUrl}]` : "";
        return `- [${c.type}] (${c.importance}) ${c.claim} ${evidenceNote} ${interpretation} ${source}`.trim();
    });

    return `CLAIM PLAN FOR THIS SECTION:
${claimLines.join("\n")}

${sectionPlan.evidenceInstructions}`;
}

export function renderFullClaimPlan(plan: ClaimPlan): string {
    const header = `CLAIM PLAN SUMMARY:
Topic: ${plan.topic}
Total planned claims: ${plan.totalPlannedClaims}
Evidence-backed: ${plan.evidenceBackedCount}
First-party: ${plan.firstPartyCount}
Inference: ${plan.inferenceCount}
Opinion/recommendation: ${plan.opinionCount}`;

    const sections = plan.sectionPlans.map(sp => {
        const claimLines = sp.claims.map(c => {
            const evidenceNote = c.evidenceIds.length > 0
                ? `[Evidence: ${c.evidenceIds.join(", ")}]`
                : "[No evidence]";
            return `  - [${c.type}] ${c.claim} ${evidenceNote}`;
        });
        return `Section: "${sp.sectionHeading}"\n${claimLines.join("\n") || "  (no claims)"}`;
    });

    return `${header}\n\n${sections.join("\n\n")}\n\n${plan.generationGuardrails}`;
}
