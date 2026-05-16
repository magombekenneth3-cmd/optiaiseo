"use server";

import { requireTiers, guardErrorToResult } from "@/lib/stripe/guards";
import { consumeCredits } from "@/lib/credits";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import { extractSiteContext } from "@/lib/blog/context";
import { getAiClient, buildBlogResponseSchema, GeminiBlogResponse, buildPost } from "@/lib/blog";
import { buildPromptContext } from "@/lib/blog/prompt-context";
import { fetchGSCDecayData, normaliseSiteUrl } from "@/lib/gsc";
import { revalidatePath } from "next/cache";
import { getUserGscToken } from "@/lib/gsc/token";
import { AI_MODELS } from "@/lib/constants/ai-models";
import * as cheerio from "cheerio";
import { classifySerpFormat, computeContentGaps, formatToPromptHint, getSerpContextForKeyword } from "@/lib/blog/serp";

// Helpers

async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 2,
    delayMs = 1000
): Promise<Response> {
    try {
        return await fetch(url, options);
    } catch (err) {
        if (retries === 0) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
        return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
}

type Intent = "informational" | "transactional" | "commercial" | "navigational";

function detectIntent(keyword: string): Intent {
    const kw = keyword.toLowerCase();
    if (/\b(buy|order|shop|purchase|discount|coupon|deal|price|pricing)\b/.test(kw)) return "transactional";
    if (/\b(best|top|review|vs\.?|versus|alternative|compare|comparison)\b/.test(kw)) return "commercial";
    if (/\b(how to|what is|why|guide|tutorial|tips|learn|explained)\b/.test(kw)) return "informational";
    return "informational";
}

/**
 * Extracts structured content from HTML, preferring semantic containers.
 * Returns a capped list of markdown-like lines rather than a raw char slice,
 * so the model always receives complete sections.
 */
function extractStructuredContent(html: string, maxSections = 50): string {
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, form, iframe, " +
        ".cookie-banner, .ad, .advertisement, [aria-hidden='true'], " +
        ".popup, .modal, .sidebar").remove();

    // Prefer semantic content containers; fall back to body
    const root = $("article, main, [role='main'], .post-content, .entry-content, #content, .content").first();
    const scope = root.length ? root : $("body");

    const lines: string[] = [];

    scope.find("h1, h2, h3, p, li").each((_, el) => {
        if (lines.length >= maxSections) return false; // break

        const tag = el.tagName.toLowerCase();
        const text = $(el).text().trim().replace(/\s+/g, " ");
        if (!text || text.length < 5) return;

        if (tag === "h1") lines.push(`# ${text}`);
        else if (tag === "h2") lines.push(`## ${text}`);
        else if (tag === "h3") lines.push(`### ${text}`);
        else lines.push(text);
    });

    return lines.join("\n");
}

// Actions

export async function getDecayingContent(siteId: string) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
        if (!site) return { success: false, error: "Site not found" };

        const normalisedUrl = normaliseSiteUrl(site.domain);
        const accessToken = await getUserGscToken(user.id);
        const decayData = await fetchGSCDecayData(accessToken, normalisedUrl);

        return { success: true, data: decayData };
    } catch (error: unknown) {
        logger.error("Error fetching decaying content:", { error: (error as Error)?.message ?? String(error) });
        return { success: false, error: (error as Error).message ?? "Failed to fetch decaying content." };
    }
}

