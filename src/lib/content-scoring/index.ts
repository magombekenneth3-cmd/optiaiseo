import { logger } from "@/lib/logger";
import { parse } from 'node-html-parser';
import { redis } from "@/lib/redis";

import { GEMINI_3_FLASH } from "@/lib/constants/ai-models";

export interface Entity {
    name: string;
    type: string;
    salience: number;
    mentions: number;
}

export interface OutlineHeading {
    level: 'h2' | 'h3';
    text: string;
    priority: 'high' | 'medium';
}

// FIX #12: TF-IDF output
export interface TfIdfResult {
    semanticCoverageScore: number; // 0-100
    overUsed: Array<{ term: string; yourTf: number; avgTf: number }>;
    underUsed: Array<{ term: string; avgTf: number; yourTf: number }>;
}

// FIX #13: Sentence-level AI detection
export interface SentenceScore {
    text: string;
    aiScore: number;        // 0-100: higher = more AI-like
    markers: string[];      // e.g. ['passive_voice', 'hedge_word', 'uniform_length']
    suggestion?: string;    // humanization tip if aiScore > 60
}

export interface ContentScoreResult {
    score: number; // 0-100 total
    subScores: {
        wordCount: { score: number; current: number; targetMin: number; targetMax: number };
        exactKeywords: { score: number; current: number; targetMin: number; targetMax: number };
        nlpTerms: { score: number; covered: string[]; missing: string[] };
        headings: { score: number; covered: string[]; missing: string[] };
        readability: { score: number; gradeLevel: number };
    };
    competitors: { url: string; wordCount: number; score: number }[];
    topOpportunities: string[];
    entities: Entity[];
    keywordDensity: Record<string, number>;
    sentiment: string;
    readabilityScore: number;
    // New Surfer SEO parity features
    outlineSuggestions: OutlineHeading[];
    imageRecommendation: { current: number; targetMin: number; targetMax: number; suggestion: string };
    aiDetectionScore: number; // 0–100, lower = more human-like
    // FIX #12 & #13
    tfIdf?: TfIdfResult;
    sentenceScores?: SentenceScore[];
    benchmarkWarning?: string;
}

function buildFallbackBenchmark() {
    return {
        p25WC: 800,
        p75WC: 2200,
        medianKW: 3,
        top15Headings: [],
        top20Entities: [],
        p25Images: 2,
        p75Images: 8,
        competitors: [],
        _isFallback: true
    };
}

