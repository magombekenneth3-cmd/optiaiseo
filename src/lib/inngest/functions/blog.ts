import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import {
    generateEvergreenPost,
    generateBlogFromCompetitorGap,
    AuthorProfile,
} from "@/lib/blog";
import { checkBlogLimit } from "@/lib/rate-limit";
import { extractSiteContext } from "@/lib/blog/context";
import { fetchGSCKeywords, findOpportunities, normaliseSiteUrl } from "@/lib/gsc";
import { callGemini, callGeminiJson } from "@/lib/gemini/client";
import { getFunnelForIntent, SearchIntent as FunnelIntent } from "@/lib/aeo/funnels";
import { detectRiskTier, detectIntent, cleanDomainToDisplayName } from "@/lib/blog/prompt-context";
import { gateCitationScore } from "@/lib/blog/ai-citation-template";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { getSerpContextForKeyword, type SerpContext } from "@/lib/blog/serp";

function buildAuthorFromSite(site: {
    id: string;
    domain: string;
    authorName?: string | null;
    authorRole?: string | null;
    authorBio?: string | null;
    realExperience?: string | null;
    realNumbers?: string | null;
    localContext?: string | null;
    user?: { name?: string | null } | null;
}): AuthorProfile {
    const name = site.authorName || site.user?.name;
    if (!name) {
        throw new NonRetriableError(
            `[Blog] Site ${site.id} (${site.domain}) is missing an author name. ` +
            "Set an author name in Site Settings → Author Profile before generating content."
        );
    }
    return {
        name,
        role: site.authorRole || undefined,
        bio: site.authorBio || undefined,
        realExperience: site.realExperience || undefined,
        realNumbers: site.realNumbers || undefined,
        localContext: site.localContext || undefined,
    };
}

async function runFactCheckValidation(content: string): Promise<{
    qualityScore: number | null;
    issues: string[];
    suggestions: string[];
}> {
    const CHUNK_SIZE = 6000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        chunks.push(content.slice(i, i + CHUNK_SIZE));
    }

    const results = await Promise.all(
        chunks.map((chunk, idx) =>
            callGeminiJson<{ qualityScore: number; issues: string[]; suggestions: string[] }>(
                `You are a fact-checking editor. Review this article excerpt (chunk ${idx + 1}/${chunks.length}) and:
1. Identify vague claims with no supporting data
2. Identify statistics that appear fabricated or unverifiable
3. Suggest specific real statistics with named sources to replace flagged claims
4. Return JSON: { "issues": [...strings], "suggestions": [...strings], "qualityScore": 0-100 }

SCORING GUIDE:
- Start at 100
- Deduct 15 for each fabricated or unsourced statistic
- Deduct 10 for each vague claim presented as fact
- Deduct 5 for each banned filler phrase that survived
- Score below 60 = hold for review; below 40 = reject

Only output valid JSON, nothing else.

Article excerpt:
${chunk}`,
                { maxOutputTokens: 2048, temperature: 0.2, timeoutMs: 60000 }
            ).catch((): null => {
                logger.warn(`[Blog/FactCheck] Chunk ${idx + 1} timed out — excluded from quality score`);
                return null;
            })
        )
    );

    const validResults = results.filter(
        (r): r is { qualityScore: number; issues: string[]; suggestions: string[] } => r !== null
    );
    const allIssues = validResults.flatMap(r => r.issues ?? []);
    const allSuggestions = validResults.flatMap(r => r.suggestions ?? []);
    const qualityScore: number | null = validResults.length > 0
        ? Math.round(validResults.reduce((sum, r) => sum + (r.qualityScore ?? 100), 0) / validResults.length)
        : null;

    return { qualityScore, issues: allIssues, suggestions: allSuggestions };
}

async function runSemanticEnrichmentCheck(
    keyword: string,
    content: string
): Promise<{ missingEntities: string[]; enrichmentScore: number }> {
    try {
        const parsed = await callGeminiJson<{
            expectedEntities: string[];
            missingEntities: string[];
            enrichmentScore: number;
        }>(
            `You are an SEO content strategist. For a top-ranking article on "${keyword}", identify:
1. The 12 most important related entities, concepts, and LSI terms Google's NLP expects to find
2. Which of those are absent or mentioned fewer than twice in the article below
3. An enrichment score (0–100): 100 = all entities present, deduct 8 per missing high-importance entity

Return JSON only: { "expectedEntities": [...], "missingEntities": [...], "enrichmentScore": 0-100 }

Article (first 10000 chars):
${content.substring(0, 10000)}`,
            { maxOutputTokens: 1024, temperature: 0.1, timeoutMs: 45000 }
        );
        return {
            missingEntities: parsed.missingEntities ?? [],
            enrichmentScore: parsed.enrichmentScore ?? 70,
        };
    } catch {
        return { missingEntities: [], enrichmentScore: 70 };
    }
}

