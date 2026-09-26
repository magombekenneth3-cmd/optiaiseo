import { logger, formatError } from "@/lib/logger";
import type { Claim } from "./contracts";

export interface IntentCoverageSignal {
    primaryIntent: string;
    satisfied: boolean;
    matchedHeadings: string[];
    score: number;
}

export interface EntityCoverageSignal {
    expectedEntities: string[];
    presentEntities: string[];
    missingEntities: string[];
    score: number;
}

export interface QuestionCoverageSignal {
    expectedQuestions: string[];
    answeredQuestions: string[];
    unansweredQuestions: string[];
    score: number;
}

export interface TopicCoverageSignal {
    expectedTopics: string[];
    coveredTopics: string[];
    missingTopics: string[];
    score: number;
}

export interface EvidenceCoverageSignal {
    totalClaims: number;
    sourcedClaims: number;
    unsourcedClaims: string[];
    score: number;
}

export interface SemanticEnrichmentResult {
    intentCoverage: IntentCoverageSignal;
    entityCoverage: EntityCoverageSignal;
    questionCoverage: QuestionCoverageSignal;
    topicCoverage: TopicCoverageSignal;
    evidenceCoverage: EvidenceCoverageSignal;
    available: boolean;
}

function extractHeadings(html: string): string[] {
    return [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function containsTerm(text: string, term: string): boolean {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function significantTerms(phrase: string, minLength: number): string[] {
    const raw = phrase.toLowerCase().split(/\s+/).filter(Boolean);
    const long = raw.filter(t => t.length >= minLength);
    return long.length > 0 ? long : raw;
}

export function computeIntentCoverage(
    primaryIntent: string,
    content: string
): IntentCoverageSignal {
    const headings = extractHeadings(content);
    const plain = stripTags(content);
    const intentTerms = significantTerms(primaryIntent, 4);
    const matchedHeadings = headings.filter(h => {
        const lower = h.toLowerCase();
        return intentTerms.some(t => lower.includes(t));
    });

    const firstThird = plain.slice(0, Math.floor(plain.length / 3));
    const earlyMention = intentTerms.some(t => firstThird.toLowerCase().includes(t));
    const headingRatio = headings.length > 0
        ? matchedHeadings.length / Math.min(headings.length, 6)
        : 0;

    const score = intentTerms.length > 0
        ? Math.min(100, Math.round((earlyMention ? 40 : 0) + headingRatio * 60))
        : 0;

    return {
        primaryIntent,
        satisfied: score >= 50,
        matchedHeadings,
        score,
    };
}

export function computeEntityCoverage(
    expectedEntities: string[],
    content: string
): EntityCoverageSignal {
    const plain = stripTags(content).toLowerCase();
    const present: string[] = [];
    const missing: string[] = [];

    for (const entity of expectedEntities) {
        if (containsTerm(plain, entity)) {
            present.push(entity);
        } else {
            missing.push(entity);
        }
    }

    const score = expectedEntities.length > 0
        ? Math.round((present.length / expectedEntities.length) * 100)
        : 100;

    return {
        expectedEntities,
        presentEntities: present,
        missingEntities: missing,
        score,
    };
}

export function computeQuestionCoverage(
    expectedQuestions: string[],
    content: string
): QuestionCoverageSignal {
    const plain = stripTags(content).toLowerCase();
    const headings = extractHeadings(content).map(h => h.toLowerCase());
    const answered: string[] = [];
    const unanswered: string[] = [];

    for (const question of expectedQuestions) {
        const keyTerms = significantTerms(question, 4);
        if (keyTerms.length === 0) {
            unanswered.push(question);
            continue;
        }

        const matchCount = keyTerms.filter(t => plain.includes(t)).length;
        const inHeading = headings.some(h =>
            keyTerms.filter(t => h.includes(t)).length >= Math.ceil(keyTerms.length * 0.5)
        );

        if (inHeading || matchCount >= Math.ceil(keyTerms.length * 0.6)) {
            answered.push(question);
        } else {
            unanswered.push(question);
        }
    }

    const score = expectedQuestions.length > 0
        ? Math.round((answered.length / expectedQuestions.length) * 100)
        : 100;

    return {
        expectedQuestions,
        answeredQuestions: answered,
        unansweredQuestions: unanswered,
        score,
    };
}

export function computeTopicCoverage(
    expectedTopics: string[],
    content: string
): TopicCoverageSignal {
    const plain = stripTags(content).toLowerCase();
    const covered: string[] = [];
    const missing: string[] = [];

    for (const topic of expectedTopics) {
        const topicTerms = significantTerms(topic, 3);
        const matchCount = topicTerms.filter(t => plain.includes(t)).length;

        if (topicTerms.length > 0 && matchCount >= Math.ceil(topicTerms.length * 0.5)) {
            covered.push(topic);
        } else {
            missing.push(topic);
        }
    }

    const score = expectedTopics.length > 0
        ? Math.round((covered.length / expectedTopics.length) * 100)
        : 100;

    return {
        expectedTopics,
        coveredTopics: covered,
        missingTopics: missing,
        score,
    };
}

export function computeEvidenceCoverage(
    claims: Claim[]
): EvidenceCoverageSignal {
    const sourced = claims.filter(c => c.sourceIds.length > 0);
    const unsourced = claims
        .filter(c => c.sourceIds.length === 0)
        .map(c => c.text);

    const score = claims.length > 0
        ? Math.round((sourced.length / claims.length) * 100)
        : 100;

    return {
        totalClaims: claims.length,
        sourcedClaims: sourced.length,
        unsourcedClaims: unsourced,
        score,
    };
}

export function computeSemanticEnrichment(params: {
    primaryIntent: string;
    expectedEntities: string[];
    expectedQuestions: string[];
    expectedTopics: string[];
    claims: Claim[];
    content: string;
}): SemanticEnrichmentResult {
    try {
        return {
            intentCoverage: computeIntentCoverage(params.primaryIntent, params.content),
            entityCoverage: computeEntityCoverage(params.expectedEntities, params.content),
            questionCoverage: computeQuestionCoverage(params.expectedQuestions, params.content),
            topicCoverage: computeTopicCoverage(params.expectedTopics, params.content),
            evidenceCoverage: computeEvidenceCoverage(params.claims),
            available: true,
        };
    } catch (err: unknown) {
        logger.error("[SemanticEnrichment] Failed", { error: formatError(err) });
        return {
            intentCoverage: { primaryIntent: params.primaryIntent, satisfied: false, matchedHeadings: [], score: 0 },
            entityCoverage: { expectedEntities: [], presentEntities: [], missingEntities: [], score: 0 },
            questionCoverage: { expectedQuestions: [], answeredQuestions: [], unansweredQuestions: [], score: 0 },
            topicCoverage: { expectedTopics: [], coveredTopics: [], missingTopics: [], score: 0 },
            evidenceCoverage: { totalClaims: 0, sourcedClaims: 0, unsourcedClaims: [], score: 0 },
            available: false,
        };
    }
}