import type { PromptContext } from "./prompt-context";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
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
// Cache
// ─────────────────────────────────────────────────────────────

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

WRITE LIKE A HUMAN EXPERT — NOT AN AI:
- Use contractions naturally: "you'll", "it's", "don't", "here's".
- Use short, punchy sentences. Mix them with longer ones. Never write three sentences of the same length back-to-back.
- Vary your sentence openers. Never start three consecutive sentences with the same word (including "The", "This", "It", "You").
- Use first-person sparingly and only when grounded in real experience from the author context.
- Write the way you'd explain it to a peer over coffee — precise, direct, occasionally opinionated.

WORD CHOICE — always prefer the spoken word:
  big / not substantial        fix / not remediate          use / not leverage
  find out / not ascertain     strong / not robust          try / not endeavour
  check / not scrutinize       choose / not opt for         help / not facilitate
  show / not demonstrate       need / not require           start / not initiate
  end / not terminate          make / not construct         think / not cognize
  work / not function          tell / not communicate       keep / not maintain

REPETITION RULE — failure condition:
- No content word (noun, verb, adjective) should appear more than 4 times in any 150-word window.
  Exception: the primary keyword "${ctx.keyword}" and its direct synonyms.
- Vary references: use pronouns, synonyms, and sentence restructuring rather than repeating the same noun.
  BAD:  "The tool helps you track keywords. The tool also helps with backlinks. The tool provides reports."
  GOOD: "It tracks keywords, flags backlink changes, and pulls weekly reports — in one place."

BANNED PHRASES — if any of these appear, the content FAILS:
// Transitions / connectors
furthermore / moreover / additionally / in addition / in conclusion / to summarise /
notably / importantly / significantly / it is worth noting / it should be noted /
it goes without saying / needless to say / as mentioned earlier / as noted above /

// AI topic openers
in today's rapidly evolving / in today's digital landscape / in the ever-changing /
as we navigate / now more than ever / in an increasingly / in a world where /
when it comes to / in the realm of / in the context of / at the end of the day /
in this day and age / the fact of the matter is /

// Buzzword verbs
leverage the power of / unlock the potential / unlock new possibilities /
seamlessly integrate / drive engagement / foster growth / facilitate change /
enable businesses / empower users / revolutionise / transform your / elevate your /
take your [X] to the next level / game-changing / cutting-edge / groundbreaking /
disruptive / innovative solution / holistic approach / synergistic /

// Hollow adjectives
robust / comprehensive guide / ultimate guide / definitive guide / deep dive /
delve into / dive into / explore / unpack / demystify / shed light on /
pioneering / state-of-the-art / best-in-class / world-class / industry-leading /

// Hedge phrases
it is important to / it is essential to / it is crucial to / it is vital to /
one of the most important / perhaps the most / arguably the most /
it cannot be overstated / cannot be emphasised enough /

// Generic closers
in summary / to sum up / overall / all in all / in closing / to conclude /
final thoughts / final word / wrapping up / as we have seen /
key takeaways (unless followed immediately by a bulleted list).`;
}

export function getScopeRules(ctx: PromptContext): string {
    const wordTarget =
        ctx.intent === "transactional" ? 1500
        : ctx.intent === "commercial"  ? 2200
        : ctx.intent === "local"       ? 1800
        :                                2200; // informational default
    return `SCOPE:
- Primary keyword "${ctx.keyword}" MUST appear:
  · In the title within the first 60 characters (not at the end)
  · In the first 100 words of the body
  · 8–15 times total across the article
  · In at least 2 H2 headings (exact match or natural variant)
  · At a density of 0.5%–2.5% of total words — not lower, not higher.
- Include 10+ semantic / LSI variations of the primary keyword (do NOT repeat exact phrase every time).
- Meta description: primary keyword must appear within the first 120 characters. 140–160 characters total.
- URL slug: lowercase, hyphens only, primary keyword only — remove all stop words (a/an/the/of/in/for).
- Minimum word count: ${wordTarget} words.
- Year reference: ${ctx.year} (keep content current).
${ctx.isLocalTopic ? `- LOCAL TOPIC: weave in specific local context — city/region name, local regulations, local platforms, regional pricing or buyer behaviour. Use it in at least one H2.` : ""}`;
}

export function getStructureRules(ctx: PromptContext): string {
    // Intent-aware H2 blueprints — different reader goals need different content shapes
    const blueprints: Record<string, string> = {
        informational: `
- H2: What Is [keyword]? (answer directly in first sentence — no preamble)
- H2: Why [keyword] Matters in ${ctx.year} (name a specific trend, regulation, or data point)
- H2: How to [Do / Choose / Implement] [keyword] — Step by Step (numbered H3 steps with concrete actions)
- H2: Common [keyword] Mistakes to Avoid (H3 per mistake — name it, explain it, give the fix)
- H2: [keyword] Real-World Example (use first-hand example or [ADD YOUR DATA] — never invent)
- H2: Frequently Asked Questions About [keyword] (5–7 Q&A from People Also Ask — each answer starts Yes/No/number/named thing)`,

        commercial: `
- H2: What to Look For in [keyword] (criteria table with named attributes — not vague features)
- H2: [keyword] Options Compared (named tools/services with real differentiators — not "Option A vs B")
- H2: Who [keyword] Is Best For (audience segments with specific use cases)
- H2: [keyword] Pricing & Value (real price ranges from named providers — use [CHECK CURRENT PRICING] if unsure)
- H2: What to Avoid When Choosing [keyword] (specific red flags with reasons)
- H2: Frequently Asked Questions (5 questions from People Also Ask for buyer intent queries)`,

        transactional: `
