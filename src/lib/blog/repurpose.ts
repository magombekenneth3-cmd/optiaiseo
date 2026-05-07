import IORedis from "ioredis";
import { callGeminiJson } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { Blog, Site } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Redis — lazy, safe, never blocks import
// ─────────────────────────────────────────────────────────────

let _redis: IORedis | null = null;

function getRedis(): IORedis | null {
    if (_redis) return _redis;
    if (!process.env.REDIS_URL) return null;

    try {
        _redis = new IORedis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
        });

        _redis.on("error", (err: Error) => {
            logger.warn("[Repurpose] Redis error", { message: err.message });
        });

        return _redis;
    } catch (e) {
        logger.warn("[Repurpose] Redis init failed — caching disabled", {
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// Cache — safe fallback if Redis unavailable
// ─────────────────────────────────────────────────────────────

const CACHE_TTL = 86_400; // 24 hours

const cacheKey = (blogId: string, format: string) =>
    `repurpose:${blogId}:${format}`;

async function getCache<T>(key: string): Promise<T | null> {
    const redis = getRedis();
    if (!redis) return null;

    try {
        const v = await redis.get(key);
        return v ? (JSON.parse(v) as T) : null;
    } catch {
        return null;
    }
}

async function setCache(key: string, value: unknown): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    try {
        await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL);
    } catch {
        // Non-fatal
    }
}

// ─────────────────────────────────────────────────────────────
// Retry — exponential backoff for Gemini 429s / timeouts
// ─────────────────────────────────────────────────────────────

async function withRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    baseDelay = 500
): Promise<T> {
    let lastError: unknown;

    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            if (i < retries) {
                await new Promise((r) =>
                    setTimeout(r, baseDelay * Math.pow(2, i))
                );
            }
        }
    }

    throw lastError;
}

// ─────────────────────────────────────────────────────────────
// Cache + retry wrapper
// ─────────────────────────────────────────────────────────────

async function withCacheAndRetry<T>(
    key: string,
    fn: () => Promise<T>
): Promise<T> {
    const cached = await getCache<T>(key);
    if (cached) {
        logger.info("[Repurpose] Cache hit", { key });
        return cached;
    }

    const result = await withRetry(fn);
    await setCache(key, result);
    return result;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type RepurposeFormat = "linkedin" | "thread" | "youtube" | "reddit" | "podcast";

export interface LinkedInArticle {
    title: string;
    body: string;
    estimatedReadMinutes: number;
    hashtags?: string[];
}

export interface TwitterThread {
    tweets: string[];
    hookPreview: string;
}

export interface YouTubeScript {
    title: string;
    description: string;
    script: string;
    chapters: { time: string; title: string }[];
    estimatedMinutes?: number;
}

export interface RedditPost {
    subreddit: string;
    title: string;
    body: string;
    redditSubmitUrl: string;
}

export interface PodcastOutline {
    title: string;
    outline: string;
    showNotes: string;
    estimatedMinutes: number;
}

export interface RepurposedContent {
    linkedin?: LinkedInArticle;
    thread?: TwitterThread;
    youtube?: YouTubeScript;
    reddit?: RedditPost;
    podcast?: PodcastOutline;
    errors: Partial<Record<RepurposeFormat, string>>;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function extractH2s(html: string): string[] {
    const matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
    return matches.map((m) => stripHtml(m[1])).filter((t) => t.length > 3);
}

function extractFaqsFromSchema(schemaMarkup: string | null): { q: string; a: string }[] {
    if (!schemaMarkup) return [];
    try {
        const parsed = JSON.parse(schemaMarkup);
        const faqPage =
            parsed["@type"] === "FAQPage"
                ? parsed
                : (parsed["@graph"] ?? []).find(
                      (n: { "@type"?: string }) => n["@type"] === "FAQPage"
                  );
        if (!faqPage?.mainEntity) return [];
        return (
            faqPage.mainEntity as {
                name: string;
                acceptedAnswer: { text: string };
            }[]
        )
            .slice(0, 6)
            .map((e) => ({ q: e.name, a: stripHtml(e.acceptedAnswer?.text ?? "") }));
    } catch {
        return [];
    }
}

function truncate(text: string, maxChars = 12000): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n\n[content truncated]";
}

// ─── Format generators ────────────────────────────────────────────────────────

async function generateLinkedIn(blog: Blog & { site: Site }): Promise<LinkedInArticle> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const tone = blog.site.blogTone ?? "Authoritative & Professional";
    const coreServices = blog.site.coreServices ?? "";

    const prompt = `You are a LinkedIn ghostwriter specialising in thought-leadership articles that get cited by AI engines (ChatGPT, Perplexity, Google AIO).

TASK: Rewrite the blog post below as a LinkedIn article.

SOURCE BLOG TITLE: ${blog.title}
PRIMARY KEYWORD: ${keyword}
BRAND DOMAIN: ${brand}
CORE SERVICES: ${coreServices}
TONE: ${tone}

AEO CITATION RULES — follow these exactly:
1. Open with a direct, specific claim in the FIRST sentence — not a question, not "I want to talk about".
   GOOD: "Most companies waste 40% of their SEO budget on tactics that AI engines cannot cite."
   BAD: "Have you ever wondered why your SEO isn't working?"
2. Use first-person authority voice: "I've seen this pattern in dozens of campaigns."
3. Include at least one statistic from the source content in the first 100 words.
4. Use 3–5 bullet points or a numbered list in the middle — AI engines prefer structured content.
5. NEVER use the words: leverage, robust, foster, synergy, revolutionary, game-changer, exciting.
6. End with a direct question to readers: "What has worked for you?" or similar.
7. Length: 800–1,200 words.
8. Include a link to the original blog in the final paragraph: "Read the full guide at ${brand}."

SECTIONS TO COVER (from the original H2s):
${h2s.map((h, i) => `${i + 1}. ${h}`).join("\n")}

SOURCE CONTENT (use for facts and insights, do NOT copy verbatim):
${truncate(plain, 8000)}

Respond ONLY with a JSON object in this exact shape — no markdown fences:
{
  "title": "string (compelling LinkedIn article headline, ≤ 100 chars)",
  "body": "string (the full article, plain text with \\n\\n between paragraphs)",
  "hashtags": ["string", "string", "string"],
  "estimatedReadMinutes": number
}`;

    return callGeminiJson<LinkedInArticle>(prompt, { temperature: 0.6, maxOutputTokens: 2048 });
}

