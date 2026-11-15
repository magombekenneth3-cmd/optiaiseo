"use server";

import type { Prisma } from "@prisma/client";
import { requireTiers, guardErrorToResult } from "@/lib/stripe/guards";
import {
    consumeCredits,
    consumeCreditsIdempotent,
    refundCredits,
    refundCreditsIdempotent,
    CREDIT_COSTS,
} from "@/lib/credits";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/require-user";
import {
    getAiClient,
    buildBlogResponseSchema,
    GeminiBlogResponse,
    AuthorProfile,
    buildPost,
    evaluateDraftForPublication,
} from "@/lib/blog";
import { hasConfiguredAiProvider } from "@/lib/blog/ai-client";
import { callGeminiJson } from "@/lib/gemini/client";
import { buildPromptContext, cleanDomainToDisplayName } from "@/lib/blog/prompt-context";
import { fetchGSCDecayData, normaliseSiteUrl } from "@/lib/gsc";
import { revalidatePath } from "next/cache";
import { getUserGscToken } from "@/lib/gsc/token";
import { AI_MODELS } from "@/lib/constants/ai-models";
import * as cheerio from "cheerio";
import { classifySerpFormat, computeContentGaps, formatToPromptHint, getSerpContextForKeyword } from "@/lib/blog/serp";
import { proposeSingleBlogRefresh } from "@/lib/content/decay-to-mutation";
import { assertSafeAuditUrl, safeAuditFetch } from "@/lib/seo-audit/utils/fetch-html";
import {
    buildSurgicalRefreshPrompt,
    computeSurgicalRefreshSummary,
    derivePreservedSlug,
    isTargetUrlOnSiteDomain,
    type RefreshChangeSummary,
    type StoredRefreshMetadata,
} from "@/lib/content/surgical-refresh";

// Helpers

function isSsrfRejectionError(err: unknown): boolean {
    const message = ((err as Error)?.message ?? String(err)).toLowerCase();
    return (
        message.includes("blocked") ||
        message.includes("private") ||
        message.includes("internal") ||
        message.includes("loopback") ||
        message.includes("ssrf") ||
        message.includes("invalid url") ||
        message.includes("unsupported protocol")
    );
}