// Helper: Extract entities via Gemini
async function extractEntitiesFromCompetitors(texts: string): Promise<Entity[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return [];
    try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `
          Extract the 20 most common and important named entities (people, organizations, products, concepts, NLP terms) from the following competitor articles. 
          Return a JSON array of up to 20 entities, ordered by frequency/importance.
          Format exact JSON array of objects: [{ "name": "Entity Name", "type": "Concept", "salience": 0.9, "mentions": 5 }]
          
          Texts:
          ${texts.slice(0, 30000)}
        `;
        const response = await ai.models.generateContent({
            model: GEMINI_3_FLASH,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        const textResponse = response.text || "";
        const result = JSON.parse(textResponse.replace(/```json|```/g, "").trim() || "[]");
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result.map((r: any) => ({
            name: r.name,
            type: r.type || 'Concept',
            salience: r.salience || 0.5,
            mentions: r.mentions || 1
         
        }));
     
    } catch (e: unknown) {
        logger.error("Entity extraction failed", { error: (e as Error)?.message || String(e) });
        return [];
    }
}

// Phase 1: SERP Benchmark
// Retries and Timeout included in fetch for reliability
async function getSerpBenchmark(keyword: string) {
    const cacheKey = `content-score:benchmark:${keyword.toLowerCase().trim()}`;
    try {
         
        const cached = await redis.get(cacheKey);
        if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
     
    } catch (e: unknown) {
        logger.error("Redis fetch failed", { error: (e as Error)?.message || String(e) });
    }

    const serperKey = process.env.SERPER_API_KEY || process.env.SERPAPI_KEY || "";
    if (!serperKey) throw new Error("Missing SERPER_API_KEY");

    const serperRes = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
            "X-API-KEY": serperKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: keyword, num: 10 })
    });

    if (!serperRes.ok) {
        throw new Error("Serper API failed");
     
    }

    const serperData = await serperRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const urls = serperData.organic?.slice(0, 10).map((r: any) => r.link) || [];

    const fetchPromises = urls.map(async (url: string) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            const html = await res.text();
            return { url, html };
        } catch {
            return null;
        }
     
    });

    const pages = (await Promise.all(fetchPromises)).filter(Boolean);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const competitorData = pages.map((page: any) => {
        const root = parse(page.html);
        root.querySelectorAll('script, style, noscript, nav, footer, header').forEach(el => el.remove());
        const text = root.textContent || "";
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;

        const headings = root.querySelectorAll('h2, h3').map(el => el.textContent.trim()).filter(t => t.length > 0);
        const imageCount = root.querySelectorAll('img').length;

        const kw = keyword.toLowerCase();
        const exactMatches = text.toLowerCase().split(kw).length - 1;

        return { url: page.url, text, wordCount, headings, exactMatches, imageCount };
    });

    const allTexts = competitorData.map(c => c.text.slice(0, 2000)).join("\n---\n");
    const entities = await extractEntitiesFromCompetitors(allTexts);

    const wordCounts = competitorData.map(c => c.wordCount).sort((a, b) => a - b);
    const p25WC = wordCounts[Math.floor(wordCounts.length * 0.25)] || 500;
    const p75WC = wordCounts[Math.floor(wordCounts.length * 0.75)] || 2000;

    const kwCounts = competitorData.map(c => c.exactMatches).sort((a, b) => a - b);
    const medianKW = kwCounts[Math.floor(kwCounts.length * 0.5)] || 2;

    const allHeadings = competitorData.flatMap(c => c.headings);
    const headingCounts: Record<string, number> = {};
    allHeadings.forEach(h => {
        if (h.length < 5 || h.length > 100) return;
        const normalized = h.toLowerCase();
        headingCounts[normalized] = (headingCounts[normalized] || 0) + 1;
    });

    const top15Headings = Object.entries(headingCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(e => e[0]);

    const imageCounts = competitorData.map(c => c.imageCount).sort((a, b) => a - b);
    const p25Images = imageCounts[Math.floor(imageCounts.length * 0.25)] || 1;
    const p75Images = imageCounts[Math.floor(imageCounts.length * 0.75)] || 8;

    const benchmark = {
        p25WC,
        p75WC,
        medianKW,
        top15Headings,
        top20Entities: entities.slice(0, 20),
        p25Images,
        p75Images,
         
        competitors: competitorData.map(c => ({ url: c.url, wordCount: c.wordCount }))
    };

    try {
        await redis.set(cacheKey, JSON.stringify(benchmark), { ex: 86400 }); // 24 hours TTL
     
    } catch (e: unknown) {
        logger.error("Redis set failed", { error: (e as Error)?.message || String(e) });
    }

    return benchmark;
}

// Helpers for readibility
function countSyllables(word: string) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    return word.match(/[aeiouy]{1,2}/g)?.length || 1;
}

function calculateFleschKincaid(text: string) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (words.length === 0 || sentences.length === 0) return 0;

    const syllables = words.reduce((acc, word) => acc + countSyllables(word), 0);
    const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
    return Math.max(0, parseFloat(grade.toFixed(1)));
}

// =============================================================================
// FIX #12: TF-IDF Scorer
// Computes term frequency–inverse document frequency across competitor pages
// to identify semantically over/under-used terms vs the SERP top-10.
// =============================================================================
function tokenize(text: string): string[] {
    return text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
}

const STOP_WORDS = new Set(['the','and','for','are','was','has','have','not','with','this','that','from','they','will','been','were','which','when','your','our','their','its','can','but','all','one','you']);