async function generateThread(blog: Blog & { site: Site }): Promise<TwitterThread> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const faqs = extractFaqsFromSchema(blog.schemaMarkup);
    const keyword = blog.targetKeywords[0] ?? "";
    const url = `https://${blog.site.domain}/blog/${blog.slug}`;

    const faqLines =
        faqs.length > 0
            ? "\n\nFAQ PAIRS FROM THE ARTICLE (use as tweet material):\n" +
              faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")
            : "";

    const prompt = `You are a Twitter/X thread writer. Write a thread that gets saved and reshared — and that AI engines will cite as a credible source.

TASK: Turn this blog post into a Twitter/X thread.

BLOG TITLE: ${blog.title}
PRIMARY KEYWORD: ${keyword}
BLOG URL: ${url}

THREAD RULES:
1. Tweet 1 (hook): A single bold, counterintuitive claim from the article. Under 240 chars. NO "thread" or "🧵" emoji — they signal low quality to AI crawlers.
2. Tweets 2–3: The most surprising or data-backed insight from the article.
3. Tweets 4–(N-2): One key insight per H2 section. Each tweet is self-contained — a reader should understand it without context.
4. Second-to-last tweet: A practical "how to" step readers can take today.
5. Last tweet: "Full guide → ${url}" — nothing else.
6. Format: number each tweet "1/N", "2/N" etc. where N is the total count.
7. Each tweet MUST be ≤ 280 characters INCLUDING the "X/N" prefix.
8. 10–14 tweets total.
9. No hashtags. No emojis unless they replace a word. No "RT if you agree."

H2 SECTIONS (one insight per section):
${h2s.map((h, i) => `${i + 1}. ${h}`).join("\n")}
${faqLines}

SOURCE CONTENT:
${truncate(plain, 6000)}

Respond ONLY with a JSON object — no markdown fences:
{
  "tweets": ["string", "string", ...],
  "hookPreview": "string (first 100 chars of tweet 1)"
}`;

    return callGeminiJson<TwitterThread>(prompt, { temperature: 0.65, maxOutputTokens: 1500 });
}

