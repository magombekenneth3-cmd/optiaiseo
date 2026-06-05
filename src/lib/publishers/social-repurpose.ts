/**
 * src/lib/publishers/social-repurpose.ts
 *
 * RSS → Social Media Repurposing Pipeline
 * Reads published blog posts from an RSS feed and generates
 * platform-specific social media posts for each article.
 */

import { logger } from "@/lib/logger";

export type SocialPlatform = "linkedin" | "twitter" | "facebook" | "instagram";

export interface SocialPost {
    platform: SocialPlatform;
    content: string;
    imagePrompt?: string;
    articleUrl: string;
    articleTitle: string;
}

export interface RssItem {
    title?: string;
    link?: string;
    contentSnippet?: string;
}

export interface RepurposeResult {
    articleUrl: string;
    articleTitle: string;
    posts: SocialPost[];
    error?: string;
}

/**
 * Generates social media posts from RSS feed items using the Anthropic API.
 * Caller is responsible for passing a valid rssFeedUrl and brandName.
 */
export async function repurposeRssToSocial(
    items: RssItem[],
    brandName: string,
    maxItems = 5
): Promise<RepurposeResult[]> {
    const results: RepurposeResult[] = [];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        logger.error("[social-repurpose] ANTHROPIC_API_KEY is not set");
        return results;
    }

    for (const item of items.slice(0, maxItems)) {
        if (!item.title || !item.link) continue;

        const prompt = `You are a social media strategist repurposing blog content for a local business.

ARTICLE TITLE: ${item.title}
ARTICLE URL: ${item.link}
BRAND: ${brandName}
ARTICLE SUMMARY: ${item.contentSnippet?.slice(0, 500) || ""}

Generate 4 social posts, one per platform. Each must:
- Use the article's key insight as the hook
- Be platform-appropriate in length and tone
- Include the article URL naturally
- NOT use generic phrases like "Check out our blog" or "Read more"

LinkedIn: professional tone, 150–200 words, add 3 relevant hashtags
Twitter: punchy, under 240 chars including URL, 1–2 hashtags
Facebook: conversational, 100–150 words, question or CTA at end
Instagram: benefit-led caption, 80–120 words, 5 relevant hashtags

Return ONLY a valid JSON array — no markdown fences, no explanation:
[
  { "platform": "linkedin", "content": "...", "imagePrompt": "descriptive image prompt for this post" },
  { "platform": "twitter", "content": "...", "imagePrompt": "..." },
  { "platform": "facebook", "content": "...", "imagePrompt": "..." },
  { "platform": "instagram", "content": "...", "imagePrompt": "..." }
]`;

        try {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 1500,
                    messages: [{ role: "user", content: prompt }],
                }),
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                logger.warn("[social-repurpose] API call failed", {
                    status: response.status,
                    article: item.link,
                });
                results.push({
                    articleUrl: item.link,
                    articleTitle: item.title,
                    posts: [],
                    error: `API error ${response.status}`,
                });
                continue;
            }

            const data = await response.json() as {
                content: Array<{ type: string; text?: string }>;
            };

            const text = data.content
                .filter((b) => b.type === "text")
                .map((b) => b.text || "")
                .join("");

            const clean = text.replace(/```json|```/g, "").trim();
            const parsed = JSON.parse(clean) as Array<{
                platform: SocialPlatform;
                content: string;
                imagePrompt?: string;
            }>;

            results.push({
                articleUrl: item.link,
                articleTitle: item.title,
                posts: parsed.map((p) => ({
                    ...p,
                    articleUrl: item.link!,
                    articleTitle: item.title!,
                })),
            });
        } catch (err) {
            logger.warn("[social-repurpose] Failed to process article", {
                article: item.link,
                error: String(err),
            });
            results.push({
                articleUrl: item.link,
                articleTitle: item.title,
                posts: [],
                error: String(err),
            });
        }
    }

    return results;
}