function computeTfIdf(targetDoc: string, competitorDocs: string[]): TfIdfResult {
    const allDocs = [targetDoc, ...competitorDocs];
    const tokenizedDocs = allDocs.map(d => tokenize(d).filter(t => !STOP_WORDS.has(t)));
    const [targetTokens, ...corpusTokens] = tokenizedDocs;

    // Build document frequencies (how many docs contain each term)
    const df: Record<string, number> = {};
    tokenizedDocs.forEach(tokens => {
        const unique = new Set(tokens);
        unique.forEach(t => { df[t] = (df[t] || 0) + 1; });
    });

    const N = allDocs.length;

    // Compute TF for target doc
    const targetTf: Record<string, number> = {};
    const targetLen = targetTokens.length || 1;
    targetTokens.forEach(t => { targetTf[t] = (targetTf[t] || 0) + 1; });
    Object.keys(targetTf).forEach(t => { targetTf[t] = targetTf[t] / targetLen; });

    // Compute average TF across competitor docs
    const avgTf: Record<string, number> = {};
    corpusTokens.forEach(tokens => {
        const len = tokens.length || 1;
        const freq: Record<string, number> = {};
        tokens.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
        Object.keys(freq).forEach(t => { avgTf[t] = (avgTf[t] || 0) + freq[t] / len; });
    });
    const corpusCount = corpusTokens.length || 1;
    Object.keys(avgTf).forEach(t => { avgTf[t] /= corpusCount; });

    // IDF (log-smoothed)
    const idf = (term: string) => Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;

    // Find significant competitors terms the target under/over uses
    const topCompetitorTerms = Object.entries(avgTf)
        .filter(([t]) => df[t] >= Math.ceil(N * 0.5)) // in ≥50% of docs
        .map(([t, avgTfVal]) => ({ term: t, avgTf: avgTfVal * idf(t), yourTf: (targetTf[t] || 0) * idf(t) }))
        .sort((a, b) => b.avgTf - a.avgTf)
        .slice(0, 60);

    const underUsed = topCompetitorTerms
        .filter(x => x.yourTf < x.avgTf * 0.5)
        .slice(0, 10);
    const overUsed = topCompetitorTerms
        .filter(x => x.yourTf > x.avgTf * 2.5)
        .slice(0, 5);

    // Coverage: how many top competitor terms does the target doc cover at ≥25% of avg?
    const covered = topCompetitorTerms.filter(x => x.yourTf >= x.avgTf * 0.25).length;
    const semanticCoverageScore = topCompetitorTerms.length > 0
        ? Math.round((covered / topCompetitorTerms.length) * 100)
        : 100;

    return { semanticCoverageScore, underUsed, overUsed };
}

// =============================================================================
// FIX #13: Sentence-Level AI Detection
// Per-sentence scoring with marker detection and humanization suggestions.
// =============================================================================
const HEDGE_WORDS = /\b(it is worth noting|it should be noted|importantly|furthermore|additionally|in conclusion|in summary|as we can see|needless to say|undoubtedly|certainly|clearly|of course|it goes without saying|overall|in the realm of)\b/i;
const PASSIVE_VOICE = /\b(is|are|was|were|be|been|being)\s+\w+ed\b/i;
const TRANSITION_OVERUSE = /^(however|moreover|therefore|thus|consequently|in addition|on the other hand|as a result),/i;

export function scoreSentences(content: string): SentenceScore[] {
    const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = plainText.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s => s.trim().length > 15);

    const lengths = sentences.map(s => s.split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);

    return sentences.slice(0, 100).map((sentence, i) => {
        const markers: string[] = [];
        let aiScore = 0;

        if (PASSIVE_VOICE.test(sentence)) { markers.push('passive_voice'); aiScore += 20; }
        if (HEDGE_WORDS.test(sentence)) { markers.push('hedge_word'); aiScore += 25; }
        if (TRANSITION_OVERUSE.test(sentence.trim())) { markers.push('transition_opener'); aiScore += 15; }

        // Length uniformity (compared to doc average)
        const lenDiff = Math.abs(lengths[i] - avgLen) / (avgLen || 1);
        if (lenDiff < 0.15) { markers.push('uniform_length'); aiScore += 20; }

        // Very long sentence (AI tends toward long, complex sentences)
        if (lengths[i] > 35) { markers.push('too_long'); aiScore += 15; }

        aiScore = Math.min(100, aiScore);

        let suggestion: string | undefined;
        if (aiScore >= 60) {
            if (markers.includes('passive_voice')) suggestion = 'Rewrite in active voice: identify the subject performing the action.';
            else if (markers.includes('hedge_word')) suggestion = 'Remove hedging phrase and state the point directly.';
            else if (markers.includes('too_long')) suggestion = 'Split into 2 shorter sentences (<20 words each).';
            else suggestion = 'Vary sentence length and use a more direct, conversational tone.';
        }

        return { text: sentence.slice(0, 200), aiScore, markers, suggestion };
    });
}