async function generateYouTube(blog: Blog & { site: Site }): Promise<YouTubeScript> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const coreServices = blog.site.coreServices ?? "";

    const prompt = `You are a YouTube scriptwriter. Write a spoken video script optimised for AI engine indexing — Perplexity and ChatGPT frequently cite YouTube transcripts.

TASK: Turn this blog post into a YouTube video script.

BLOG TITLE: ${blog.title}
PRIMARY KEYWORD: ${keyword}
CHANNEL BRAND: ${brand}
CORE SERVICES: ${coreServices}

SCRIPT RULES:
1. Hook (0:00–0:30): Open with the PROBLEM, not the solution. "If you've ever [specific frustrating situation], this video is for you."
2. Use conversational language throughout: contractions, second person ("you'll notice", "here's what happens").
3. Each chapter = one H2 from the blog, spoken content ~60–90 seconds each.
4. Include 3 "pattern interrupts" — moments of surprise:
   a. A counterintuitive statistic
   b. A common misconception corrected
   c. A "most people don't know this" insight
5. Write [B-ROLL: description] stage directions where visuals would help.
6. Outro (last 30 sec): "If this helped, subscribe for weekly [niche] strategy. Link in description to the full written guide."
7. Write as it would be SPOKEN — short sentences, natural pauses marked with "..." where the presenter would breathe.

CHAPTERS TO COVER (from H2s):
${h2s.map((h, i) => `Chapter ${i + 1}: ${h}`).join("\n")}

SOURCE CONTENT:
${truncate(plain, 8000)}

Respond ONLY with a JSON object — no markdown fences:
{
  "title": "string (YouTube title, ≤ 60 chars, includes primary keyword)",
  "description": "string (SEO video description, 150–200 words, includes keyword, ends with link to ${brand})",
  "script": "string (full spoken script, plain text with \\n\\n between sections)",
  "chapters": [
    { "time": "0:00", "title": "string" },
    { "time": "0:30", "title": "string" }
  ],
  "estimatedMinutes": number
}`;

    return callGeminiJson<YouTubeScript>(prompt, { temperature: 0.6, maxOutputTokens: 3000 });
}

