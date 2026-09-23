import type { PeopleAlsoAsk, SerpResult } from "./serp";

export type SeoOpportunityType = "topic_gap" | "question_gap" | "serp_gap";

export interface SeoOpportunity {
    type: SeoOpportunityType;
    topic: string;
    score: number;
    coverage: number;
    competitorCount: number;
    competitorTotal: number;
    rankWeightedCoverage: number;
    intentRelevance: number;
    evidence: string[];
    reason: string;
}

export interface SeoOpportunityAnalysis {
    tableStakes: string[];
    opportunities: SeoOpportunity[];
    unansweredQuestions: string[];
}

const STOPWORDS = new Set([
    "about","after","again","also","because","before","being","between","could",
    "does","doing","during","each","from","have","into","more","most","other",
    "should","some","such","than","that","their","there","these","they","this",
    "through","using","what","when","where","which","while","with","would",
    "your","guide","best","complete","ultimate","ways","tips","things",
]);

function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function terms(value: string): string[] {
    return [...new Set((normalize(value).match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter(term => !STOPWORDS.has(term)))];
}

function candidatePhrases(text: string): string[] {
    const words = terms(text);
    const output = new Set<string>();
    for (let i = 0; i < words.length; i += 1) {
        if (words[i].length >= 5) output.add(words[i]);
        if (i + 1 < words.length) output.add(words[i] + " " + words[i + 1]);
        if (i + 2 < words.length) output.add(words[i] + " " + words[i + 1] + " " + words[i + 2]);
    }
    return [...output];
}

function relevance(topic: string, keyword: string): number {
    const topicTerms = new Set(terms(topic));
    const keywordTerms = new Set(terms(keyword));
    if (!topicTerms.size || !keywordTerms.size) return 0;
    const overlap = [...topicTerms].filter(term => keywordTerms.has(term)).length;
    return overlap / Math.max(topicTerms.size, keywordTerms.size);
}

function rankWeight(index: number): number { return 1 / (index + 1); }

export function analyzeSeoOpportunities(keyword: string, results: SerpResult[], paa: PeopleAlsoAsk[] = []): SeoOpportunityAnalysis {
    const pages = results.filter(result => (result.scrapedContent ?? "").length >= 300);
    if (pages.length < 2) return { tableStakes: [], opportunities: [], unansweredQuestions: paa.map(item => item.question).filter(Boolean).slice(0, 20) };

    const candidateMap = new Map<string, { count: number; weighted: number; evidence: string[] }>();
    pages.forEach((page, index) => {
        const text = [page.title, ...(page.scrapedHeadings ?? []), page.scrapedContent ?? ""].join(" ");
        for (const phrase of new Set(candidatePhrases(text))) {
            if (phrase.length < 5 || phrase.length > 70) continue;
            const current = candidateMap.get(phrase) ?? { count: 0, weighted: 0, evidence: [] };
            current.count += 1;
            current.weighted += rankWeight(index);
            if (current.evidence.length < 3 && (page.scrapedHeadings ?? []).some(h => normalize(h).includes(phrase))) current.evidence.push(page.title);
            candidateMap.set(phrase, current);
        }
    });

    const total = pages.length;
    const denominator = pages.slice(0, 5).reduce((sum, _, i) => sum + rankWeight(i), 0);
    const sorted = [...candidateMap.entries()]
        .filter(([, value]) => value.count >= 2)
        .map(([topic, value]) => {
            const coverage = value.count / total;
            const rankWeightedCoverage = Math.min(1, value.weighted / denominator);
            const intentRelevance = relevance(topic, keyword);
            const weakness = 1 - coverage;
            const score = Math.round(Math.min(100, 100 * (weakness * 0.42 + Math.max(0, 0.65 - rankWeightedCoverage) * 0.28 + intentRelevance * 0.30)));
            return { topic, ...value, coverage, rankWeightedCoverage, intentRelevance, score };
        })
        .filter(item => item.intentRelevance >= 0.05)
        .sort((a, b) => b.score - a.score || a.count - b.count);

    const tableStakes = sorted.filter(item => item.coverage >= 0.7).sort((a, b) => b.coverage - a.coverage).slice(0, 20).map(item => item.topic);
    const opportunities: SeoOpportunity[] = sorted.filter(item => item.coverage < 0.7).slice(0, 20).map(item => ({
        type: item.coverage <= 0.3 ? "serp_gap" : "topic_gap",
        topic: item.topic,
        score: item.score,
        coverage: Math.round(item.coverage * 100),
        competitorCount: item.count,
        competitorTotal: total,
        rankWeightedCoverage: Math.round(item.rankWeightedCoverage * 100),
        intentRelevance: Math.round(item.intentRelevance * 100),
        evidence: item.evidence,
        reason: item.count + "/" + total + " analyzed competitors cover this topic; coverage is " + Math.round(item.coverage * 100) + "%, creating an observed SERP coverage gap.",
    }));

    const unansweredQuestions = paa.map(item => item.question.trim()).filter(Boolean).filter(question => {
        const qTerms = new Set(terms(question));
        const covered = pages.some(page => {
            const text = normalize([...(page.scrapedHeadings ?? []), page.scrapedContent ?? ""].join(" "));
            const hits = [...qTerms].filter(term => text.includes(term)).length;
            return qTerms.size > 0 && hits / qTerms.size >= 0.6;
        });
        return !covered;
    }).slice(0, 20);

    for (const question of unansweredQuestions.slice(0, 10)) opportunities.push({
        type: "question_gap",
        topic: question,
        score: Math.min(100, 70 + Math.round(relevance(question, keyword) * 30)),
        coverage: 0,
        competitorCount: 0,
        competitorTotal: total,
        rankWeightedCoverage: 0,
        intentRelevance: Math.round(relevance(question, keyword) * 100),
        evidence: ["People Also Ask question is not substantively covered across the analyzed pages."],
        reason: "This PAA question was found in the live SERP but was not adequately answered by the analyzed competitor content.",
    });

    return { tableStakes, opportunities: opportunities.sort((a, b) => b.score - a.score).slice(0, 25), unansweredQuestions };
}

export function computeContentGapsFromOpportunities(keyword: string, results: SerpResult[], paa: PeopleAlsoAsk[] = []) {
    const analysis = analyzeSeoOpportunities(keyword, results, paa);
    return { commonTopics: analysis.tableStakes, gapTopics: analysis.opportunities.slice(0, 20).map(item => item.topic), analysis };
}