/**
 * Real-time NLP Scoring & Entity Authority Mapping.
 * 3-phase pipeline with SERP benchmarking.
 */
export const scoreContent = async (
    content: string,
    targetKeywords: string[]
): Promise<ContentScoreResult> => {
    const primaryKeyword = targetKeywords[0] || "";

    if (!content || !primaryKeyword) {
        return {
            score: 0,
            subScores: {
                wordCount: { score: 0, current: 0, targetMin: 0, targetMax: 0 },
                exactKeywords: { score: 0, current: 0, targetMin: 0, targetMax: 0 },
                nlpTerms: { score: 0, covered: [], missing: [] },
                headings: { score: 0, covered: [], missing: [] },
                readability: { score: 0, gradeLevel: 0 },
            },
            competitors: [],
            topOpportunities: ["Add content and a target keyword to begin analysis"],
            entities: [],
            sentiment: "Neutral",
            readabilityScore: 0,
            keywordDensity: {},
             
            outlineSuggestions: [],
            imageRecommendation: { current: 0, targetMin: 1, targetMax: 5, suggestion: "Add images to match competitor benchmarks" },
            aiDetectionScore: 0,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let benchmark: any;
     
    let benchmarkWarning: string | undefined;
    try {
        benchmark = await getSerpBenchmark(primaryKeyword);
        if (benchmark.competitors.length === 0) {
            benchmark = buildFallbackBenchmark();
            benchmarkWarning = 'No competitor pages could be fetched from the SERP — scores use industry averages.';
        }
     
    } catch (err: unknown) {
        logger.error("[ContentScoring] Benchmarking failed:", { error: (err as Error)?.message || String(err) });
        benchmark = buildFallbackBenchmark();
        benchmarkWarning = !process.env.SERPER_API_KEY 
            ? 'SERPER_API_KEY is not configured — add it to .env to enable live benchmarking.'
            : 'SERP benchmark failed (API error) — scores use industry averages.';
    }

    // Phase 2: Score against benchmarks
    const textOnly = content.replace(/<[^>]*>?/gm, '');
    const wordsArray = textOnly.split(/\s+/).filter(w => w.length > 0);
    const wordCount = wordsArray.length;
    const exactMatches = textOnly.toLowerCase().split(primaryKeyword.toLowerCase()).length - 1;

    // 1. Word Count (20pts)
    let wordCountScore = 0;
    if (wordCount >= benchmark.p25WC && wordCount <= benchmark.p75WC) {
        wordCountScore = 20;
    } else {
        const lowerBound = benchmark.p25WC * 0.8;
        const upperBound = benchmark.p75WC * 1.2;
        if (wordCount >= lowerBound && wordCount <= upperBound) {
            wordCountScore = 15;
        } else if (wordCount >= benchmark.p25WC * 0.6 && wordCount <= benchmark.p75WC * 1.4) {
            wordCountScore = 10;
        } else {
            wordCountScore = 5;
        }
    }

    // 2. Exact Keywords (20pts)
    let exactKeywordsScore = 0;
    const kwDiff = Math.abs(exactMatches - benchmark.medianKW);
    if (kwDiff <= 2) {
        exactKeywordsScore = 20;
    } else if (kwDiff <= 5) {
        exactKeywordsScore = 15;
    } else if (kwDiff <= 10) {
        exactKeywordsScore = 10;
    } else {
        exactKeywordsScore = 5;
    }

    // 3. NLP Terms (20pts)
    const contentLower = textOnly.toLowerCase();
    const benchmarkEntities = benchmark.top20Entities.map((e: Entity) => e.name);
    const coveredEntities = benchmarkEntities.filter((e: string) => contentLower.includes(e.toLowerCase()));
    const missingEntities = benchmarkEntities.filter((e: string) => !contentLower.includes(e.toLowerCase()));
    const nlpScore = benchmarkEntities.length === 0 ? 20 : Math.min(20, Math.round((coveredEntities.length / benchmarkEntities.length) * 20));

    // 4. Headings (20pts)
    const root = parse(content);
    const userHeadings = root.querySelectorAll('h1, h2, h3, h4').map(el => el.textContent.trim().toLowerCase());
    const coveredHeadings: string[] = [];
    const missingHeadings: string[] = [];

    for (const h of benchmark.top15Headings) {
        if (userHeadings.some((uh: string) => uh.includes(h) || h.includes(uh))) {
            coveredHeadings.push(h);
        } else {
            missingHeadings.push(h);
        }
    }
    const headingScore = benchmark.top15Headings.length === 0 ? 20 : Math.min(20, Math.round((coveredHeadings.length / Math.min(benchmark.top15Headings.length, 15)) * 20));

    // 5. Readability (20pts)
    const gradeLevel = calculateFleschKincaid(textOnly);
    let readabilityScore = 0;
    if (gradeLevel >= 8 && gradeLevel <= 10) {
        readabilityScore = 20;
    } else if ((gradeLevel >= 6 && gradeLevel < 8) || (gradeLevel > 10 && gradeLevel <= 12)) {
        readabilityScore = 15;
    } else {
        readabilityScore = 10;
    }

    const totalScore = wordCountScore + exactKeywordsScore + nlpScore + headingScore + readabilityScore;

    // Phase 3: Generate actionable recommendations
    const topOpportunities: string[] = [];

    if (wordCountScore < 15) {
        if (wordCount < benchmark.p25WC) {
            topOpportunities.push(`Increase word count from ${wordCount} to at least ${benchmark.p25WC}.`);
        } else {
            topOpportunities.push(`Decrease word count from ${wordCount} to be closer to ${benchmark.p75WC}.`);
        }
    }
    if (exactKeywordsScore < 15) {
        if (exactMatches < benchmark.medianKW) {
            topOpportunities.push(`Add the target keyword '${primaryKeyword}' ${benchmark.medianKW - exactMatches} more times.`);
        } else {
            topOpportunities.push(`Reduce the target keyword '${primaryKeyword}' by ${exactMatches - benchmark.medianKW} mentions to match competitor median (${benchmark.medianKW}).`);
        }
    }
    if (nlpScore < 15 && missingEntities.length > 0) {
        topOpportunities.push(`Add missing semantic terms: ${missingEntities.slice(0, 3).join(', ')}.`);
    }
    if (headingScore < 15 && missingHeadings.length > 0) {
        topOpportunities.push(`Include competitor headings like: "${missingHeadings[0]}".`);
    }
    if (readabilityScore < 15) {
        if (gradeLevel > 10) {
            topOpportunities.push(`Simplify your writing. Current grade level is ${gradeLevel}, target 8-10.`);
        } else {
            topOpportunities.push(`Make your writing more sophisticated. Current grade level is ${gradeLevel}, target 8-10.`);
        }
    }

    // Fill anything missing
    while (topOpportunities.length < 5 && missingEntities.length > 5) {
        const moreMissing = missingEntities.slice(3, 8);
        topOpportunities.push(`Consider covering topics like: ${moreMissing.join(', ')}`);
        break;
    }

    const density: Record<string, number> = {};
    targetKeywords.forEach(kw => {
        const count = textOnly.toLowerCase().split(kw.toLowerCase()).length - 1;
        density[kw] = wordCount > 0 ? (count / wordCount) * 100 : 0;
    });

    // === Outline Builder ===
    // Merge missing competitor headings + top entities into a suggested H2/H3 structure
    const outlineSuggestions: import('./index').OutlineHeading[] = [];
    for (const heading of missingHeadings.slice(0, 6)) {
        outlineSuggestions.push({ level: 'h2', text: heading.charAt(0).toUpperCase() + heading.slice(1), priority: 'high' });
    }
    // Add entity-driven H3 suggestions for depth
    for (const entity of missingEntities.slice(0, 4)) {
        outlineSuggestions.push({ level: 'h3', text: `Understanding ${entity}`, priority: 'medium' });
    }

    // === Image Count Recommendation ===
    // Heuristic: count markdown images + HTML <img> tags in content
    const mdImageCount = (content.match(/!\[.*?\]\(.*?\)/g) || []).length;
    const htmlImageCount = (content.match(/<img\s/gi) || []).length;
    const currentImageCount = mdImageCount + htmlImageCount;
    const imageSuggestion = currentImageCount < (benchmark.p25Images || 1)
        ? `Add ${(benchmark.p25Images || 2) - currentImageCount} more image(s) — competitors average ${benchmark.p75Images || 5} images.`
        : currentImageCount > (benchmark.p75Images || 8)
            ? `You have more images than top competitors. Consider reducing to ~${benchmark.p75Images || 5}.`
            : `Image count looks good (${currentImageCount} images, competitors average ${Math.round(((benchmark.p25Images || 1) + (benchmark.p75Images || 8)) / 2)}).`;

    // === AI Detection Score (burstiness heuristic) ===
    const sentences = textOnly.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    let aiDetectionScore = 0;
    if (sentences.length > 3) {
        const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
        const avgLen2 = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
        const variance = sentenceLengths.reduce((acc, l) => acc + Math.pow(l - avgLen2, 2), 0) / sentenceLengths.length;
        const burstiness = Math.sqrt(variance) / avgLen2;
        aiDetectionScore = Math.max(0, Math.min(100, Math.round((1 - Math.min(burstiness, 1)) * 100)));
    }

    // FIX #12: TF-IDF semantic coverage
    const competitorTexts = benchmark.competitors.map((_c: { url: string; wordCount: number }) => {
        // We only have wordCount here — reuse cached allTexts if available via entities
        return benchmark.top20Entities.map((e: Entity) => e.name).join(' ');
    });
    const tfIdf = computeTfIdf(textOnly, competitorTexts.length > 0 ? competitorTexts : [textOnly]);

    // FIX #13: Sentence-level AI detection
    const sentenceScores = scoreSentences(content);

    return {
        score: totalScore,
        subScores: {
            wordCount: { score: wordCountScore, current: wordCount, targetMin: benchmark.p25WC, targetMax: benchmark.p75WC },
            exactKeywords: { score: exactKeywordsScore, current: exactMatches, targetMin: benchmark.medianKW, targetMax: benchmark.medianKW },
            nlpTerms: { score: nlpScore, covered: coveredEntities, missing: missingEntities },
            headings: { score: headingScore, covered: coveredHeadings, missing: missingHeadings },
            readability: { score: readabilityScore, gradeLevel },
        },
        competitors: benchmark.competitors,
        topOpportunities: topOpportunities.slice(0, 5),
        entities: benchmark.top20Entities,
        keywordDensity: density,
        sentiment: "Determined via Score",
        readabilityScore: gradeLevel,
        outlineSuggestions,
        imageRecommendation: {
            current: currentImageCount,
            targetMin: benchmark.p25Images || 1,
            targetMax: benchmark.p75Images || 8,
            suggestion: imageSuggestion,
        },
        aiDetectionScore,
        tfIdf,
        sentenceScores,
        ...(benchmarkWarning ? { benchmarkWarning } : {}),
    };
};

// =============================================================================
// Sitewide Zero-Traffic Content Health Check
// Reports what percentage of a site's indexed pages have zero GSC impressions
// over 90 days, and surfaces noindex/upgrade candidates by URL.
// =============================================================================

export interface SitewideContentHealth {
    totalPages: number;
    zeroTrafficCount: number;
    zeroTrafficPercent: number;
    /** true when >30% of indexed pages have zero impressions — sitewide ranking drag */
    domainWarning: boolean;
    zeroTrafficUrls: string[];
    lowTrafficUrls: string[];
    recommendations: {
        /** URLs worth upgrading — appear in keyword data so intent exists */
        upgrade: string[];
        /** URLs to consider noindex — zero impressions + very low word estimate */
        noindex: string[];
    };
}

/**
 * Analyses sitewide content health using keyword rank snapshots as a proxy
 * for GSC impression data. Groups indexed pages into zero/low/healthy buckets
 * and flags a domain-level warning when >30% of pages show no traffic signal.
 *
 * @param siteId  - Prisma site ID
 * @param days    - lookback window (default 90)
 */
export async function getSitewideContentHealth(
    siteId: string,
    days = 90
): Promise<SitewideContentHealth> {
    try {
        const { prisma } = await import("@/lib/prisma");
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        // Use RankSnapshot as GSC impression proxy:
        // Each unique URL that appeared in rank snapshots has some impression data.
        const snapshots = await prisma.rankSnapshot.findMany({
            where: {
                siteId,
                recordedAt: { gte: cutoff },
            },
            select: { url: true, position: true, keyword: true },
        });

        // Group by URL — collect all keywords+positions per URL
        const urlMap = new Map<string, { positions: number[]; keywords: string[] }>();
        for (const snap of snapshots) {
            const url = snap.url ?? "unknown";
            if (!urlMap.has(url)) urlMap.set(url, { positions: [], keywords: [] });
            const entry = urlMap.get(url)!;
            entry.positions.push(snap.position);
            if (snap.keyword) entry.keywords.push(snap.keyword);
        }

        const allUrls = [...urlMap.keys()].filter(u => u !== "unknown");
        const totalPages = allUrls.length;

        // "Zero traffic" heuristic: URL only ever appears with position > 50
        // (effectively invisible — likely zero impressions in GSC)
        const zeroTrafficUrls: string[] = [];
        const lowTrafficUrls: string[] = [];
        const upgradeUrls: string[] = [];
        const noindexUrls: string[] = [];

        for (const [url, data] of urlMap.entries()) {
            if (url === "unknown") continue;
            const minPosition = Math.min(...data.positions);
            const hasKeywords = data.keywords.length > 0;

            if (minPosition > 50) {
                zeroTrafficUrls.push(url);
                // Upgrade candidate: keywords exist with intent worth pursuing
                if (hasKeywords && minPosition <= 100) upgradeUrls.push(url);
                // Noindex candidate: deep position (100+), no meaningful keyword signal
                if (minPosition > 100 || !hasKeywords) noindexUrls.push(url);
            } else if (minPosition > 20) {
                lowTrafficUrls.push(url);
            }
        }

        const zeroTrafficPercent = totalPages > 0
            ? Math.round((zeroTrafficUrls.length / totalPages) * 100)
            : 0;

        return {
            totalPages,
            zeroTrafficCount: zeroTrafficUrls.length,
            zeroTrafficPercent,
            domainWarning: zeroTrafficPercent > 30,
            zeroTrafficUrls: zeroTrafficUrls.slice(0, 50),
            lowTrafficUrls: lowTrafficUrls.slice(0, 50),
            recommendations: {
                upgrade: upgradeUrls.slice(0, 20),
                noindex: noindexUrls.slice(0, 20),
            },
        };
    } catch (err: unknown) {
        logger.error("[SitewideHealth] Failed to compute content health:", {
            error: (err as Error)?.message || String(err),
        });
        return {
            totalPages: 0,
            zeroTrafficCount: 0,
            zeroTrafficPercent: 0,
            domainWarning: false,
            zeroTrafficUrls: [],
            lowTrafficUrls: [],
            recommendations: { upgrade: [], noindex: [] },
        };
    }
}