async function generateReddit(blog: Blog & { site: Site }): Promise<RedditPost> {
    const plain = stripHtml(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";

    let targetSubreddit = "r/SEO";
    try {
        const plannerItem = await prisma.plannerItem.findFirst({
            where: { siteId: blog.siteId, keyword: { in: blog.targetKeywords } },
            select: { reddit: true },
        });
        const redditData = plannerItem?.reddit as
            | { subreddits?: string[]; karmaReady?: boolean }
            | null;
        if (redditData?.subreddits?.[0]) {
            const sub = redditData.subreddits[0];
            targetSubreddit = sub.startsWith("r/") ? sub : `r/${sub}`;
        }
    } catch {
        // Non-fatal — fall back to r/SEO
    }

    const prompt = `You are a Reddit contributor. Write a post that drives genuine discussion — and that will rank on Google and be indexed by AI engines as a credible source.

TASK: Write a Reddit post based on this blog content.

BLOG TITLE: ${blog.title}
PRIMARY KEYWORD: ${keyword}
TARGET SUBREDDIT: ${targetSubreddit}

REDDIT POST RULES:
1. Title: A genuine question the subreddit's users would ask — NOT a disguised headline.
   GOOD: "Has anyone found that [specific technique] actually improves AI visibility? Curious what's working."
   BAD: "The Ultimate Guide to ${keyword}"
2. Body — paragraph 1: The single most surprising or counter-intuitive insight from the article. No intro, straight into the insight.
3. Body — paragraphs 2–3: Supporting context, written as a personal observation or experience. First person.
4. Body — paragraph 4: A specific open question to invite replies. "Has anyone else noticed [X]? What worked for you?"
5. NEVER mention the brand name or domain in the body. Never say "I wrote a guide" or "check out my blog."
6. NO markdown headers in the body. Short paragraphs. Reddit's reading style is conversational.
7. The link to the original article goes in a comment posted by the author AFTER the post — not in the body.
8. Length: 150–300 words.
9. Tone: genuine community member sharing an observation, not a marketer.

SOURCE CONTENT (extract the most interesting insight, do NOT copy verbatim):
${truncate(plain, 5000)}

Respond ONLY with a JSON object — no markdown fences:
{
  "subreddit": "string (e.g. r/SEO)",
  "title": "string (question-style, ≤ 300 chars)",
  "body": "string (plain text, \\n\\n between paragraphs)"
}`;

    const result = await callGeminiJson<Omit<RedditPost, "redditSubmitUrl">>(prompt, {
        temperature: 0.7,
        maxOutputTokens: 800,
    });

    const sub = (result.subreddit ?? targetSubreddit).replace(/^r\//, "");
    const encodedTitle = encodeURIComponent(result.title ?? "");
    const encodedBody = encodeURIComponent(result.body ?? "");

    return {
        ...result,
        subreddit: `r/${sub}`,
        redditSubmitUrl: `https://www.reddit.com/r/${sub}/submit?title=${encodedTitle}&text=${encodedBody}`,
    };
}

async function generatePodcast(blog: Blog & { site: Site }): Promise<PodcastOutline> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const coreServices = blog.site.coreServices ?? "";

    const prompt = `You are a podcast producer. Write an episode outline that a host can follow to record a solo episode — and that, once transcribed, will be indexed by AI engines.

TASK: Create a podcast episode outline from this blog post.

BLOG TITLE: ${blog.title}
PRIMARY KEYWORD: ${keyword}
BRAND: ${brand}
CORE SERVICES: ${coreServices}

OUTLINE RULES:
1. Episode title: conversational, question-based or "how to" style. ≤ 60 chars.
2. Talking points: one per H2 section. For each point include:
   - The main claim to make
   - One supporting example or stat
   - A transition to the next point ("Which brings me to...")
3. Estimated time per section (in minutes).
4. Guest question prompts (3–4 questions if the host wanted to bring a guest).
5. Outro: 30-second "subscribe and review" ask + mention of the full written guide at ${brand}.

SHOW NOTES RULES:
- Markdown formatted
- Key takeaways as bullet points (3–5)
- Links section: original blog post, any tools mentioned
- Transcript note: "Full transcript available at ${brand}"

SECTIONS FROM THE BLOG:
${h2s.map((h, i) => `${i + 1}. ${h}`).join("\n")}

SOURCE CONTENT:
${truncate(plain, 6000)}

Respond ONLY with a JSON object — no markdown fences:
{
  "title": "string (episode title)",
  "outline": "string (structured outline, plain text with \\n\\n between sections)",
  "showNotes": "string (markdown formatted show notes)",
  "estimatedMinutes": number
}`;

    return callGeminiJson<PodcastOutline>(prompt, { temperature: 0.55, maxOutputTokens: 2000 });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Repurpose a published blog into up to 5 channel-specific formats.
 * Each format is cache-checked first (Redis, 24h TTL), then generated
 * via Gemini with exponential backoff retry. Runs all requested formats
 * in parallel. Failed formats are recorded in result.errors without throwing.
 *
 * @param blog    — Blog record with site relation included
 * @param formats — Which formats to generate. Defaults to all five.
 */
export async function repurposeBlog(
    blog: Blog & { site: Site },
    formats: RepurposeFormat[] = ["linkedin", "thread", "youtube", "reddit", "podcast"]
): Promise<RepurposedContent> {
    const result: RepurposedContent = { errors: {} };

    const tasks: Promise<void>[] = [];

    const run = <T>(
        format: RepurposeFormat,
        fn: () => Promise<T>,
        assign: (r: T) => void
    ) =>
        tasks.push(
            withCacheAndRetry(cacheKey(blog.id, format), fn)
                .then(assign)
                .catch((e: unknown) => {
                    logger.error(`[Repurpose] ${format} failed`, {
                        blogId: blog.id,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    result.errors[format] = e instanceof Error ? e.message : String(e);
                })
        );

    if (formats.includes("linkedin"))
        run("linkedin", () => generateLinkedIn(blog), (r) => { result.linkedin = r; });

    if (formats.includes("thread"))
        run("thread", () => generateThread(blog), (r) => { result.thread = r; });

    if (formats.includes("youtube"))
        run("youtube", () => generateYouTube(blog), (r) => { result.youtube = r; });

    if (formats.includes("reddit"))
        run("reddit", () => generateReddit(blog), (r) => { result.reddit = r; });

    if (formats.includes("podcast"))
        run("podcast", () => generatePodcast(blog), (r) => { result.podcast = r; });

    await Promise.all(tasks);

    try {
        await prisma.aeoEvent.create({
            data: {
                siteId: blog.siteId,
                blogId: blog.id,
                eventType: "REPURPOSE_GENERATED",
                metadata: {
                    formats,
                    successCount: formats.length - Object.keys(result.errors).length,
                    errors: result.errors,
                },
            },
        });
    } catch {
        // Non-fatal
    }

    return result;
}