export async function refreshDecayingContent(
    siteId: string,
    url: string,
    keywords: string[] = []
) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        try {
            await requireTiers(user.id, ["STARTER", "PRO", "AGENCY"]);
        } catch (err) {
            return guardErrorToResult(err);
        }

        const creditResult = await consumeCredits(user.id, "blog_generation");
        if (!creditResult.allowed) {
            return {
                success: false,
                error: creditResult.reason === "credits_locked"
                    ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                    : `Not enough credits (${creditResult.remaining} remaining, need 10). Buy a credit pack or upgrade your plan.`,
            };
        }

        const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
        if (!site) return { success: false, error: "Site not found" };


        const pageRes = await fetchWithRetry(url, {
            headers: { "User-Agent": "SEOTool-Bot/1.0" },
            signal: AbortSignal.timeout(10_000),
        });
        if (!pageRes.ok) return { success: false, error: `Failed to scrape URL: ${pageRes.status}` };

        const html = await pageRes.text();
        const extractedText = extractStructuredContent(html, 50);


        const primaryKeyword = keywords[0] ?? "content refresh";

        const serpContext = await getSerpContextForKeyword(primaryKeyword, true);

        const formatSignal = serpContext
            ? classifySerpFormat(serpContext.results)
            : null;

        const formatHint = formatSignal
            ? formatToPromptHint(formatSignal, primaryKeyword)
            : "";


        const gaps = serpContext
            ? computeContentGaps(serpContext.results)
            : { commonTopics: [], gapTopics: [] };


        const intent = detectIntent(primaryKeyword);


        const ai = getAiClient();
        if (!ai) return { success: false, error: "Gemini AI is not configured." };

        await extractSiteContext(site.domain);

        const ctx = buildPromptContext({
            keyword: primaryKeyword,
            category: primaryKeyword,
            intent,
            hasAuthorGrounding: false,
            siteDomain: site.domain,
        });


        const gapSection = (gaps.commonTopics.length > 0 || gaps.gapTopics.length > 0)
            ? `CONTENT GAP ANALYSIS:
- Table-stakes topics (every competitor covers these — you must too): ${gaps.commonTopics.join(", ") || "none identified"}
- Underserved gap topics (differentiate by going deeper here): ${gaps.gapTopics.join(", ") || "none identified"}`
            : "";

        const serpSection = serpContext
            ? serpContext.formattedContext
            : "No live SERP data available. Rely on your training knowledge for competitor context.";

        const prompt = `You are an elite SEO Content Strategist. Your task is to rescue a piece of "Decaying Content" — a blog post rapidly losing Google traffic — and rewrite it to rank #1 in 2026.

ORIGINAL URL: ${url}
TARGET KEYWORDS: ${keywords.join(", ")}
DETECTED INTENT: ${intent}

━━━ ORIGINAL CONTENT ━━━
${extractedText}

━━━ LIVE SERP INTELLIGENCE ━━━
${serpSection}

${gapSection}

${formatHint}

━━━ REWRITE INSTRUCTIONS ━━━
Your rewrite must be objectively better than every page currently ranking. Apply these rules without exception:

1. FRESHNESS: Update the post explicitly for 2026. Modernise any outdated concepts, statistics, or tool references.
2. FEATURED SNIPPET TRAP: Write a punchy 40–60 word direct answer immediately after the H1, structured to win the featured snippet.
3. COVER ALL TABLE-STAKES TOPICS: Every topic in the "common topics" list above must appear in your rewrite.
4. EXPLOIT GAPS: Go substantially deeper on "gap topics" — this is where you beat competitors.
5. ANSWER PAA QUESTIONS: Every "People Also Ask" question from the SERP data must be answered, either inline or in the FAQ.
6. INTENT-MATCHED TONE: Intent is "${intent}". Adjust tone, CTAs, and structure accordingly.
7. SKIMMABILITY: Use H2s, H3s, bullet points, and short paragraphs. No wall-of-text sections.
8. ZERO FLUFF: Cut any sentence that doesn't add information or move the reader forward.

STRICT STRUCTURAL REQUIREMENTS:
- Exactly one H1
- At least 5 H2 sections
- At least 3 H3 subsections
- One comparison or summary table if the topic involves tools, products, or options
- An FAQ section with 3–5 questions drawn from PAA data
- Each section must add information not present in the original content

Generate the fully modernised, refreshed version of this post now.`;


        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_FLASH,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: buildBlogResponseSchema(ctx),
                temperature: 0.7,
            },
        });

        if (!response.text) return { success: false, error: "AI returned empty content." };

        const parsedResponse = JSON.parse(response.text) as GeminiBlogResponse;

        // Prepend a refresh notice so editors know this is an AI-refreshed draft
        parsedResponse.content = `> **2026 Content Refresh:** This guide has been completely updated and structurally modernised for current SEO best practices.\n\n${parsedResponse.content}`;

        const draft = await buildPost(parsedResponse, { name: site.domain }, ctx, site.id);


        const blog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType: "CONTENT_REFRESH",
                sourceUrl: url,
                title: `[REFRESH] ${draft.title}`,
                slug: draft.slug,
                targetKeywords: keywords.length > 0 ? keywords : draft.targetKeywords,
                content: draft.content,
                metaDescription: draft.metaDescription,
                status: "DRAFT",
            },
        });

        revalidatePath("/dashboard/refresh");
        revalidatePath("/dashboard/blogs");

        return { success: true, blog };
    } catch (error: unknown) {
        logger.error("Error refreshing content:", { error: (error as Error)?.message ?? String(error) });
        return { success: false, error: (error as Error).message ?? "Failed to refresh content via AI." };
    }
}