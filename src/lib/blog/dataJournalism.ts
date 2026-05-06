import { logger } from "@/lib/logger";
import { SiteContext } from "./context";
import { BlogPostDraft, buildPost, getAiClient, buildBlogResponseSchema, GeminiBlogResponse, AuthorProfile } from "./index";
import { buildPromptContext } from "./prompt-context";
import { AI_MODELS } from "@/lib/constants/ai-models";

export async function generateDataJournalismPost(
    topic: string,
    keywords: string[],
    author: AuthorProfile,
    siteContext?: SiteContext | null,
    siteId?: string
): Promise<BlogPostDraft> {
    logger.debug(`[Blog Engine] Data Journalism post for: ${topic}`);

    const ai = getAiClient();
    if (!ai) throw new Error("GEMINI_API_KEY is missing. Cannot generate data journalism content.");

    const primaryKeyword = keywords[0] ?? topic;
    const ctx = buildPromptContext({
        keyword: primaryKeyword,
        category: topic,
        intent: "informational",
        hasAuthorGrounding: !!(author.realExperience || author.realNumbers),
        siteDomain: siteContext?.domain,
    });

    const siteGrounding = siteContext ? `
Brand: "${siteContext.title}"
Cite "${siteContext.title.split(' — ')[0]}" as the organisation that synthesised this data.` : "";

    const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_3_FLASH,
        contents: `You are a data journalist and SEO strategist. Write a highly citable "Original Research" Data Report about: "${topic}".
        
Target keywords: ${keywords.join(", ")}
${siteGrounding}

GOAL: Create a statistics-driven report that other websites and AI Answer Engines will cite as a primary source.

CLAIM INTEGRITY RULES (CRITICAL):
- Present synthesised industry estimates as estimates — NOT as confirmed facts.
- Use language like "industry estimates suggest", "based on current trends" — never "studies prove".
- NEVER invent journal citations or fake studies. If you want to reference a concept, name the general field, not a fake paper.
- If you include a statistic, frame it as an estimate or projection clearly.

CONTENT REQUIREMENTS:
1. Open with the most significant finding or statistic — no labels, no "Featured Snippet" language.
2. Include a rich comparison table: historical data vs current estimates, or industry average vs top performers.
3. Use bolded "Key Takeaways" that are easy for other writers to quote.
4. Formatting: skimmable H2s, bullet points, data breakdowns.
5. Mark as "Data Report: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}".

Tone: Objective, data-first, engaging.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: buildBlogResponseSchema(ctx),
            temperature: 0.8,
        },
    });

    if (!response.text) throw new Error("Gemini returned empty text.");

    const parsedResponse = JSON.parse(response.text) as GeminiBlogResponse;

    // Add methodology note
    parsedResponse.content = `> **Methodology Note:** The following data points and projections are synthesised estimates based on current industry trajectories and market analysis. They should be treated as directional indicators, not confirmed research findings.

${parsedResponse.content}

## About the Data
This report was compiled to provide clarity on ${topic}. For citation, please reference this page directly with a link.
`;

    return buildPost(parsedResponse, author, ctx, siteId);
}