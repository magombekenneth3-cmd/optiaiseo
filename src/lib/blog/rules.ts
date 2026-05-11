import type { PromptContext } from "./prompt-context";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import { callGeminiJson } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { Blog, Site } from "@prisma/client";

// Redis — lazy, safe, never blocks import

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

// Cache

const CACHE_TTL = 86_400;

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

// Retry — exponential backoff for Gemini 429s / timeouts

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

export type RepurposeFormat =
    | "linkedin"
    | "thread"
    | "youtube"
    | "reddit"
    | "podcast";

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

export interface RepurposeJobData {
    blogId: string;
    siteId: string;
    formats: RepurposeFormat[];
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

function extractFaqsFromSchema(
    schemaMarkup: string | null
): { q: string; a: string }[] {
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
            .map((e) => ({
                q: e.name,
                a: stripHtml(e.acceptedAnswer?.text ?? ""),
            }));
    } catch {
        return [];
    }
}

function truncate(text: string, maxChars = 12000): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n\n[content truncated]";
}

// ─── Shared prompt quality rules (from prompt engineering layer) ──────────────
//
// These rules are injected into every format prompt to enforce:
// - claim integrity   (no invented stats)
// - tone consistency  (banned phrases, sentence rhythm)
// - opinion signals   (at least one stance per section)
// - FAQ discipline    (direct openers only)
//
// Keeping them in one place means a single edit propagates to all five formats.

function buildPromptRules(keyword: string): string {
    return `
CLAIM INTEGRITY — apply to every sentence:
- Never write a percentage, dollar amount, or multiplier without naming its source inline.
- If you have no named source, write the claim without the number. "Estimated" does not rescue an invented figure — remove it entirely.
  BAD:  "An estimated 40% of users abandon within 30 days."
  GOOD: "Most users abandon early — add [SOURCE] if you have a real figure."
- After every strong assertion, add one boundary condition:
  WRONG: "This approach works well for ${keyword}."
  RIGHT: "This approach works for ${keyword} — unless [specific condition], in which case [specific alternative] is better."

WORD CHOICE — always use the spoken word:
  big / not substantial       fix / not remediate
  use / not leverage          find out / not ascertain
  strong / not robust         try / not endeavour
  check / not scrutinize      choose / not opt for
  help / not facilitate       show / not demonstrate
  need / not require

SENTENCE RHYTHM:
- Never write three consecutive sentences of the same length.
- Pattern: short point. longer context and qualification. short point.
- Vary sentence openers: time ("Three weeks in..."), action ("Run this before..."), number ("Two things matter here."), named example ("Notion handles this differently.").
- Never start three consecutive sentences with the same word.

OPINION SIGNAL — required at least once per major section:
- Choose one per section:
  a) Direct stance:    "This step matters more than the three before it."
  b) Named exception:  "This breaks when [condition] — do [Y] instead."
  c) Practitioner tip: "Most practitioners flag this. Most ignore it."
  d) Contradiction:    "Standard advice says [X]. In practice, [Y] works better because [reason]."

FAQ ANSWERS — first word must be: Yes / No / a number / a tool name / a time frame.
  NOT: "It depends" / "Generally" / "There are many."
  After the direct opener: one context sentence. Then stop. Max 3 sentences.

BANNED PHRASES — if any of these appear, the output fails:
furthermore / moreover / additionally / in conclusion / notably /
it is worth noting / leverage the power of / unlock the potential /
seamlessly integrate / comprehensive guide / delve into / game-changing /
cutting-edge / robust / in today's rapidly evolving / as we navigate /
now more than ever / when it comes to / one of the most important`;
}

// ─── Format generators ────────────────────────────────────────────────────────

async function generateLinkedIn(
    blog: Blog & { site: Site }
): Promise<LinkedInArticle> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const tone = blog.site.blogTone ?? "Authoritative & Professional";
    const coreServices = blog.site.coreServices ?? "";
    const rules = buildPromptRules(keyword);

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
   BAD:  "Have you ever wondered why your SEO isn't working?"
2. Use first-person authority voice: "I've seen this pattern in dozens of campaigns."
3. Include at least one statistic from the source content (named source required) in the first 100 words.
4. Use 3–5 bullet points or a numbered list in the middle — AI engines prefer structured content.
5. End with a direct question to readers: "What has worked for you?" or similar.
6. Length: 800–1,200 words.
7. Include a link to the original blog in the final paragraph: "Read the full guide at ${brand}."

