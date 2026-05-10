import { logger } from "@/lib/logger";
// =============================================================================
// FIX #10: Scored Google AI Overview Eligibility Model
// Replaces the simple hasOverview/brandMentioned binary with a multi-signal
// eligibility scorer that works even without SerpAPI.
// =============================================================================

export interface AioEligibilityResult {
    hasOverview: boolean;
    brandMentioned: boolean;
    score: number; // 0-100 composite eligibility score
    eligibilitySignals: {
        hasFaqSchema: boolean;
        hasHowToSchema: boolean;
        hasDefinitionSentence: boolean;
        hasOrderedList: boolean;
        hasStatistic: boolean;
        readabilityOk: boolean;
        hasConcisSummary: boolean;  // First paragraph < 80 words with direct answer
    };
    recommendation: string;
}

/**
 * Analyse page HTML to produce an AI Overview eligibility score.
 * Works in two modes:
 *  1. Live SERP check via SerpAPI (if SERPAPI_KEY set) for real AIO presence
 *  2. On-page signals heuristic (always runs) for eligibility guidance
 */
export async function checkGoogleAIOverview(
    domain: string,
    keyword: string,
    pageHtml?: string
): Promise<AioEligibilityResult> {

    const html = pageHtml ?? '';
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const firstParagraphMatch = text.match(/(?<=<p[^>]*>)[^<]{40,}/i);
    const firstParagraph = firstParagraphMatch ? firstParagraphMatch[0] : text.slice(0, 500);

    // JSON-LD schema signals
    const jsonLdBlocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    const schemaText = jsonLdBlocks.map(m => m[1]).join(' ');
    const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/.test(schemaText);
    const hasHowToSchema = /"@type"\s*:\s*"HowTo"/.test(schemaText);

    // Definition-style opening sentence (what is X / X is a / X refers to)
    const hasDefinitionSentence = /\b(is\s+a|are|refers?\s+to|defined?\s+as|means?)\b/i.test(firstParagraph.slice(0, 200));

    // Ordered list (step-by-step = AIO favourite)
    const hasOrderedList = /<ol[\s>]/i.test(html);

    // Statistics / numbers lend credibility
    const hasStatistic = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*%|\s*million|\s*billion|\s*percent)\b/i.test(text);

    // First paragraph conciseness (< 80 words with direct answer)
    const firstParaWords = firstParagraph.split(/\s+/).length;
    const hasConcisSummary = firstParaWords <= 80 && hasDefinitionSentence;

    // Readability heuristic: avg sentence length
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const avgSentLen = sentences.length > 0
        ? sentences.reduce((a, s) => a + s.split(/\s+/).length, 0) / sentences.length
        : 25;
    const readabilityOk = avgSentLen <= 22;

    const signals = {
        hasFaqSchema,
        hasHowToSchema,
        hasDefinitionSentence,
        hasOrderedList,
        hasStatistic,
        readabilityOk,
        hasConcisSummary,
    };

    let signalScore = 0;
    if (hasFaqSchema)          signalScore += 20;
    if (hasHowToSchema)        signalScore += 15;
    if (hasDefinitionSentence) signalScore += 15;
    if (hasOrderedList)        signalScore += 10;
    if (hasStatistic)          signalScore += 10;
    if (readabilityOk)         signalScore += 15;
    if (hasConcisSummary)      signalScore += 15;

    let hasOverview = false;
    let brandMentioned = false;

    if (process.env.SERPAPI_KEY) {
        try {
            const res = await fetch(
                `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${process.env.SERPAPI_KEY}&engine=google`,
                { signal: AbortSignal.timeout(15000) }
            );
            if (res.ok) {
                const data = await res.json();
                const aiOverview = data.ai_overview;
                if (aiOverview) {
                    hasOverview = true;
                    brandMentioned = JSON.stringify(aiOverview).toLowerCase().includes(domain.toLowerCase());
                    // Boost score if actually in AI Overview
                    signalScore = brandMentioned ? Math.min(100, signalScore + 30) : Math.min(100, signalScore + 10);
                }
            }
         
         
        } catch (err: unknown) {
        logger.warn('[GoogleAIO] SerpAPI check failed:', { error: (err as Error)?.message || String(err) });
        }
    }

    // Build actionable recommendation
    const weakSignals: string[] = [];
    if (!hasFaqSchema && !hasHowToSchema) weakSignals.push('Add FAQPage or HowTo JSON-LD schema');
    if (!hasDefinitionSentence) weakSignals.push('Open with a concise definition sentence (e.g. "X is a...")');
    if (!hasOrderedList) weakSignals.push('Include numbered steps or lists for step-by-step content');
    if (!readabilityOk) weakSignals.push('Shorten sentences (target ≤22 words average)');
    if (!hasConcisSummary) weakSignals.push('Write a direct 50–80 word summary in the first paragraph');

    const recommendation = weakSignals.length === 0
        ? 'This page has strong Google AI Overview eligibility signals.'
        : `To improve AI Overview eligibility: ${weakSignals.join('; ')}.`;

    return {
        hasOverview,
        brandMentioned,
        score: Math.min(100, signalScore),
        eligibilitySignals: signals,
        recommendation,
    };
}