async function safeAuditFetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 2,
    delayMs = 1000
): Promise<Response> {
    await assertSafeAuditUrl(url);
    try {
        return await safeAuditFetch(url, options);
    } catch (err) {
        if (retries === 0 || isSsrfRejectionError(err)) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
        return safeAuditFetchWithRetry(url, options, retries - 1, delayMs * 2);
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

// ── Audit/Rank-based fallback when GSC isn't connected ───────────────────────

export interface DecayRiskRow {
    url: string;
    /** Confidence: "HIGH" = rank dropped ≥15%, "SIGNAL" = audit score declined */
    confidence: "HIGH" | "SIGNAL";
    /** What deteriorated: e.g. "Rank #8 → #23" or "Score 82 → 61" */
    signal: string;
    /** Numeric drop percentage (always positive) */
    dropPercentage: number;
    /** The value in the previous period */
    previousValue: number;
    /** The value in the latest period */
    currentValue: number;
    /** What the values represent */
    metric: "rank" | "auditScore";
}

async function getDecayFallbackData(siteId: string): Promise<DecayRiskRow[]> {
    const rows: DecayRiskRow[] = [];

    // ── 1. Rank snapshot deterioration (HIGH CONFIDENCE) ──────────────────
    // Find keywords where the latest position is ≥15% worse than the previous
    const rankSnapshots = await prisma.$queryRaw<
        { keyword: string; url: string; latestPos: number; previousPos: number }[]
    >`
        WITH ranked AS (
            SELECT
                keyword,
                url,
                position,
                ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY "recordedAt" DESC) AS rn
            FROM "RankSnapshot"
            WHERE "siteId" = ${siteId}
              AND url IS NOT NULL
              AND "recordedAt" > NOW() - INTERVAL '90 days'
        )
        SELECT
            a.keyword,
            a.url,
            a.position AS "latestPos",
            b.position AS "previousPos"
        FROM ranked a
        JOIN ranked b ON a.keyword = b.keyword AND b.rn = 2
        WHERE a.rn = 1
          AND b.position > 0
          AND a.position > b.position
          AND ((a.position - b.position)::float / b.position) >= 0.15
    `;

    for (const snap of rankSnapshots) {
        const drop = Math.round(((snap.latestPos - snap.previousPos) / snap.previousPos) * 100);
        rows.push({
            url: snap.url ?? `(keyword: ${snap.keyword})`,
            confidence: "HIGH",
            signal: `Rank #${snap.previousPos} → #${snap.latestPos}`,
            dropPercentage: drop,
            previousValue: snap.previousPos,
            currentValue: snap.latestPos,
            metric: "rank",
        });
    }

    // ── 2. Audit score deterioration (SIGNAL) ────────────────────────────
    const recentAudits = await prisma.audit.findMany({
        where: { siteId, deletedAt: null },
        orderBy: { runTimestamp: "desc" },
        take: 2,
        select: { id: true },
    });

    if (recentAudits.length >= 2) {
        const [latestAudit, previousAudit] = recentAudits;
        const [latestPages, previousPages] = await Promise.all([
            prisma.pageAudit.findMany({
                where: { auditId: latestAudit.id },
                select: { pageUrl: true, overallScore: true },
            }),
            prisma.pageAudit.findMany({
                where: { auditId: previousAudit.id },
                select: { pageUrl: true, overallScore: true },
            }),
        ]);

        const previousScoreMap = new Map(previousPages.map(p => [p.pageUrl, p.overallScore]));
        // Dedupe: skip URLs already covered by rank-drop data
        const rankUrls = new Set(rows.map(r => r.url));

        for (const page of latestPages) {
            if (rankUrls.has(page.pageUrl)) continue;
            const prevScore = previousScoreMap.get(page.pageUrl);
            if (prevScore == null || prevScore === 0) continue;
            const drop = Math.round(((prevScore - page.overallScore) / prevScore) * 100);
            if (drop > 0) {
                rows.push({
                    url: page.pageUrl,
                    confidence: drop >= 15 ? "HIGH" : "SIGNAL",
                    signal: `Score ${prevScore} → ${page.overallScore}`,
                    dropPercentage: drop,
                    previousValue: prevScore,
                    currentValue: page.overallScore,
                    metric: "auditScore",
                });
            }
        }
    }

    // Sort: HIGH first, then by drop severity
    rows.sort((a, b) => {
        if (a.confidence !== b.confidence) return a.confidence === "HIGH" ? -1 : 1;
        return b.dropPercentage - a.dropPercentage;
    });

    return rows;
}

// Actions

export async function getDecayingContent(siteId: string) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await prisma.site.findUnique({ where: { id: siteId, userId: user.id } });
        if (!site) return { success: false, error: "Site not found" };

        // Try GSC first
        try {
            const normalisedUrl = normaliseSiteUrl(site.domain);
            const accessToken = await getUserGscToken(user.id);
            const decayData = await fetchGSCDecayData(accessToken, normalisedUrl);
            return { success: true, data: decayData, source: "gsc" as const };
        } catch {
            // GSC not connected or failed — try audit-based fallback
            const fallback = await getDecayFallbackData(siteId);
            if (fallback.length > 0) {
                return { success: true, data: fallback, source: "audit" as const };
            }
            return {
                success: false,
                error: "Connect Google Search Console or run at least 2 audits to detect content decay.",
            };
        }
    } catch (error: unknown) {
        logger.error("Error fetching decaying content:", { error: (error as Error)?.message ?? String(error) });
        return { success: false, error: (error as Error).message ?? "Failed to fetch decaying content." };
    }
}

export interface RefreshExistingPageGapInput {
    siteId: string;
    targetUrl: string;
    keyword: string;
    clusterQueries?: string[];
    recommendedAction?: string;
    author?: {
        authorName?: string;
        authorRole?: string;
        authorBio?: string;
        realExperience?: string;
        realNumbers?: string;
        localContext?: string;
    };
    requestId?: string;
}

export interface RefreshActionResult {
    success: boolean;
    mode?: "CONTENT_REFRESH";
    code?: string;
    error?: string;
    generationSucceeded?: boolean;
    publicationReady?: boolean;
    status?: string;
    blog?: unknown;
    refreshSummary?: RefreshChangeSummary;
}