SECTIONS TO COVER (from the original H2s):
${h2s.map((h, i) => `${i + 1}. ${h}`).join("\n")}

SOURCE CONTENT (use for facts and insights, do NOT copy verbatim):
${truncate(plain, 8000)}

${rules}

Respond ONLY with a JSON object in this exact shape — no markdown fences:
{
  "title": "string (compelling LinkedIn article headline, ≤ 100 chars)",
  "body": "string (the full article, plain text with \\n\\n between paragraphs)",
  "hashtags": ["string", "string", "string"],
  "estimatedReadMinutes": number
}`;

    return callGeminiJson<LinkedInArticle>(prompt, {
        temperature: 0.6,
        maxOutputTokens: 4096,
    });
}

async function generateThread(
    blog: Blog & { site: Site }
): Promise<TwitterThread> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const faqs = extractFaqsFromSchema(blog.schemaMarkup);
    const keyword = blog.targetKeywords[0] ?? "";
    const url = `https://${blog.site.domain}/blog/${blog.slug}`;
    const rules = buildPromptRules(keyword);

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
2. Tweets 2–3: The most surprising or data-backed insight from the article. Name the source if using a stat.
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

${rules}

Respond ONLY with a JSON object — no markdown fences:
{
  "tweets": ["string", "string", ...],
  "hookPreview": "string (first 100 chars of tweet 1)"
}`;

    return callGeminiJson<TwitterThread>(prompt, {
        temperature: 0.65,
        maxOutputTokens: 3500,
    });
}

async function generateYouTube(
    blog: Blog & { site: Site }
): Promise<YouTubeScript> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const coreServices = blog.site.coreServices ?? "";
    const rules = buildPromptRules(keyword);

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
   a. A counterintuitive statistic (name the source)
   b. A common misconception corrected
   c. A "most people don't know this" insight
5. Write [B-ROLL: description] stage directions where visuals would help.
6. Outro (last 30 sec): "If this helped, subscribe for weekly [niche] strategy. Link in description to the full written guide."
7. Write as it would be SPOKEN — short sentences, natural pauses marked with "..." where the presenter would breathe.

CHAPTERS TO COVER (from H2s):
${h2s.map((h, i) => `Chapter ${i + 1}: ${h}`).join("\n")}

SOURCE CONTENT:
${truncate(plain, 8000)}

${rules}

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

    return callGeminiJson<YouTubeScript>(prompt, {
        temperature: 0.6,
        maxOutputTokens: 5000,
    });
}

async function generateReddit(
    blog: Blog & { site: Site }
): Promise<RedditPost> {
    const plain = stripHtml(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const rules = buildPromptRules(keyword);

    let targetSubreddit = "r/SEO";
    try {
        const plannerItem = await prisma.plannerItem.findFirst({
            where: {
                siteId: blog.siteId,
                keyword: { in: blog.targetKeywords },
            },
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
   BAD:  "The Ultimate Guide to ${keyword}"
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

${rules}

Respond ONLY with a JSON object — no markdown fences:
{
  "subreddit": "string (e.g. r/SEO)",
  "title": "string (question-style, ≤ 300 chars)",
  "body": "string (plain text, \\n\\n between paragraphs)"
}`;

    const result = await callGeminiJson<Omit<RedditPost, "redditSubmitUrl">>(
        prompt,
        { temperature: 0.7, maxOutputTokens: 800 }
    );

    const sub = (result.subreddit ?? targetSubreddit).replace(/^r\//, "");
    const encodedTitle = encodeURIComponent(result.title ?? "");
    const encodedBody = encodeURIComponent(result.body ?? "");

    return {
        ...result,
        subreddit: `r/${sub}`,
        redditSubmitUrl: `https://www.reddit.com/r/${sub}/submit?title=${encodedTitle}&text=${encodedBody}`,
    };
}

