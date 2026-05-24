/**
 * src/lib/serp-gap/arvow-prompt.ts
 *
 * Converts a GapReport into a fully populated Arvow customPrompt.
 * Eliminates manual [PLACEHOLDER] filling in the Arvow API workflow.
 */

import type { GapReport } from "./analyser";

export interface ArvowArticlePayload {
    keyword: string;
    title: string;
    customPrompt: string;
    size: "sm" | "md" | "lg" | "xl";
    structure: Array<{ h2: string; h3s: string[] }>;
    includeKeywords: string[];
    context: string;
}

/**
 * Derives article size from the gap report's SERP format.
 * Pillar/guide = xl, how-to/comparison = lg, explainer/local = md
 */
function deriveSize(report: GapReport): "sm" | "md" | "lg" | "xl" {
    const format = report.serpFormat;
    if (format === "guide")      return "xl";
    if (format === "comparison") return "lg";
    if (format === "listicle")   return "lg";
    if (format === "tool")       return "md";
    if (format === "product")    return "md";
    return "lg";
}

/**
 * Builds an H2 structure from the competitor topic map.
 * Max 12 H2s (Arvow hard limit). Each H2 gets 1–3 H3s inferred from the topic.
 */
function buildStructure(report: GapReport): Array<{ h2: string; h3s: string[] }> {
    const topics = report.competitorTopicMap.slice(0, 10);
    return topics.map((t) => ({
        h2: t.topic,
        // Generate generic H3s if we don't have richer data.
        // Replace with real competitor H3s if you scrape them.
        h3s: [
            `What is ${t.topic.toLowerCase()}?`,
            `How to use ${t.topic.toLowerCase()}`,
            `Best practices for ${t.topic.toLowerCase()}`,
        ].slice(0, 3),
    }));
}

/**
 * Main export: converts a GapReport + business description
 * into a fully populated ArvowArticlePayload.
 *
 * Usage:
 *   const payload = buildArvowPayload(report, "OptiAISEO, an AI-powered SEO audit platform for SaaS teams");
 *   // Pass payload fields into your Arvow POST /api/v0.1/batch body
 */
export function buildArvowPayload(
    report: GapReport,
    businessDesc: string,
    titleOverride?: string
): ArvowArticlePayload {
    // Split competitor topics by coverage frequency
    const allOk     = report.topResults.filter((r) => r.fetchedOk).length;
    const common    = report.competitorTopicMap
        .filter((t) => t.mentionCount >= Math.ceil(allOk * 0.6))
        .map((t) => t.topic);
    const emerging  = report.competitorTopicMap
        .filter((t) => t.mentionCount === 1 || t.mentionCount === 2)
        .map((t) => t.topic);
    const gaps      = report.gaps
        .filter((g) => g.gap === "critical" || g.gap === "high")
        .map((g) => g.dimension);

    const customPrompt = [
        `This article targets the keyword "${report.keyword}" for ${businessDesc}.`,
        "",
        `COMPETITIVE INTELLIGENCE — from analysing the top ${report.topResults.length} Google results:`,
        `- All top results cover: ${common.join(", ") || "general introductory content on this topic"}`,
        `- Only 1–2 results cover: ${emerging.join(", ") || "none identified as emerging"}`,
        `- Gaps no competitor covers well: ${gaps.join(", ") || "none — focus on depth"}`,
        "",
        "STRATEGIC INSTRUCTIONS:",
        "- Cover all common topics listed above to match competitor depth — use specific examples and actionable steps.",
        emerging.length
            ? `- The sections about "${emerging.slice(0, 3).join('", "')}" give us an advantage over most competitors who skip these — write these with strong detail.`
            : "",
        gaps.length
            ? `- The gap sections ("${gaps.slice(0, 3).join('", "')}") are our biggest differentiator. No competing article covers this well. Write these sections with exceptional depth, real examples, and practical advice.`
            : "",
        `- Client URL for internal linking reference: ${report.clientUrl}`,
        `- Current client ranking position: ${report.clientPosition} — this article should be demonstrably superior to the content currently at positions 1–5.`,
        `- SERP format: ${report.serpFormat}${report.serpHasFeaturedSnippet ? " — there is a featured snippet; open with a direct 40-word answer to the query to compete for it." : ""}`,
        report.serpHasPaa
            ? "- There are People Also Ask boxes for this keyword — address each implied PAA question with a dedicated H2 or H3."
            : "",
    ]
        .filter(Boolean)
        .join("\n");

    const includeKeywords = [
        report.keyword,
        ...report.competitorTopicMap.slice(0, 5).map((t) => t.topic),
    ];

    return {
        keyword:        report.keyword,
        title:          titleOverride ?? `The Complete Guide to ${report.keyword}`,
        customPrompt,
        size:           deriveSize(report),
        structure:      buildStructure(report),
        includeKeywords,
        context:        businessDesc,
    };
}
