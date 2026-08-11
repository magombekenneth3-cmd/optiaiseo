import { probeLlmCitation } from "../llm-citation-probe";
import { fetchGscEvidence } from "@/lib/opportunity-engine/evidence";
import { logger } from "@/lib/logger";

export interface CombinedSerpAeoOverview {
    siteId: string;
    keyword: string;
    targetUrl: string;
    googleRank: number;
    impressions: number;
    clicks: number;
    aiVisibility: {
        chatgptCited: boolean;
        perplexityCited: boolean;
        claudeCited: boolean;
        geminiCited: boolean;
    };
    aeoConsensusScore: number; // 0-100 scale
    aeoOpportunityRecommendation: string;
}

export async function getCombinedAeoSeoOverview(
    siteId: string,
    keyword: string,
    targetUrl: string
): Promise<CombinedSerpAeoOverview> {
    try {
        // 1. Fetch Google Organic Ranks & Impressions from GSC Evidence Provider
        const gscMetrics = await fetchGscEvidence(siteId);
        const cleanTarget = targetUrl.split("?")[0].replace(/\/$/, "");
        
        const matchedMetric = gscMetrics.find(m => m.url === cleanTarget || m.url.includes(cleanTarget));

        const googleRank = matchedMetric?.position ?? 0;
        const impressions = matchedMetric?.impressions ?? 0;
        const clicks = matchedMetric?.clicks ?? 0;

        // 2. Probe AI Visibility across LLMs (SearchGPT, Perplexity, Gemini, Claude)
        let chatgptCited = false;
        let perplexityCited = false;
        let claudeCited = false;
        let geminiCited = false;

        try {
            const probe = await probeLlmCitation(
                targetUrl,
                keyword,
                `Overview of ${keyword} performance`,
                `Detailed analysis of ${keyword} content and authority signals.`,
                "Article, BlogPosting, FAQPage"
            );

            geminiCited = (probe.geminiScore ?? 0) >= 3;
            perplexityCited = (probe.perplexityScore ?? 0) >= 3;
            chatgptCited = (probe.chatGptScore ?? 0) >= 3;
            claudeCited = probe.score >= 3;
        } catch {
            // Fallback for probe error
        }

        // 3. Compute AEO Consensus Score (% of 4 models citing target URL)
        const totalCited = [chatgptCited, perplexityCited, claudeCited, geminiCited].filter(Boolean).length;
        const aeoConsensusScore = Math.round((totalCited / 4) * 100);

        // 4. Generate Actionable Recommendation
        let recommendation = "Strong visibility across both Google Organic and AI search engines.";
        if (googleRank >= 1 && googleRank <= 5 && aeoConsensusScore < 50) {
            recommendation = `Ranks #${googleRank.toFixed(1)} on Google, but missing in ${4 - totalCited} AI models. Inject FAQ schema and conversational H2 headings to capture AI Overviews.`;
        } else if (googleRank > 10 && aeoConsensusScore >= 50) {
            recommendation = "High citation rate in AI Overviews, but page 2 on Google. Build 2 internal links to lift organic ranking into the top 5.";
        } else if (googleRank === 0 && aeoConsensusScore === 0) {
            recommendation = "No ranking or AI citations detected. Perform complete content refresh and add structured Article schema.";
        }

        return {
            siteId,
            keyword,
            targetUrl,
            googleRank,
            impressions,
            clicks,
            aiVisibility: {
                chatgptCited,
                perplexityCited,
                claudeCited,
                geminiCited,
            },
            aeoConsensusScore,
            aeoOpportunityRecommendation: recommendation,
        };
    } catch (err: unknown) {
        logger.error("[AeoTracker] Failed to compute combined AEO + SEO overview", { siteId, keyword, error: (err as Error)?.message || String(err) });
        return {
            siteId,
            keyword,
            targetUrl,
            googleRank: 0,
            impressions: 0,
            clicks: 0,
            aiVisibility: { chatgptCited: false, perplexityCited: false, claudeCited: false, geminiCited: false },
            aeoConsensusScore: 0,
            aeoOpportunityRecommendation: "Unable to retrieve metrics.",
        };
    }
}