async function generatePodcast(
    blog: Blog & { site: Site }
): Promise<PodcastOutline> {
    const plain = stripHtml(blog.content);
    const h2s = extractH2s(blog.content);
    const keyword = blog.targetKeywords[0] ?? "";
    const brand = blog.site.domain;
    const coreServices = blog.site.coreServices ?? "";
    const rules = buildPromptRules(keyword);

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
   - One supporting example or stat (name the source)
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

${rules}

Respond ONLY with a JSON object — no markdown fences:
{
  "title": "string (episode title)",
  "outline": "string (structured outline, plain text with \\n\\n between sections)",
  "showNotes": "string (markdown formatted show notes)",
  "estimatedMinutes": number
}`;

    return callGeminiJson<PodcastOutline>(prompt, {
        temperature: 0.55,
        maxOutputTokens: 4000,
    });
}

// ─── Core generation (used by both direct call and worker) ────────────────────

/**
 * Repurpose a published blog into up to 5 channel-specific formats.
 * Each format is cache-checked first (Redis, 24h TTL), then generated
 * via Gemini with exponential backoff retry. Runs all requested formats
 * in parallel. Failed formats are recorded in result.errors without throwing.
 */
export async function repurposeBlog(
    blog: Blog & { site: Site },
    formats: RepurposeFormat[] = [
        "linkedin",
        "thread",
        "youtube",
        "reddit",
        "podcast",
    ]
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
                    result.errors[format] =
                        e instanceof Error ? e.message : String(e);
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
                    successCount:
                        formats.length - Object.keys(result.errors).length,
                    errors: result.errors,
                },
            },
        });
    } catch {
        // Non-fatal
    }

    return result;
}

// ─── BullMQ queue + worker ────────────────────────────────────────────────────
//
// Use enqueueRepurposeJob() from your API route instead of calling
// repurposeBlog() directly. The HTTP response returns immediately with
// a jobId. The worker picks up the job, runs repurposeBlog(), and writes
// the result to RepurposedResult. The client polls getRepurposeStatus()
// or receives a webhook.
//
// Only one worker instance should be started per process — import
// startRepurposeWorker() in your server entry point (e.g. worker.ts).

function getQueue(): Queue {
    const redis = getRedis();
    if (!redis) throw new Error("REDIS_URL is required for the repurpose queue");

    return new Queue("repurpose", {
        connection: redis,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        },
    });
}

// Lazily created so tests that never call enqueue don't require Redis.
let _queue: Queue | null = null;

export async function enqueueRepurposeJob(
    data: RepurposeJobData
): Promise<{ jobId: string }> {
    if (!_queue) _queue = getQueue();

    const job = await _queue.add("repurpose-blog", data);

    return { jobId: job.id! };
}

export function startRepurposeWorker(): Worker {
    const redis = getRedis();
    if (!redis) throw new Error("REDIS_URL is required for the repurpose worker");

    return new Worker(
        "repurpose",
        async (job) => {
            const { blogId, formats } = job.data as RepurposeJobData;

            const blog = await prisma.blog.findUnique({
                where: { id: blogId },
                include: { site: true },
            });

            if (!blog) throw new Error(`Blog not found: ${blogId}`);

            const repurposed = await repurposeBlog(blog, formats);

            await prisma.repurposedResult.upsert({
                where: { blogId },
                create: {
                    blogId,
                    siteId: blog.siteId,
                    data: repurposed as object,
                    status: "completed",
                },
                update: {
                    data: repurposed as object,
                    status: "completed",
                    updatedAt: new Date(),
                },
            });

            return repurposed;
        },
        {
            connection: redis,
            concurrency: 5,
        }
    );
}

export async function getRepurposeStatus(blogId: string) {
    return prisma.repurposedResult.findUnique({ where: { blogId } });
}

// ─── Prompt rule exports (used by blog/index.ts) ──────────────────────────────

interface AuthorProfile {
    name: string;
    role?: string;
    bio?: string;
    realExperience?: string | null;
    realNumbers?: string | null;
    localContext?: string | null;
}

export function getClaimRules(ctx: PromptContext): string {
    const high = ctx.riskTier === "high";
    return `CLAIM INTEGRITY:
- Never write a percentage, dollar amount, or multiplier without naming its source inline.
- If you have no named source, state the claim without the number.
${high ? "- HIGH-RISK TOPIC: Every factual claim requires a named source or must be removed.\n- Include a disclaimer: this content is informational only and not professional advice." : ""}
- After every strong assertion add one boundary condition explaining when it does NOT apply.`;
}

export function getToneRules(ctx: PromptContext): string {
    const intentMap: Record<string, string> = {
        transactional: "Direct and conversion-focused — help the reader take action now.",
        commercial:    "Balanced and analytical — help the reader compare options confidently.",
        local:         "Warm and community-aware — speak to the reader's specific location and context.",
        navigational:  "Clear and efficient — get the reader to the right place fast.",
        informational: "Authoritative and educational — trusted expert explaining to a peer.",
    };
    return `TONE: ${intentMap[ctx.intent] ?? "Authoritative and direct."}

EDITORIAL VOICE:
- Write from a position of earned authority — the voice of someone who has done this, not studied it.
- Use contractions naturally: "you'll", "it's", "don't", "here's".
- First-person only when grounded in real author experience.
- Take clear stances. Opinions backed by reasoning are more valuable than hedged generalisations.

WORD CHOICE — always prefer the spoken word:
  big / not substantial        fix / not remediate          use / not leverage
  find out / not ascertain     strong / not robust          try / not endeavour
  check / not scrutinize       choose / not opt for         help / not facilitate
  show / not demonstrate       need / not require           start / not initiate

REPETITION RULE:
- No content word (noun, verb, adjective) should appear more than 4 times in any 150-word window.
  Exception: the primary keyword "${ctx.keyword}" and its direct synonyms.
  BAD:  "The tool helps you track keywords. The tool also helps with backlinks. The tool provides reports."
  GOOD: "It tracks keywords, flags backlink changes, and pulls weekly reports — in one place."

BANNED PHRASES (worst offenders — avoid these):
furthermore / moreover / in conclusion / delve into / leverage / robust / comprehensive guide`;
}

export function getScopeRules(ctx: PromptContext): string {
    const wordTarget =
        ctx.intent === "transactional" ? 1500
        : ctx.intent === "commercial"  ? 2200
        : ctx.intent === "local"       ? 1800
        :                                2200; // informational default
    return `SCOPE:
PRIMARY KEYWORD STRATEGY — "${ctx.keyword}":
- Use naturally in: the title (within first 60 chars), the opening paragraph, and 1-2 H2 headings.
- Prefer semantic relevance over repetition — use synonyms, related terms, and entity variations throughout.
- Do NOT force exact-match repetition. Keyword stuffing reduces quality and is detectable.
- Include semantic variations: related terms, entity names, and LSI phrases that cover the topic comprehensively.
- Meta description: keyword within first 120 characters, 140–160 characters total, written as compelling ad copy.
- URL slug: lowercase, hyphens only, keyword-only — no stop words.
- Minimum word count: ${wordTarget} words.
- Year reference: ${ctx.year}.
${ctx.isLocalTopic ? `- LOCAL TOPIC: include city/region name, local regulations, regional pricing, and local platform context in at least one H2.` : ""}`;
}

export function getStructureRules(ctx: PromptContext): string {
    return `STRUCTURE:
- ONE H1 = the article title only. Primary keyword within first 60 characters.
- 5–8 H2 sections. Derive structure from the topic and SERP data — not from a default template.
- Answer the primary search intent in the FIRST 30% of the article.
- TITLE-COUNT RULE: if the title contains a number, the content must contain exactly that many H3 items.
- Intro: 3 sentences — (1) the most useful/surprising fact about "${ctx.keyword}", (2) your unique angle, (3) what the reader gets. No "Welcome to" or "In this article" openers.
- FAQs MUST align to real People Also Ask queries for "${ctx.keyword}". Every FAQ answer opens with Yes / No / a number / a named tool or time frame.
- DO NOT use the pattern: What Is X → Why X Matters → How to X → Common Mistakes → FAQ. This is predictable and AI-detectable.
- FRESHNESS: at least one section must reference what specifically changed or is different as of ${ctx.year} — not a timeless platitude that was true five years ago.
- HUMAN VARIATION: sentence length, paragraph length, and transition style must vary visibly across the article. Uniform structure is the clearest AI signal. Mix short punchy sections with longer developed ones, terse single-sentence paragraphs with multi-sentence ones. Imperfect transitions ("Here’s the thing.", "And that’s where it breaks.") are required, not optional.`;
}

const PROMPT_INJECTION_RE = /(?:ignore\s+(?:previous|all|above)\s+instructions?|system\s*:|<\|im_start\|>|<\|im_end\|>|\[INST\]|<<SYS>>|<\|system\|>|\[SYSTEM\])/gi;

function sanitizeGrounding(text: string): string {
    return text.replace(PROMPT_INJECTION_RE, "[redacted]").slice(0, 1000);
}

export function getAuthorGrounding(author: AuthorProfile, ctx: PromptContext): string {
    if (author.realExperience || author.realNumbers || author.localContext) {
        const parts: string[] = ["AUTHOR GROUNDING — weave these naturally into the content:"];
        if (author.realExperience) parts.push(`- Real experience: ${sanitizeGrounding(author.realExperience)}`);
        if (author.realNumbers)   parts.push(`- Real numbers / results: ${sanitizeGrounding(author.realNumbers)}`);
        if (author.localContext)  parts.push(`- Local / niche context: ${sanitizeGrounding(author.localContext)}`);
        return parts.join("\n");
    }
    // No grounding data — still require an E-E-A-T signal
    return `EXPERIENCE SIGNAL: Include at least one "in practice" observation, a named failure mode,
or a scenario only someone who has actually done this would describe.
Generic advice without a grounding moment fails Google's E-E-A-T check.`;
}

