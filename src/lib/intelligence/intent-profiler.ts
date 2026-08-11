import { SerpContext } from "@/lib/blog/serp";
import { SerpConsensus, OpportunityIntelligence } from "@/lib/opportunity-engine/types";
import { classifyIntent } from "@/lib/gsc";

export function analyzeSerpConsensus(
    keyword: string,
    serpContext?: SerpContext | null
): OpportunityIntelligence {
    const rawIntent = classifyIntent(keyword);
    let commercialValueScore = 50;

    if (rawIntent === "commercial") commercialValueScore = 90;
    else if (rawIntent === "transactional") commercialValueScore = 95;
    else if (rawIntent === "informational") commercialValueScore = 60;
    else commercialValueScore = 40;

    if (!serpContext || !serpContext.results || serpContext.results.length === 0) {
        return {
            keyword,
            intentAlignment: 80,
            commercialValueScore,
        };
    }

    let comparison = 0;
    let product = 0;
    let tool = 0;
    let explainer = 0;

    const evidence: SerpConsensus["evidence"] = [];

    for (const res of serpContext.results.slice(0, 10)) {
        const text = `${res.title} ${res.snippet}`.toLowerCase();
        let type: "COMPARISON_PAGE" | "PRODUCT_PAGE" | "INTERACTIVE_TOOL" | "DEEP_EXPLAINER" = "DEEP_EXPLAINER";

        if (/\b(vs|versus|best|top|review|comparison|alternatives)\b/.test(text)) {
            comparison++;
            type = "COMPARISON_PAGE";
        } else if (/\b(calculator|quiz|tool|generator|checker)\b/.test(text)) {
            tool++;
            type = "INTERACTIVE_TOOL";
        } else if (/\b(buy|shop|pricing|cart|store)\b/.test(text)) {
            product++;
            type = "PRODUCT_PAGE";
        } else {
            explainer++;
        }

        evidence.push({
            url: res.link,
            type,
            reason: res.title
        });

    }

    const total = serpContext.results.slice(0, 10).length;
    const distribution = {
        comparison: Math.round((comparison / total) * 100),
        product: Math.round((product / total) * 100),
        tool: Math.round((tool / total) * 100),
        explainer: Math.round((explainer / total) * 100),
    };

    let dominantType: SerpConsensus["dominantType"] = "DEEP_EXPLAINER";
    let maxCount = explainer;

    if (comparison > maxCount) { dominantType = "COMPARISON_PAGE"; maxCount = comparison; }
    if (tool > maxCount) { dominantType = "INTERACTIVE_TOOL"; maxCount = tool; }
    if (product > maxCount) { dominantType = "PRODUCT_PAGE"; maxCount = product; }

    const confidence = Math.round((maxCount / total) * 100);

    const serpConsensus: SerpConsensus = {
        dominantType,
        confidence,
        distribution,
        depth: {
            required: total > 5 && (explainer > 3 || comparison > 3) ? "DEEP" : "MEDIUM"
        },
        evidence
    };

    return {
        keyword,
        serpConsensus,
        intentAlignment: Math.min(100, Math.max(50, confidence)),
        commercialValueScore
    };
}