- H2: What You Get (specific deliverables — features, inclusions, timelines)
- H2: How It Works (numbered steps from sign-up to result — 4–6 steps max)
- H2: Who This Is For (2–3 specific audience descriptions with pain points)
- H2: Results You Can Expect (use real case study or [ADD YOUR DATA] — never invent percentages)
- H2: Common Questions Before Buying (4–5 objection-busting Q&A)`,

        local: `
- H2: What Is [keyword] in [location]? (local context first — regulations, services, providers)
- H2: How to Find the Best [keyword] Near You (named evaluation criteria for the local market)
- H2: [keyword] Costs in [location] ${ctx.year} (real ranges from local providers or [ADD LOCAL PRICING])
- H2: Top [keyword] Options in [location] (named local providers if known — otherwise acknowledge gap)
- H2: What to Watch Out For (local-specific warnings — scams, unlicensed providers, contract traps)
- H2: Frequently Asked Questions (5 Q&A from local searches — include city/region name in questions)`,
    };

    const blueprint = blueprints[ctx.intent] ?? blueprints.informational;

    return `STRUCTURE:
- ONE H1 = the article title only. Primary keyword within first 60 characters of the H1.
- 5–8 H2 sections. Follow the intent blueprint below — deviate only with a specific reason.
- H3 subsections under each H2 where depth is needed.
- Answer the primary search intent in the FIRST 30% of the article — reader should get the core answer before scrolling halfway.
- TITLE-COUNT RULE: if the title contains a number, the content must contain exactly that many H3 items.
- Each section: what → why → how. Concrete, named examples beat abstract advice every time.
- Intro: exactly 3 sentences — (1) state the core problem with a specific detail, (2) your unique angle or position, (3) what the reader will learn. No "Welcome to" or "In this article" openers.
- FAQs MUST align to real People Also Ask queries for "${ctx.keyword}" — write them as actual searcher questions, not generic ones. Every FAQ answer must open with Yes / No / a number / a named tool or time frame.

INTENT BLUEPRINT (${ctx.intent ?? "informational"}):
${blueprint}`;
}

const PROMPT_INJECTION_RE = /(?:ignore\s+(?:previous|all|above)\s+instructions?|system\s*:|<\|im_start\|>|<\|im_end\|>|\[INST\]|<<SYS>>|<\|system\|>|\[SYSTEM\])/gi;

function sanitizeGrounding(text: string): string {
    return text.replace(PROMPT_INJECTION_RE, "[redacted]").slice(0, 1000);
}

export function getAuthorGrounding(author: AuthorProfile, ctx: PromptContext): string {
    if (!ctx.hasAuthorGrounding) return "";
    const parts: string[] = ["AUTHOR GROUNDING — weave these naturally into the content:"];
    if (author.realExperience) parts.push(`- Real experience: ${sanitizeGrounding(author.realExperience)}`);
    if (author.realNumbers)   parts.push(`- Real numbers / results: ${sanitizeGrounding(author.realNumbers)}`);
    if (author.localContext)  parts.push(`- Local / niche context: ${sanitizeGrounding(author.localContext)}`);
    return parts.join("\n");
}

export function getHumanizePrompt(content: string, ctx: PromptContext): string {
    return `You are a senior human editor. Rewrite the article below to sound like it was written by a confident practitioner, not an AI. The goal is zero detectable AI patterns and zero word repetition.

Keyword: "${ctx.keyword}"
Intent: ${ctx.intent}

HUMANIZATION RULES — apply every single one:
1. ACTIVE VOICE: Replace every passive construction with an active one.
   BAD: "The keyword should be included in the title."
   GOOD: "Put the keyword in the title."

2. SENTENCE LENGTH: Break any sentence over 28 words into two. Mix short (8–12 words), medium (13–20), and longer (21–28) sentences in alternating patterns. Never write more than two sentences of the same length category back-to-back.

3. OPENER VARIETY: Never start two consecutive sentences with the same word. Vary openers with: time phrases ("Three months in..."), numbers ("Two things to remember:"), named tools, contrasting conjunctions ("But", "Yet", "Still"), or action verbs.

4. REPETITION — this is the most important rule:
   - Scan each 150-word window. If any non-keyword content word appears more than 4 times, rephrase or use a pronoun/synonym.
   - Never refer to the same subject three times with the same noun in one paragraph. Use pronouns or restructure.
   BAD:  "The platform tracks your keywords. The platform also monitors backlinks. The platform sends weekly alerts."
   GOOD: "It tracks your keywords, monitors backlinks, and sends weekly alerts automatically."

5. BANNED PHRASES — replace all of these with plain language:
   In conclusion / It's worth noting / Furthermore / Moreover / Additionally /
   Delve into / Dive into / Leverage / Seamlessly / Comprehensive guide /
   Cutting-edge / Game-changing / Robust / Notably / In today's digital landscape /
   As we navigate / Now more than ever / When it comes to / In the realm of /
   It is important to / It is essential to / It is crucial to / Final thoughts /
   Key takeaways (remove unless followed by bullets) / To summarise / In summary /
   Unlock the potential / Drive engagement / Foster growth / Empower users.

6. CONTRACTIONS: Add natural contractions throughout — "you'll", "it's", "don't", "here's", "we've". At least one per paragraph.

7. OPINION SIGNALS: Each major section (H2) must contain at least one direct stance:
   - A contradiction: "Standard advice says X. In practice, Y works better."
   - A named exception: "This breaks when [condition] — do [Y] instead."
   - A practitioner note: "Most people miss this. Don't."

8. FAQ ANSWERS: Every FAQ answer must open with: Yes / No / a number / a tool name / a time frame. Never "It depends" or "Generally".

9. Return ONLY the rewritten HTML — no markdown fences, no commentary, no preamble.

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