export function getHumanizePrompt(content: string, ctx: PromptContext): string {
    return `You are a senior editor at a trade publication. Your task is an editorial rewrite — not a "humanization" pass. The goal is to make this read like a confident practitioner wrote it from experience.

Keyword: "${ctx.keyword}"
Intent: ${ctx.intent}

EDITORIAL REWRITE RULES:

1. ACTIVE VOICE: Replace every passive construction.
   BAD: "The keyword should be included in the title."
   GOOD: "Put the keyword in the title."

2. SENTENCE LENGTH: Break sentences over 28 words into two. Alternate short (8-12w), medium (13-20w), longer (21-28w). Never two identical categories back-to-back.

3. OPENER VARIETY: Never start two consecutive sentences with the same word. Vary with: time phrases ("Three months in…"), numbers ("Two things matter here."), named tools, contrasting conjunctions ("But", "Yet", "Still").

4. REPETITION SWEEP: Scan each 150-word window. Any non-keyword content word appearing 4+ times — rephrase using pronouns or synonyms.
   BAD:  "The platform tracks keywords. The platform monitors backlinks. The platform sends alerts."
   GOOD: "It tracks keywords, monitors backlinks, and sends alerts."

5. REMOVE these phrases (replace with plain alternatives, do not just delete):
   In conclusion / Furthermore / Moreover / Delve into / Leverage / Robust /
   Comprehensive guide / Cutting-edge / Game-changing / Now more than ever /
   When it comes to / It is important to / Final thoughts / To summarise / Empower users.

6. CONTRACTIONS: At least one per paragraph — "you'll", "it's", "don't", "here's".

7. OPINION SIGNALS: Each H2 must contain one of:
   - "Standard advice says X. In practice, Y works better."
   - "This breaks when [condition] — do [Y] instead."
   - "Most people miss this. Don't."

8. MICRO-IMPERFECTIONS: Add one controlled irregularity per 400 words:
   - A sentence fragment for emphasis: "That's the real problem."
   - An abrupt transition: "Here's what changes everything."
   - A short standalone emphatic line: "Most teams ignore this."
   These feel like a real writer. Use sparingly.

9. FAQ ANSWERS: Every FAQ answer opens with Yes / No / a number / a tool name / a time frame.

10. Return ONLY the rewritten HTML — no markdown fences, no commentary.

ARTICLE:
${content}`;
}

export function getComparisonTableRule(ctx: PromptContext): string {
    if (ctx.riskTier === "high") {
        return "OMIT the comparison table entirely for high-risk topics — unverified statistics in this category are harmful.";
    }
    return `COMPARISON TABLE: include 3–5 rows with columns: Problem | Industry Average | ${ctx.displayName ?? "Recommended Approach"} | Result.
Only include rows where you have real, named data. Tag any unverified rows with [Verify] in the Result cell.`;
}

export function getQuickAnswerRule(ctx: PromptContext): string {
    return `QUICK ANSWER (featured-snippet target): 40–60 words answering "${ctx.keyword}" directly.
First word must be: Yes / No / a number / a tool name / a time frame.
Do NOT start with "It depends", "Generally", or "There are many".
One sentence of context. Then stop.`;
}