function safeRevalidate(path: string): void {
    try {
        revalidatePath(path);
    } catch {
        // Ignore outside Next.js request context (e.g. direct invocation in tests)
    }
}

async function createRefreshBlogRecord(params: {
    siteId: string;
    preservedSlug: string;
    preferSuffixedSlug: boolean;
    sourceUrl: string;
    title: string;
    targetKeywords: string[];
    content: string;
    metaDescription: string;
    status: string;
    validationScore: number;
    validationErrors: string[];
    validationWarnings: string[];
    requestId?: string;
    generationInput: StoredRefreshMetadata;
}) {
    const buildData = (slugValue: string) => ({
        siteId: params.siteId,
        pipelineType: "CONTENT_REFRESH",
        sourceUrl: params.sourceUrl,
        title: params.title,
        slug: slugValue,
        targetKeywords: params.targetKeywords,
        content: params.content,
        metaDescription: params.metaDescription,
        status: params.status,
        validationScore: params.validationScore,
        validationErrors: params.validationErrors,
        validationWarnings: params.validationWarnings,
        ...(params.requestId ? { generationRequestId: params.requestId } : {}),
        generationInput: params.generationInput as unknown as Prisma.InputJsonValue,
    });

    const fallbackSlug = `${params.preservedSlug.slice(0, 82)}-refresh-${Date.now().toString(36)}`;
    const initialSlug = params.preferSuffixedSlug ? fallbackSlug : params.preservedSlug;

    try {
        return await prisma.blog.create({ data: buildData(initialSlug) });
    } catch (err) {
        if ((err as { code?: string })?.code === "P2002" && !params.preferSuffixedSlug) {
            return await prisma.blog.create({ data: buildData(fallbackSlug) });
        }
        throw err;
    }
}