async function generateInteractiveWidget(keyword: string, content: string): Promise<string | null> {
    try {
        const text = await callGemini(
            `Based on this article about "${keyword}", generate ONE interactive element:
- A calculator if the topic involves numbers, costs, or measurements
- A 5-question quiz if the topic involves preferences or recommendations
- An interactive checklist if the topic involves steps or decisions

Rules:
- Output pure HTML and vanilla JavaScript only. No external dependencies.
- Self-contained in a single div with id="blog-interactive-widget"
- Mobile responsive using inline styles only
- Maximum 60 lines of code
- Clean card style (white background, subtle shadow, border-radius: 12px)

Article excerpt:
${content.substring(0, 3000)}

Return ONLY the HTML. Start with <div id="blog-interactive-widget"`,
            { maxOutputTokens: 4096, temperature: 0.3, timeoutMs: 45000 }
        );
        const match = text.match(/<div[\s\S]*id=["']blog-interactive-widget["'][\s\S]*$/i);
        return match ? match[0].replace(/```\s*$/g, "").trim() : text.trim();
    } catch (e: unknown) {
        logger.warn("[Blog/Widget] Widget generation failed:", { error: (e as Error)?.message });
        return null;
    }
}

async function generateSchemaMarkup(params: {
    title: string;
    keyword: string;
    content: string;
    slug: string;
    siteDomain: string;
}): Promise<string | null> {
    try {
        const text = await callGemini(
            `Generate JSON-LD schema markup for this article. Include:
1. Article schema (headline, author, datePublished, dateModified, publisher)
2. FAQPage schema — extract 4-5 real questions and answers from the content
3. BreadcrumbList schema

Article Info:
- Title: ${params.title}
- Keyword: ${params.keyword}
- Domain: ${params.siteDomain}
- Slug: ${params.slug}
- Published: ${new Date().toISOString()}

Article excerpt:
${params.content.substring(0, 4000)}

Return ONLY the JSON-LD script tags. No other text.`,
            { maxOutputTokens: 4096, temperature: 0.1, timeoutMs: 45000 }
        );
        const scripts = text.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi);
        if (!scripts || scripts.length === 0) return null;
        const firstJson = scripts[0]
            .replace(/<script type="application\/ld\+json">/, "")
            .replace(/<\/script>/, "")
            .trim();
        JSON.parse(firstJson);
        return scripts.join("\n");
    } catch (e: unknown) {
        logger.warn("[Blog/Schema] Schema markup failed:", { error: (e as Error)?.message });
        return null;
    }
}

export const generateBlogJob = inngest.createFunction(
    {
        id: "generate-blog",
        name: "Generate SEO Blog Post",
        concurrency: { limit: 5 },
        rateLimit: {
            limit: 10,
            period: "1m",
            key: "event.data.userId",
        },
        onFailure: async ({ event, error }) => {
            const originalData = event.data?.event?.data ?? {};
            const blogId = (originalData as Record<string, unknown>).blogId as string | undefined;
            const siteId = (originalData as Record<string, unknown>).siteId as string | undefined;
            const userId = (originalData as Record<string, unknown>).userId as string | undefined;
            logger.error(`[Inngest/Blog] Failed for site ${siteId}:`, { error: error?.message || error });
            if (!blogId) {
                logger.error("[Inngest/Blog] No blogId in onFailure — manual DB check required");
                return;
            }
            await prisma.blog.updateMany({ where: { id: blogId }, data: { status: "FAILED" } });
            if (userId) {
                try {
                    await prisma.$executeRaw`
                        UPDATE "User" SET credits = credits + 10
                        WHERE id = ${userId}
                    `;
                    logger.info("[Inngest/Blog] Refunded 10 credits after job failure", { userId, blogId });
                } catch (refundErr) {
                    logger.error("[Inngest/Blog] Failed to refund credits — manual action required", { blogId, userId, error: (refundErr as Error)?.message });
                }
            }
        },
    
        triggers: [{ event: "blog.generate" }],
    },
    async ({ event, step }) => {
        const { siteId, pipelineType, keyword, competitorDomain, searchVolume, difficulty } = event.data;

        if (!process.env.GEMINI_API_KEY) {
            throw new NonRetriableError("Missing GEMINI_API_KEY — dropping job");
        }

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({
                where: { id: siteId },
                select: {
                    id: true,
                    domain: true,
                    userId: true,
                    blogTone: true,
                    authorName: true,
                    authorRole: true,
                    authorBio: true,
                    realExperience: true,
                    realNumbers: true,
                    localContext: true,
                    user: { select: { name: true, email: true, subscriptionTier: true } },
                },
            });
            if (!s) throw new Error("Site not found");
            return s;
        });

        const author = buildAuthorFromSite(site);
        const displayName = cleanDomainToDisplayName(site.domain);

        const allowed = await step.run("check-blog-rate-limit", async () => {
            const result = await checkBlogLimit(
                site.userId,
                (site.user as { subscriptionTier?: string } | null)?.subscriptionTier ?? "FREE"
            );
            return result.allowed;
        });
        if (!allowed) return { skipped: true, reason: "rate_limit" };

        const detectedIntent = detectIntent(keyword ?? "");
        const riskTier = detectRiskTier(keyword ?? "", site.domain, detectedIntent);

        // Runs before generation so the writer knows the competitive landscape.
        // Fires for ALL pipeline types: uses the explicit keyword when provided,
        // falls back to the primary site topic/brand for INDUSTRY & SITE_CONTEXT blogs.
        // Degrades gracefully if Perplexity key is missing.
        const researchBrief = await step.run("perplexity-research", async () => {
            if (!process.env.PERPLEXITY_API_KEY) return null;
            // Use explicit keyword for USER_KEYWORD/SEED_KEYWORD; fall back to site topic
            const researchTopic = keyword || site.domain.replace(/^www\./, "").split(".")[0];
            try {
                const res = await fetch("https://api.perplexity.ai/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: "sonar-pro",
                        messages: [{
                            role: "user",
                            content: `Search for the top ranking pages for "${researchTopic}".

Extract and summarise:
1. The H2 structure / main topics the top 3 results cover
2. Questions they answer in their FAQ sections
3. Obvious gaps — angles they miss, unanswered questions, or outdated information
4. Whether ${site.domain} appears in any of the results

Be specific and concise. This will be used to write a better article.`,
                        }],
                        return_citations: true,
                        return_related_questions: false,
                        temperature: 0.1,
                        max_tokens: 3500,
                    }),
                    signal: AbortSignal.timeout(30000),
                });
                if (!res.ok) {
                    logger.warn(`[Blog/Research] Perplexity returned ${res.status}`);
                    return null;
                }
                const data = await res.json();
                const brief = data.choices?.[0]?.message?.content ?? null;
                const citations: string[] = (data.citations ?? []).map((c: unknown) =>
                    typeof c === "string" ? c : (c as Record<string, string>).url ?? ""
                ).filter(Boolean);
                const domainCited = citations.some(url => url.includes(site.domain.replace(/^www\./, "")));
                logger.info(`[Blog/Research] Research complete for "${researchTopic}" — domain cited in results: ${domainCited}`, { citationCount: citations.length });
                return brief ? `COMPETITIVE RESEARCH for "${researchTopic}":\n${brief}` : null;
            } catch (err: unknown) {
                logger.warn("[Blog/Research] Perplexity research failed — continuing without brief", {
                    error: (err as Error)?.message,
                });
                return null;
            }
        });

        // Pulls brand facts, keyword positions, location and author details
        // so prompts know exactly where/who they're writing for.
        const groundedContext = await step.run("build-blog-context", async () => {
            const { getGroundedContextBlock } = await import("@/lib/prompt-context/build-site-context");
            return getGroundedContextBlock(siteId);
        });

        let liveBlogPost: {
            title: string;
            slug: string;
            targetKeywords: string[];
            content: string;
            metaDescription: string;
            ogImage?: string;
            validationErrors: string[];
            validationWarnings: string[];
            validationScore: number;
        };
        let finalPipelineType = pipelineType;

        if (pipelineType === "COMPETITOR_ATTACK" || pipelineType === "COMPETITOR_GAP") {
            // Pre-fetch SERP once as a dedicated step — same pattern as the evergreen pipeline.
            // This avoids a duplicate Serper call inside generateBlogFromCompetitorGap.
            const competitorSerpContext: SerpContext | null = await step.run("fetch-serp-context-competitor", async () => {
                if (!keyword) return null;
                try {
                    const ctx = await getSerpContextForKeyword(keyword, true);
                    logger.info(`[Blog/SERP] Competitor SERP pre-fetched for "${keyword}" — ${ctx?.results.length ?? 0} results`, { siteId });
                    return ctx;
                } catch (err: unknown) {
                    logger.warn("[Blog/SERP] Competitor SERP pre-fetch failed — generator will fetch internally", {
                        keyword,
                        error: (err as Error)?.message,
                    });
                    return null;
                }
            });

            liveBlogPost = await step.run("generate-competitor-content", async () => {
                const res = await generateBlogFromCompetitorGap(
                    keyword, competitorDomain, searchVolume, difficulty,
                    author, site.domain, undefined, site.blogTone || undefined, siteId, competitorSerpContext
                );
                return { ...res, ogImage: res.heroImage?.url };

            });
        } else {
            const siteContext = await step.run("extract-site-context", async () => {
                return await extractSiteContext(site.domain);
            });

            // Enrich site context with grounded data and research brief
            const enrichedSiteContext = siteContext
                ? {
                    ...siteContext,
                    description: [
                        siteContext.description,
                        groundedContext ? `\n${groundedContext}` : "",
                        researchBrief ? `\n${researchBrief}` : "",
                    ].filter(Boolean).join("\n"),
                }
                : null;

            let category = siteContext?.category ?? site.domain;
            let keywords = siteContext?.keywords ?? [];
            finalPipelineType = siteContext ? "SITE_CONTEXT" : "INDUSTRY";

            // The user typed (or we selected) a specific keyword in Step 0.
            // It arrives as event.data.keyword. We MUST place it at position [0]
            // so generateEvergreenPost uses it as primaryKeyword for the prompt.
            // GSC opportunities are still fetched below for semantic enrichment,
            // but they cannot displace the user's chosen keyword.
            if (keyword && (pipelineType === "USER_KEYWORD" || pipelineType === "SEED_KEYWORD")) {
                category = keyword;
                // Put the chosen keyword first; retain site keywords as semantic support
                keywords = [keyword, ...(siteContext?.keywords ?? []).filter(k => k.toLowerCase() !== keyword.toLowerCase())].slice(0, 15);
                finalPipelineType = pipelineType;
                logger.info(`[Blog/Pipeline] USER_KEYWORD override — primary keyword: "${keyword}"`, { siteId, pipelineType });
            }

            const gscOpp = await step.run("fetch-gsc-opportunities", async () => {
                try {
                    const { getUserGscToken } = await import("@/lib/gsc/token");
                    const accessToken = await getUserGscToken(site.userId);
                    if (accessToken && site.domain) {
                        const siteUrl = normaliseSiteUrl(site.domain);
                        const gscKeywords = await fetchGSCKeywords(accessToken, siteUrl, 28, 100);
                        return findOpportunities(gscKeywords, 5);
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (
                        msg.includes('Cannot find module') ||
                        msg.includes('not connected') ||
                        msg.includes('No GSC token')
                    ) {
                        logger.info('[Blog/GSC] GSC unavailable — continuing without GSC keywords', { siteId: site.id });
                    } else {
                        logger.warn('[Blog/GSC] Unexpected error fetching GSC opportunities', {
                            siteId: site.id,
                            error: msg,
                        });
                    }
                }
                return [];
            });

            // Only let GSC override category/keywords when no explicit keyword was supplied.
            // When the user chose a keyword, GSC data is secondary enrichment only.
            if (!keyword && gscOpp.length > 0) {
                keywords = [...gscOpp.map(o => o.keyword), ...(siteContext?.keywords ?? [])].slice(0, 15);
                category = `${displayName} — GSC Opportunity`;
                finalPipelineType = "GSC_GAP";
            } else if (!keyword && keywords.length === 0) {
                const brand = site.domain.replace(/^www\./, "").split(".")[0];
                category = brand;
                keywords = [brand, "guide", "tips", "how to", "best practices"];
                finalPipelineType = "INDUSTRY";
            } else if (keyword && gscOpp.length > 0) {
                // Enrich the user's keyword list with GSC semantic terms (don't replace position 0)
                const gscTerms = gscOpp.map(o => o.keyword).filter(k => k.toLowerCase() !== keyword.toLowerCase());
                keywords = [keyword, ...gscTerms, ...(siteContext?.keywords ?? []).filter(k => k.toLowerCase() !== keyword.toLowerCase())].slice(0, 15);
            }

            // generateEvergreenPost internally calls getSerpContextForKeyword.
            // By fetching it here as a dedicated step, we:
            //   1. Avoid a duplicate Serper API call inside the generator
            //   2. Get Inngest step-level retry/observability for the SERP fetch
            //   3. Share the same data across both the generator and any future steps
            const primaryKeywordForSerp = keywords[0]; // position [0] is always the target keyword
            const precomputedSerpContext: SerpContext | null = await step.run("fetch-serp-context", async () => {
                if (!primaryKeywordForSerp) return null;
                try {
                    const ctx = await getSerpContextForKeyword(primaryKeywordForSerp, true);
                    logger.info(`[Blog/SERP] Pre-fetched SERP for "${primaryKeywordForSerp}" — ${ctx?.results.length ?? 0} results`, { siteId });
                    return ctx;
                } catch (err: unknown) {
                    logger.warn("[Blog/SERP] SERP pre-fetch failed — generator will skip SERP enrichment", {
                        keyword: primaryKeywordForSerp,
                        error: (err as Error)?.message,
                    });
                    return null;
                }
            });

            liveBlogPost = await step.run("generate-evergreen-post", async () => {
                const res = await generateEvergreenPost(
                    category, keywords, author, enrichedSiteContext,
                    site.blogTone || undefined, siteId, precomputedSerpContext
                );
                return { ...res, ogImage: res.heroImage?.url };
            });
        }

        // Claude Sonnet is significantly better than Gemini at detecting and removing
        // AI writing patterns, adding narrative voice, and enforcing E-E-A-T structure.
        // Degrades gracefully to the existing Gemini humanization if key is absent.
        liveBlogPost = await step.run("claude-editorial-pass", async () => {
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) {
                logger.info("[Blog/Claude] ANTHROPIC_API_KEY not set — skipping editorial pass");
                return liveBlogPost;
            }

            const authorContext = [
                site.authorBio ? `Author bio: ${site.authorBio}` : "",
                site.authorRole ? `Author role: ${site.authorRole}` : "",
                site.realExperience ? `Real experience: ${site.realExperience}` : "",
                site.realNumbers ? `Real data/numbers: ${site.realNumbers}` : "",
            ].filter(Boolean).join("\n");

            try {
                const res = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "x-api-key": anthropicKey,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: AI_MODELS.ANTHROPIC_SONNET,
                        max_tokens: 8192,
                        messages: [{
                            role: "user",
                            content: `You are an expert human editor. Your job is to make this SEO article sound like it was written by a knowledgeable practitioner — not an AI. Apply ALL of the following edits in a single pass:

1. REMOVE AI PATTERNS — rewrite every instance of:
   "In conclusion" / "It's worth noting" / "It's important to note" / "Delve into" / "Dive into" /
   "Navigate" (abstract) / "In today's digital landscape" / "In the ever-changing" /
   "At the end of the day" / "Foster" / "Facilitate" / "In the realm of" / "Unlock" (loosely) /
   "Leverage" (loosely) / "Let's explore" / "Picture this" / "Furthermore" / "Moreover" /
   "Additionally" / "Notably" / "Seamlessly" / "Robust" / "Cutting-edge" / "Game-changing" /
   "Groundbreaking" / "Comprehensive guide" / "Ultimate guide" / "Now more than ever" /
   "As we navigate" / "When it comes to" / "Drive engagement" / "Empower users" /
   "In summary" / "To summarise" / "Final thoughts" / "Wrapping up".

2. FIX WORD REPETITION — highest priority:
   - If any content word (noun, verb, adjective) that is not the primary keyword appears more than 4 times in a 150-word passage, replace occurrence 3+ with a pronoun, synonym, or restructured clause.
   - Never repeat the same subject noun three times in one paragraph. Use "it", "they", or restructure.
   BAD:  "The platform tracks keywords. The platform also monitors backlinks. The platform sends alerts."
   GOOD: "It tracks keywords, monitors backlinks, and sends weekly alerts — in one place."

3. SENTENCE RHYTHM:
   - No three consecutive sentences of the same length (short/medium/long).
   - No two consecutive sentences starting with the same word, especially "The", "This", "It", "You".
   - Mix short punchy statements with longer explanatory ones.

4. ADD CONTRACTIONS — at least one per paragraph:
   "you'll", "it's", "don't", "here's", "we've", "you've", "that's", "there's".

5. ENFORCE E-E-A-T:
   - Named source for every statistic. If no source, remove the number and make the claim qualitative.
   - At least one direct stance per H2 section: a contradiction, a named exception, or a practitioner observation.

6. ADD AUTHOR VOICE: Where the author context below is available, weave in 1–2 natural first-person sentences. Write as normal prose, not as bracketed annotations.

7. STRUCTURE CHECK: If a Quick Answer box is present and its text is >50% similar to the intro paragraph, rewrite the Quick Answer to be more direct and specific.

${authorContext ? `AUTHOR CONTEXT:\n${authorContext}\n` : ""}${groundedContext ? `SITE CONTEXT:\n${groundedContext}\n` : ""}

Return ONLY the edited HTML, starting with the first HTML element. No preamble, no explanation, no markdown fences.

ARTICLE TO EDIT:
${liveBlogPost.content.substring(0, 14000)}`,
                        }],
                    }),
                    signal: AbortSignal.timeout(90000),
                });

                if (!res.ok) {
                    logger.warn(`[Blog/Claude] API returned ${res.status} — skipping editorial pass`);
                    return liveBlogPost;
                }

                const data = await res.json();
                const edited: string = data.content?.[0]?.text ?? "";

                // Only accept if edit returned substantial content (not an error message)
                if (edited && edited.length > liveBlogPost.content.length * 0.4) {
                    logger.info(`[Blog/Claude] Editorial pass complete`, {
                        originalLength: liveBlogPost.content.length,
                        editedLength: edited.length,
                    });
                    return { ...liveBlogPost, content: edited };
                }

                logger.warn("[Blog/Claude] Edited content too short — keeping original");
                return liveBlogPost;

            } catch (err: unknown) {
                logger.warn("[Blog/Claude] Editorial pass failed — keeping original", {
                    error: (err as Error)?.message,
                });
                return liveBlogPost;
            }
        });

        const factCheck = await step.run("fact-check-validation", async () => {
            return await runFactCheckValidation(liveBlogPost.content);
        });

        const enrichment = await step.run("semantic-enrichment-check", async () => {
            const primaryKeyword = keyword || liveBlogPost.targetKeywords[0] || liveBlogPost.title;
            return runSemanticEnrichmentCheck(primaryKeyword, liveBlogPost.content);
        });

        // Google rewards depth. Thin content (<900 words) is auto-demoted to NEEDS_REVIEW.
        // Overly long content (>6000 words) is truncated at the last sentence boundary
        // before the limit — Google's HCU penalises keyword-stuffed bloat.
        // Meta descriptions >160 chars are silently truncated in SERPs — fix before save.
        await step.run("validate-length-constraints", async () => {
            // Word count (strip HTML tags, count whitespace-delimited tokens)
            const plainText = liveBlogPost.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            let wordCount = plainText.split(" ").filter(Boolean).length;

            // The LLM is instructed not to exceed 6000 words, but as a hard safety
            // net we truncate the HTML at the last sentence boundary before 6000 words.
            const MAX_WORDS = 6000;
            if (wordCount > MAX_WORDS) {
                // Walk through the HTML building up a word-count-aware window.
                // We truncate by rebuilding the plain-text at the word level,
                // then finding the matching character position in the original HTML.
                const words = plainText.split(" ");
                const allowedPlain = words.slice(0, MAX_WORDS).join(" ");
                // Find the last sentence-ending punctuation (.?!) before the hard cut
                const lastSentenceEnd = allowedPlain.search(/[.?!][^.?!]*$/);
                const cutAt = lastSentenceEnd > 0
                    ? lastSentenceEnd + 1   // include the punctuation mark
                    : allowedPlain.length;

                // Map the char position back into the HTML:
                // Walk HTML chars, counting non-tag text chars until we reach cutAt.
                let htmlCursor = 0;
                let textCursor = 0;
                let inTag = false;
                while (htmlCursor < liveBlogPost.content.length && textCursor < cutAt) {
                    const ch = liveBlogPost.content[htmlCursor];
                    if (ch === "<") inTag = true;
                    if (!inTag) textCursor++;
                    if (ch === ">") inTag = false;
                    htmlCursor++;
                }

                liveBlogPost.content = liveBlogPost.content.slice(0, htmlCursor) + "</p>";
                wordCount = MAX_WORDS;   // approximate — re-counting is expensive

                liveBlogPost.validationWarnings.push(
                    `Content exceeded ${MAX_WORDS} words and was trimmed. Review the truncated ending before publishing.`
                );
                logger.warn(`[Blog/LengthGate] Content trimmed from ${words.length} → ${MAX_WORDS} words`, {
                    originalWords: words.length,
                });
            }

            if (wordCount < 900) {
                liveBlogPost.validationWarnings.push(
                    `Content is thin (${wordCount} words). Target 1,500+ for informational queries and 2,500+ for how-to/best-X queries.`
                );
                if (wordCount < 500) {
                    // Critically thin — hard error, not just a warning
                    liveBlogPost.validationErrors.push(`Content too short: ${wordCount} words (minimum 500).`);
                }
            }

            // Title length (Google shows ~55-60 chars before truncation)
            if (liveBlogPost.title.length > 60) {
                liveBlogPost.validationWarnings.push(
                    `Title is ${liveBlogPost.title.length} chars — Google truncates at ~60. Consider shortening.`
                );
            }

            // Meta description length
            if (liveBlogPost.metaDescription.length > 160) {
                // Truncate and log — don't block, just fix silently
                liveBlogPost.metaDescription = liveBlogPost.metaDescription.slice(0, 157) + "...";
                liveBlogPost.validationWarnings.push("Meta description truncated to 160 chars.");
            } else if (liveBlogPost.metaDescription.length < 50) {
                liveBlogPost.validationWarnings.push(
                    `Meta description is very short (${liveBlogPost.metaDescription.length} chars). Aim for 130-160 chars.`
                );
            }

            logger.info(`[Blog/LengthGate] words=${wordCount} titleLen=${liveBlogPost.title.length} metaLen=${liveBlogPost.metaDescription.length}`);
        });


        const qualityScore = factCheck.qualityScore !== null
            ? Math.min(factCheck.qualityScore, liveBlogPost.validationScore)
            : liveBlogPost.validationScore;

        if (factCheck.issues.length > 0) {
            logger.warn(`[Blog/Pipeline] Fact-check issues (score ${qualityScore}/100):`, {
                issues: factCheck.issues,
                factCheckAvailable: factCheck.qualityScore !== null,
            });
        }

        const PLACEHOLDER_PATTERN = /\[Section generation failed|\[EDITOR:/i;
        if (PLACEHOLDER_PATTERN.test(liveBlogPost.content)) {
            logger.error("[Blog/Pipeline] Content contains placeholder text — marking FAILED, will not publish", { siteId, keyword });
            liveBlogPost.validationErrors.push("Content contains unresolved placeholder sections. Regenerate before publishing.");
        }

        const interactiveWidget = await step.run("generate-interactive-widget", async () => {
            const primaryKeyword = keyword || liveBlogPost.targetKeywords[0] || liveBlogPost.title;
            return await generateInteractiveWidget(primaryKeyword, liveBlogPost.content);
        });

        const schemaMarkup = await step.run("generate-schema-markup", async () => {
            return await generateSchemaMarkup({
                title: liveBlogPost.title,
                keyword: keyword || liveBlogPost.targetKeywords[0] || "",
                content: liveBlogPost.content,
                slug: liveBlogPost.slug,
                siteDomain: site.domain,
            });
        });

        // Runs after schema markup is generated so JSON-LD is included in the score.
        // Scores 8 criteria: direct answer, definition block, stats, FAQ, comparison
        // table, E-E-A-T attribution, internal links, structured data.
        // Blogs below 60/100 are demoted to NEEDS_REVIEW automatically.
        const citationGate = await step.run("citation-template-gate", async () => {
            const htmlWithSchema = schemaMarkup
                ? liveBlogPost.content + schemaMarkup
                : liveBlogPost.content;
            return gateCitationScore(
                htmlWithSchema,
                liveBlogPost.targetKeywords,
                liveBlogPost.title,
            );
        });

        logger.info(`[Blog/CitationGate] Score ${citationGate.citationScore}/100 — ready: ${citationGate.citationReady}`, {
            siteId, keyword, intent: citationGate.intent,
            topFix: citationGate.citationReady ? null : citationGate.citationTopFix,
        });

        // Quality gate:
        // validationErrors (hard errors)  → NEEDS_REVIEW
        // riskTier === "high"             → NEEDS_REVIEW (manual review required for YMYL)
        // qualityScore < 40              → FAILED
        // qualityScore 40-79             → NEEDS_REVIEW
        // citationScore < 60             → NEEDS_REVIEW (AI citation readiness gate)
        // qualityScore >= 80, citation >= 60, no errors  → DRAFT

        const hasHardErrors = liveBlogPost.validationErrors.length > 0;
        const isHighRisk = riskTier === "high";

        let blogStatus: "DRAFT" | "NEEDS_REVIEW" | "FAILED";

        if (qualityScore < 40) {
            blogStatus = "FAILED";
            logger.error(`[Blog/Pipeline] Quality score too low (${qualityScore}) — marking FAILED`, { siteId, keyword });
        } else if (hasHardErrors || isHighRisk || qualityScore < 80 || !citationGate.citationReady) {
            blogStatus = "NEEDS_REVIEW";
            logger.warn(`[Blog/Pipeline] Marking NEEDS_REVIEW`, {
                siteId, keyword, qualityScore, hasHardErrors, isHighRisk,
                citationScore: citationGate.citationScore,
                citationReady: citationGate.citationReady,
                errors: liveBlogPost.validationErrors,
            });
        } else {
            blogStatus = "DRAFT";
        }

        const contentWithFunnel = await step.run("inject-funnel-cta", async () => {
            const funnelIntent = (detectedIntent === "local" ? "informational" : detectedIntent) as FunnelIntent;
            const funnelConfig = getFunnelForIntent(
                funnelIntent,
                site.id,
                site.domain.startsWith("http") ? site.domain : `https://${site.domain}`,
                displayName,
                event.data.blogId || "new"
            );
            const h2Splits = liveBlogPost.content.split(/(?=<h2[\s>])/i);
            if (h2Splits.length >= 3) {
                return [...h2Splits.slice(0, 2), funnelConfig.htmlSnippet, ...h2Splits.slice(2)].join("");
            }
            return liveBlogPost.content + funnelConfig.htmlSnippet;
        });

        await step.run("save-blog", async () => {
            const { sanitizeHtml, sanitizeSchemaMarkup } = await import("@/lib/sanitize-html");
            const blogData = {
                pipelineType: finalPipelineType,
                title: liveBlogPost.title,
                slug: liveBlogPost.slug,
                targetKeywords: liveBlogPost.targetKeywords,
                content: sanitizeHtml(contentWithFunnel),
                metaDescription: liveBlogPost.metaDescription,
                ogImage: liveBlogPost.ogImage,
                interactiveWidget: interactiveWidget ? sanitizeHtml(interactiveWidget) : undefined,
                schemaMarkup: schemaMarkup ? sanitizeSchemaMarkup(schemaMarkup) : undefined,
                status: blogStatus,
                validationScore: qualityScore,
                validationErrors: liveBlogPost.validationErrors,
                validationWarnings: liveBlogPost.validationWarnings,
                factCheckIssues: factCheck.issues,
                factCheckSuggestions: factCheck.suggestions,
                // AI Citation Template gate results
                citationScore:    citationGate.citationScore,
                citationCriteria: citationGate.citationCriteria,
            };
            if (event.data.blogId) {
                await prisma.blog.update({ where: { id: event.data.blogId }, data: blogData });
            } else {
                // Upsert on (siteId, slug) — idempotency guard for Inngest retries.
                // If a retry fires after the DB write already succeeded, this overwrites
                // cleanly rather than creating a duplicate post.
                await prisma.blog.upsert({
                    where:  { siteId_slug: { siteId, slug: blogData.slug } },
                    create: { siteId, ...blogData },
                    update: blogData,
                });
            }
        });

        await step.run("extract-brand-facts", async () => {
            const { extractFactsFromContent } = await import("@/lib/aeo/fact-extractor");
            return await extractFactsFromContent(siteId, liveBlogPost.content);
        });

        await step.run("save-enrichment-data", async () => {
            const existingBlog = event.data.blogId
                ? await prisma.blog.findUnique({ where: { id: event.data.blogId }, select: { citationCriteria: true } })
                : null;
            const existingCriteria = existingBlog?.citationCriteria as Record<string, unknown> | null;
            const targetId = event.data.blogId ?? (
                await prisma.blog.findUnique({ where: { siteId_slug: { siteId, slug: liveBlogPost.slug } }, select: { id: true } })
            )?.id;
            if (targetId) {
                await prisma.blog.update({
                    where: { id: targetId },
                    data: {
                        citationCriteria: {
                            ...(existingCriteria ?? {}),
                            missingEntities: enrichment.missingEntities,
                            enrichmentScore: enrichment.enrichmentScore,
                            factCheckScore: factCheck.qualityScore,
                        },
                    },
                });
            }
        });

        // Only for non-failed blogs with at least one target keyword to track.
        if (blogStatus !== "FAILED" && liveBlogPost.targetKeywords.length > 0) {
            await step.sendEvent("trigger-citation-monitor", {
                name: "blog.published",
                data: {
                    siteId,
                    blogId:         event.data.blogId ?? "new",
                    targetKeywords: liveBlogPost.targetKeywords.slice(0, 5),
                    publishedAt:    new Date().toISOString(),
                },
            });
        }

        if (blogStatus !== "FAILED") {
            await step.sendEvent("trigger-internal-links", {
                name: "blog.published" as const,
                data: {
                    siteId,
                    blogId: event.data.blogId ?? "new",
                    blogUrl: `https://${site.domain}/${liveBlogPost.slug}`,
                    keyword: keyword || liveBlogPost.targetKeywords[0] || "",
                },
            });
        }

        return {
            success: blogStatus !== "FAILED",
            qualityScore,
            blogStatus,
            flaggedForReview: blogStatus === "NEEDS_REVIEW",
            hardErrors: liveBlogPost.validationErrors,
        };
    }
);