async function executeSurgicalPageRefresh(params: {
    sourceOperation: "content_decay" | "keyword_gap";
    siteId: string;
    url: string;
    keywords: string[];
    clusterQueries?: string[];
    recommendedAction?: string;
    authorInput?: RefreshExistingPageGapInput["author"];
    requestId?: string;
}): Promise<RefreshActionResult> {
    let debitedUserId: string | null = null;
    const idempotentCreditRef = params.requestId
        ? `refresh:${params.siteId}:${params.requestId}`
        : null;

    const refundChargedCredits = async (reason: string) => {
        if (!debitedUserId) return;
        const uid = debitedUserId;
        debitedUserId = null;
        try {
            if (idempotentCreditRef) {
                await refundCreditsIdempotent(
                    uid,
                    CREDIT_COSTS.blog_generation,
                    `refund:${idempotentCreditRef}`,
                    reason
                );
            } else {
                await refundCredits(uid, "blog_generation");
            }
        } catch (refundErr) {
            logger.warn("[ContentRefresh] Failed to refund credits after failure", {
                userId: uid,
                error: (refundErr as Error)?.message ?? String(refundErr),
            });
        }
    };

    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error as RefreshActionResult;
        const { user } = auth;

        try {
            await requireTiers(user.id, ["STARTER", "PRO", "AGENCY"]);
        } catch (err) {
            return guardErrorToResult(err) as RefreshActionResult;
        }

        const site = await prisma.site.findUnique({
            where: { id: params.siteId, userId: user.id },
        });
        if (!site) return { success: false, error: "Site not found" };

        if (!isTargetUrlOnSiteDomain(params.url, site.domain)) {
            return {
                success: false,
                code: "invalid_target_url",
                error: "Target URL must use HTTP(S) and belong to the selected site's domain.",
            };
        }

        try {
            await assertSafeAuditUrl(params.url);
        } catch (ssrfErr) {
            return {
                success: false,
                code: "ssrf_blocked",
                error: (ssrfErr as Error)?.message || "Target URL failed security validation.",
            };
        }

        if (params.requestId) {
            const existingRequestBlog = await prisma.blog.findFirst({
                where: { siteId: site.id, generationRequestId: params.requestId },
            });
            if (existingRequestBlog) {
                const storedMeta = existingRequestBlog.generationInput as StoredRefreshMetadata | null;
                return {
                    success: true,
                    mode: "CONTENT_REFRESH",
                    generationSucceeded: true,
                    publicationReady: existingRequestBlog.status === "DRAFT",
                    status: existingRequestBlog.status,
                    blog: existingRequestBlog,
                    refreshSummary: storedMeta?.refreshSummary,
                };
            }
        }

        const ai = getAiClient();
        if (!ai && !hasConfiguredAiProvider()) {
            return { success: false, error: "Gemini AI is not configured." };
        }

        const creditResult = idempotentCreditRef
            ? await consumeCreditsIdempotent(user.id, "blog_generation", idempotentCreditRef)
            : await consumeCredits(user.id, "blog_generation");
        if (!creditResult.allowed) {
            const reason = creditResult.reason === "credits_locked" ? "credits_locked" : "insufficient_credits";
            return {
                success: false,
                code: reason,
                error:
                    reason === "credits_locked"
                        ? "Your credits are locked. Resubscribe or buy a credit pack to unlock them."
                        : `Not enough credits (${creditResult.remaining} remaining, need ${creditResult.cost || 10}). Buy a credit pack or upgrade your plan.`,
            };
        }
        debitedUserId = user.id;

        let pageRes: Response;
        try {
            pageRes = await safeAuditFetchWithRetry(params.url, {
                headers: { "User-Agent": "SEOTool-Bot/1.0" },
                signal: AbortSignal.timeout(10_000),
            });
        } catch (fetchErr) {
            await refundChargedCredits("Target page fetch blocked or failed");
            return {
                success: false,
                code: isSsrfRejectionError(fetchErr) ? "ssrf_blocked" : "scrape_failed",
                error: (fetchErr as Error)?.message || "Failed to safely fetch target page.",
            };
        }

        if (!pageRes.ok) {
            await refundChargedCredits(`Target page returned HTTP ${pageRes.status}`);
            return {
                success: false,
                code: "scrape_failed",
                error: `Failed to scrape URL: ${pageRes.status}`,
            };
        }

        const html = await pageRes.text();
        const extractedText = extractStructuredContent(html, 70);

        const urlSlugCandidate = derivePreservedSlug(params.url);
        const existingBlog = await prisma.blog.findFirst({
            where: {
                siteId: site.id,
                deletedAt: null,
                OR: [
                    { sourceUrl: params.url },
                    { wordPressUrl: params.url },
                    { ghostUrl: params.url },
                    ...(urlSlugCandidate ? [{ slug: urlSlugCandidate }] : []),
                ],
            },
            select: { id: true, slug: true, status: true },
        });
        if (existingBlog?.status === "PUBLISHED") {
            proposeSingleBlogRefresh(existingBlog.id, user.id).catch((err) =>
                logger.warn("[ContentDecay] Failed to propose BLOG_REFRESH mutation", {
                    blogId: existingBlog.id,
                    error: (err as Error)?.message,
                })
            );
        }

        const primaryKeyword = params.keywords[0]?.trim() || "content refresh";
        const clusterQueries = Array.from(
            new Set((params.clusterQueries ?? []).map((q) => q.trim()).filter(Boolean))
        );
        const preservedSlug = derivePreservedSlug(params.url, existingBlog?.slug, primaryKeyword);

        const serpContext = await getSerpContextForKeyword(primaryKeyword, true);
        const formatSignal = serpContext ? classifySerpFormat(serpContext.results) : null;
        const formatHint = formatSignal ? formatToPromptHint(formatSignal, primaryKeyword) : "";
        const gaps = serpContext
            ? computeContentGaps(serpContext.results)
            : { commonTopics: [], gapTopics: [] };

        const intent = detectIntent(primaryKeyword);

        const authorProfile: AuthorProfile = {
            name: params.authorInput?.authorName?.trim() || cleanDomainToDisplayName(site.domain),
            role: params.authorInput?.authorRole?.trim() || undefined,
            bio: params.authorInput?.authorBio?.trim() || undefined,
            realExperience: params.authorInput?.realExperience?.trim() || undefined,
            realNumbers: params.authorInput?.realNumbers?.trim() || undefined,
            localContext: params.authorInput?.localContext?.trim() || undefined,
        };

        const ctx = buildPromptContext({
            keyword: primaryKeyword,
            category: primaryKeyword,
            intent,
            hasAuthorGrounding: Boolean(authorProfile.realExperience || authorProfile.realNumbers),
            displayName: cleanDomainToDisplayName(site.domain),
            siteDomain: site.domain,
        });

        const gapSection =
            gaps.commonTopics.length > 0 || gaps.gapTopics.length > 0
                ? `CONTENT GAP ANALYSIS:
- Table-stakes topics (every competitor covers these — you must too): ${gaps.commonTopics.join(", ") || "none identified"}
- Underserved gap topics (differentiate by going deeper here): ${gaps.gapTopics.join(", ") || "none identified"}`
                : "";

        const serpSection = serpContext
            ? serpContext.formattedContext
            : "No live SERP data available. Rely on your training knowledge for competitor context.";
        const serpContextSummary = [serpSection, gapSection, formatHint].filter(Boolean).join("\n\n");

        const currentYear = new Date().getFullYear();
        const prompt =
            params.sourceOperation === "keyword_gap"
                ? buildSurgicalRefreshPrompt({
                      keyword: primaryKeyword,
                      targetUrl: params.url,
                      preservedSlug,
                      siteDomain: site.domain,
                      recommendedAction: params.recommendedAction,
                      clusterQueries,
                      extractedOriginal: extractedText,
                      serpContextSummary,
                      author: authorProfile,
                      currentYear,
                  })
                : `You are an elite SEO Content Strategist. Your task is to rescue a piece of "Decaying Content" — a blog post rapidly losing Google traffic — and rewrite it surgically to rank #1 in ${currentYear}.

ORIGINAL URL: ${params.url}
PRESERVED SLUG (MUST REMAIN IDENTICAL): ${preservedSlug}
TARGET KEYWORDS: ${params.keywords.join(", ")}
DETECTED INTENT: ${intent}

━━━ ORIGINAL CONTENT ━━━
${extractedText}

━━━ LIVE SERP INTELLIGENCE ━━━
${serpSection}

${gapSection}

${formatHint}

━━━ REWRITE INSTRUCTIONS ━━━
Your rewrite must be objectively better than every page currently ranking while preserving the canonical target of "${preservedSlug}". Apply these rules without exception:

1. FRESHNESS: Update the post explicitly for ${currentYear}. Modernise any outdated concepts, statistics, or tool references.
2. FEATURED SNIPPET TRAP: Write a punchy 40–60 word direct answer immediately after the H1, structured to win the featured snippet.
3. COVER ALL TABLE-STAKES TOPICS: Every topic in the "common topics" list above must appear in your rewrite.
4. EXPLOIT GAPS: Go substantially deeper on "gap topics" — this is where you beat competitors.
5. ANSWER PAA QUESTIONS: Every "People Also Ask" question from the SERP data must be answered, either inline or in the FAQ.
6. INTENT-MATCHED TONE: Intent is "${intent}". Adjust tone, CTAs, and structure accordingly.
7. SKIMMABILITY: Use H2s, H3s, bullet points, and short paragraphs. No wall-of-text sections.
8. ZERO FLUFF: Cut any sentence that doesn't add information or move the reader forward.

STRICT STRUCTURAL REQUIREMENTS:
- Keep slug strictly equal to "${preservedSlug}"
- Exactly one H1
- At least 5 H2 sections
- At least 3 H3 subsections
- One comparison or summary table if the topic involves tools, products, or options
- An FAQ section with 3–5 questions drawn from PAA data
- Each section must add information not present in the original content

Generate the fully modernised, refreshed version of this post now.`;

        let parsedResponse: GeminiBlogResponse;
        if (ai) {
            try {
                const response = await ai.models.generateContent({
                    model: AI_MODELS.GEMINI_FLASH,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: buildBlogResponseSchema(ctx),
                    },
                });
                if (!response.text) throw new Error("AI returned empty content.");
                parsedResponse = JSON.parse(response.text) as GeminiBlogResponse;
            } catch {
                parsedResponse = await callGeminiJson<GeminiBlogResponse>(
                    `${prompt}\n\nRespond ONLY with valid JSON containing keys: title, slug, metaDescription, content, targetKeywords, faqItems.`,
                    { model: AI_MODELS.GEMINI_FLASH, maxOutputTokens: 8192, timeoutMs: 60000 }
                );
            }
        } else {
            parsedResponse = await callGeminiJson<GeminiBlogResponse>(
                `${prompt}\n\nRespond ONLY with valid JSON containing keys: title, slug, metaDescription, content, targetKeywords, faqItems.`,
                { model: AI_MODELS.GEMINI_FLASH, maxOutputTokens: 8192, timeoutMs: 60000 }
            );
        }

        // Preserve canonical target slug regardless of any alternate slug the model emits
        parsedResponse.slug = preservedSlug;

        const rawRefreshedMarkdown = parsedResponse.content;
        parsedResponse.content = `> **${currentYear} Content Refresh:** This guide has been surgically updated for current SEO & AI-search intent while preserving the target page slug (\`${preservedSlug}\`).\n\n${rawRefreshedMarkdown}`;

        const draft = await buildPost(parsedResponse, authorProfile, ctx, site.id);
        const { publicationGate } = await evaluateDraftForPublication(draft, serpContext);

        const refreshSummary = computeSurgicalRefreshSummary({
            targetUrl: params.url,
            preservedSlug,
            originalContent: extractedText,
            refreshedContent: draft.contentMarkdown || rawRefreshedMarkdown || draft.content,
            clusterQueries,
            recommendedAction: params.recommendedAction,
        });

        const mergedKeywords = Array.from(
            new Set([
                ...params.keywords,
                ...clusterQueries,
                ...(draft.targetKeywords ?? []),
            ].map((k) => k.trim()).filter(Boolean))
        ).slice(0, 12);

        const storedMeta: StoredRefreshMetadata = {
            mode: "CONTENT_REFRESH",
            sourceOperation: params.sourceOperation,
            targetUrl: params.url,
            preservedSlug,
            recommendedAction: params.recommendedAction,
            clusterQueries,
            originalExtractedContent: extractedText.slice(0, 12000),
            refreshSummary,
        };

        const blog = await createRefreshBlogRecord({
            siteId: site.id,
            preservedSlug,
            preferSuffixedSlug: existingBlog?.slug === preservedSlug,
            sourceUrl: params.url,
            title: `[REFRESH] ${draft.title}`,
            targetKeywords: mergedKeywords.length > 0 ? mergedKeywords : draft.targetKeywords,
            content: draft.content,
            metaDescription: draft.metaDescription,
            status: publicationGate.status,
            validationScore: draft.validationScore,
            validationErrors: [...draft.validationErrors, ...publicationGate.blockingIssues],
            validationWarnings: [...draft.validationWarnings, ...publicationGate.warnings],
            requestId: params.requestId,
            generationInput: storedMeta,
        });

        safeRevalidate("/dashboard/refresh");
        safeRevalidate("/dashboard/blogs");

        return {
            success: true,
            mode: "CONTENT_REFRESH",
            generationSucceeded: true,
            publicationReady: publicationGate.status === "DRAFT",
            status: publicationGate.status,
            blog,
            refreshSummary,
        };
    } catch (error: unknown) {
        await refundChargedCredits("Unexpected error during surgical page refresh");
        logger.error("Error refreshing content:", { error: (error as Error)?.message ?? String(error) });
        return { success: false, error: (error as Error).message ?? "Failed to refresh content via AI." };
    }
}

export async function refreshDecayingContent(
    siteId: string,
    url: string,
    keywords: string[] = []
) {
    return executeSurgicalPageRefresh({
        sourceOperation: "content_decay",
        siteId,
        url,
        keywords,
    });
}

export async function refreshExistingPageFromGap(input: RefreshExistingPageGapInput) {
    const cleanKeyword = input.keyword.trim();
    const keywords = [cleanKeyword, ...(input.clusterQueries ?? [])].filter(Boolean);
    return executeSurgicalPageRefresh({
        sourceOperation: "keyword_gap",
        siteId: input.siteId,
        url: input.targetUrl,
        keywords,
        clusterQueries: input.clusterQueries,
        recommendedAction: input.recommendedAction,
        authorInput: input.author,
        requestId: input.requestId,
    });
}
