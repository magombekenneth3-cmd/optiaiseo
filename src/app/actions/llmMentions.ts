"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redis } from "@/lib/redis";
import { callGemini } from "@/lib/gemini";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { inngest } from "@/lib/inngest/client";
import { checkRateLimit, checkAeoLimit } from "@/lib/rate-limit";
import { getEffectiveTier } from "@/lib/stripe/guards";
import { extractBrandIdentity, type BrandIdentity } from "@/lib/aeo/brand-utils";
import { z } from "zod";

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);

export type AeoCategory =
    | "brand_authority"
    | "topic_coverage"
    | "faq_readiness"
    | "competitor_comparison"
    | "how_to_guidance"
    | "geo_recommendation"
    | "aio_brand";

export interface AeoCategoryScore {
    category: AeoCategory;
    label: string;
    score: number;
    queriesRun: number;
    cited: number;
}

export interface AeoQueryResult {
    query: string;
    category: AeoCategory;
    cited: boolean;
    directAnswer: boolean;
    excerpt: string;
}

export interface LlmMentionResult {
    siteId: string;
    domain: string;
    mentionCount: number;
    totalQueries: number;
    mentionRate: number;
    categoryScores: AeoCategoryScore[];
    grade: "A" | "B" | "C" | "D" | "F";
    queriesTested: string[];
    mentionedInQueries: string[];
    responses: AeoQueryResult[];
    recommendations: string[];
    scannedAt: Date;
}

interface AeoBatchedResponse {
    brandRecognized: boolean;
    industry: string;
    services: string;
    geography: string;
    legitimacyConfirmed: boolean;
    competitorAwareness: boolean;
    sampleQueries: string[];
    confidence: number;
}

interface BrandBenchmarks {
    brandRecognized: boolean;
    industryKnown: boolean;
    servicesKnown: boolean;
    geographyKnown: boolean;
    legitimacyConfirmed: boolean;
    competitorAwareness: boolean;
    confidence: number;
    benchmarkScore: number;
    excerpt: string;
    raw: AeoBatchedResponse;
}

export async function extractBrandFromDomain(domain: string): Promise<string> {
    const clean = domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split("/")[0];
    const parts = clean.split(".");
    if (parts.length === 1) return parts[0];
    const hostingPlatforms = ["vercel", "netlify", "fly", "herokuapp", "railway", "render", "pages", "github", "gitlab", "amplifyapp", "azurewebsites", "cloudfront", "workers"];
    if (parts.length >= 3 && hostingPlatforms.includes(parts[parts.length - 2])) return parts[0];
    const tld2 = ["co", "com", "org", "net", "edu", "gov", "ac"];
    if (parts.length >= 3 && tld2.includes(parts[parts.length - 2])) return parts[parts.length - 3] || parts[0];
    return parts[parts.length - 2];
}

function makeAeoCacheKey(domain: string, siteKeywords: string[]): string {
    const keywordsStr = siteKeywords.slice(0, 3).sort().join(",");
    const hash = Buffer.from(`${domain}:${keywordsStr}`).toString("base64").slice(0, 24);
    return `aeo:mentions:${hash}`;
}

async function callBatchedAeoPrompt(identity: BrandIdentity, domain: string): Promise<AeoBatchedResponse | null> {
    // Use Google Search grounding so the scan reflects live web knowledge —
    // the same data source users see on gemini.google.com — not frozen training data.
    const prompt = `Search the web for "${identity.displayName}" (${domain}) and answer based on what you find online.

Answer ALL of the following about this brand in a single JSON object. Do not include any text outside the JSON.

{
  "brandRecognized": boolean,
  "industry": string,
  "services": string,
  "geography": string,
  "legitimacyConfirmed": boolean,
  "competitorAwareness": boolean,
  "sampleQueries": string[],
  "confidence": number
}`;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const result = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: prompt,
            config: {
                temperature: 0.1,
                tools: [{ googleSearch: {} }],
                // Note: responseMimeType cannot be combined with googleSearch grounding
            },
        });
        const raw = result.text?.trim() ?? "";
        const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
        // Extract the JSON object from the response (grounding may add surrounding text)
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON object found in grounded response");
        return JSON.parse(jsonMatch[0]) as AeoBatchedResponse;
    } catch (e) {
        logger.warn("[AEO] Batched Gemini grounded call failed, falling back to base model", { error: e });
        // Fallback: plain callGemini without grounding
        try {
            const fallbackPrompt = `You are a brand intelligence researcher.

Brand Name: "${identity.displayName}"
Also known as: ${identity.variants.slice(0, 4).join(", ")}
Website: ${domain}

Answer ALL of the following in a single JSON object. Do not include any text outside the JSON.

{
  "brandRecognized": boolean,
  "industry": string,
  "services": string,
  "geography": string,
  "legitimacyConfirmed": boolean,
  "competitorAwareness": boolean,
  "sampleQueries": string[],
  "confidence": number
}`;
            const raw = await callGemini(fallbackPrompt, {
                maxOutputTokens: 300,
                temperature: 0.1,
                timeoutMs: 20_000,
            }) ?? "";
            const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
            return JSON.parse(cleaned) as AeoBatchedResponse;
        } catch (e2) {
            logger.warn("[AEO] Fallback Gemini call also failed", { error: e2 });
            return null;
        }
    }
}

function buildBenchmarks(parsed: AeoBatchedResponse | null, domain: string): BrandBenchmarks {
    const p: AeoBatchedResponse = parsed ?? {
        brandRecognized: false,
        industry: "",
        services: "",
        geography: "",
        legitimacyConfirmed: false,
        competitorAwareness: false,
        sampleQueries: [],
        confidence: 0,
    };

    const industryKnown = p.industry.length > 3;
    const servicesKnown = p.services.length > 3;
    const geographyKnown = p.geography.length > 3;

    const weights = {
        brandRecognized: 0.30,
        industryKnown: 0.20,
        servicesKnown: 0.20,
        geographyKnown: 0.10,
        legitimacyConfirmed: 0.10,
        competitorAwareness: 0.10,
    };

    const rawScore =
        (p.brandRecognized ? weights.brandRecognized : 0) +
        (industryKnown ? weights.industryKnown : 0) +
        (servicesKnown ? weights.servicesKnown : 0) +
        (geographyKnown ? weights.geographyKnown : 0) +
        (p.legitimacyConfirmed ? weights.legitimacyConfirmed : 0) +
        (p.competitorAwareness ? weights.competitorAwareness : 0);

    const confidenceMultiplier = 0.9 + (p.confidence * 0.1);
    const benchmarkScore = Math.round(rawScore * confidenceMultiplier * 100);

    const excerpt = [p.industry, p.services, p.geography]
        .filter(Boolean)
        .join(". ")
        .slice(0, 160)
        .trim();

    return {
        brandRecognized: p.brandRecognized,
        industryKnown,
        servicesKnown,
        geographyKnown,
        legitimacyConfirmed: p.legitimacyConfirmed,
        competitorAwareness: p.competitorAwareness,
        confidence: p.confidence,
        benchmarkScore,
        excerpt: excerpt || `No AI knowledge found for ${domain}`,
        raw: p,
    };
}

function buildBenchmarkRecommendations(bm: BrandBenchmarks, brand: string): string[] {
    const recs: string[] = [];
    if (!bm.brandRecognized) {
        recs.push(`AI models don't recognise "${brand}" — publish an About page, earn press mentions, and add Organization schema to build training-data presence.`);
    }
    if (!bm.industryKnown) {
        recs.push("Define your industry clearly on your homepage and About page using @type: Organization schema with industry fields.");
    }
    if (!bm.servicesKnown) {
        recs.push("Make your core services explicit in page copy and JSON-LD schema. AI models cite sites that clearly state what they offer.");
    }
    if (!bm.geographyKnown) {
        recs.push("Add location context to your homepage (city, country, market). Use LocalBusiness schema if applicable.");
    }
    if (!bm.legitimacyConfirmed) {
        recs.push("Build trust signals: Privacy Policy, Contact page, SSL, and authoritative directory listings.");
    }
    if (bm.benchmarkScore >= 80) {
        recs.push("Strong AI brand recognition — maintain it by publishing consistently and monitoring brand mentions monthly.");
    }
    recs.push("Ensure your site has Organization, WebSite, and BreadcrumbList schema — the baseline signals AI parsers prioritize.");
    return recs.slice(0, 5);
}

function buildGraduatedCategoryScores(bm: BrandBenchmarks): AeoCategoryScore[] {
    const c = Math.max(bm.confidence, 0.1);
    const graduated = (flag: boolean, weight: number): number =>
        flag ? Math.round(Math.min(c * weight * 100, 100)) : 0;

    return [
        {
            category: "brand_authority",
            label: "Brand Recognized",
            score: graduated(bm.brandRecognized, 1 / 0.30),
            queriesRun: 1,
            cited: bm.brandRecognized ? 1 : 0,
        },
        {
            category: "topic_coverage",
            label: "Industry / Category Known",
            score: graduated(bm.industryKnown, 1 / 0.20),
            queriesRun: 1,
            cited: bm.industryKnown ? 1 : 0,
        },
        {
            category: "faq_readiness",
            label: "Services Identified",
            score: graduated(bm.servicesKnown, 1 / 0.20),
            queriesRun: 1,
            cited: bm.servicesKnown ? 1 : 0,
        },
        {
            category: "geo_recommendation",
            label: "Geography / Market Known",
            score: graduated(bm.geographyKnown, 1 / 0.10),
            queriesRun: 1,
            cited: bm.geographyKnown ? 1 : 0,
        },
        {
            category: "aio_brand",
            label: "Legitimacy Confirmed",
            score: graduated(bm.legitimacyConfirmed, 1 / 0.10),
            queriesRun: 1,
            cited: bm.legitimacyConfirmed ? 1 : 0,
        },
        {
            category: "competitor_comparison",
            label: "Competitor Landscape Known",
            score: graduated(bm.competitorAwareness, 1 / 0.10),
            queriesRun: 1,
            cited: bm.competitorAwareness ? 1 : 0,
        },
    ];
}

export async function executeLlmQueries(
    domain: string,
    siteKeywords: string[],
    bypassCache = false,
    brandNameOverride?: string | null,
) {
    const cacheKey = makeAeoCacheKey(domain, siteKeywords.slice(0, 3));

    if (!bypassCache) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                logger.debug(`[AEO Cache] HIT for ${domain}`);
                return typeof cached === "string" ? JSON.parse(cached) : cached;
            }
        } catch (e) {
            logger.warn("[AEO Cache] Redis read failed, proceeding with fresh query", { error: e });
        }
    }

    const identity = extractBrandIdentity(domain, brandNameOverride);
    const parsed = await callBatchedAeoPrompt(identity, domain);
    const bm = buildBenchmarks(parsed, domain);
    const recommendations = buildBenchmarkRecommendations(bm, identity.displayName);
    const categoryScores = buildGraduatedCategoryScores(bm);

    const mentionRate = bm.benchmarkScore;
    const grade =
        mentionRate >= 80 ? "A" :
        mentionRate >= 60 ? "B" :
        mentionRate >= 40 ? "C" :
        mentionRate >= 20 ? "D" : "F";

    const batchedPromptText = `What is ${identity.displayName}? (${domain})`;

    const brandDisplayName = identity.displayName;
    const benchmarkChecks = [
        { id: "brand_recognized", label: "Brand Recognized by AI", passed: bm.brandRecognized, detail: bm.brandRecognized ? `AI knows "${brandDisplayName}"` : `AI has no knowledge of "${brandDisplayName}"` },
        { id: "industry_known", label: "Industry / Category Known", passed: bm.industryKnown, detail: bm.industryKnown ? `Industry: ${bm.raw.industry}` : "AI couldn't identify the industry" },
        { id: "services_known", label: "Services Identified", passed: bm.servicesKnown, detail: bm.servicesKnown ? `Services: ${bm.raw.services}` : "AI couldn't describe services" },
        { id: "geography_known", label: "Geography / Market Known", passed: bm.geographyKnown, detail: bm.geographyKnown ? `Market: ${bm.raw.geography}` : "AI didn't mention geography" },
        { id: "legitimacy_confirmed", label: "Recognized as Legitimate", passed: bm.legitimacyConfirmed, detail: bm.legitimacyConfirmed ? "AI treats brand as legitimate" : "AI has insufficient data to confirm legitimacy" },
        { id: "competitor_aware", label: "Competitor Landscape Known", passed: bm.competitorAwareness, detail: bm.competitorAwareness ? "AI can place brand in competitive landscape" : "AI can't identify competitors" },
    ];

    const result = {
        mentionRate,
        grade,
        recommendations,
        confidence: bm.confidence,
        checks: {
            mentionCount: benchmarkChecks.filter(c => c.passed).length,
            totalQueries: 1,
            mentionedInQueries: bm.brandRecognized ? [batchedPromptText] : [],
            queriesTested: [batchedPromptText],
            responses: [{
                query: batchedPromptText,
                category: "aio_brand" as AeoCategory,
                cited: bm.brandRecognized,
                directAnswer: bm.brandRecognized,
                excerpt: bm.excerpt,
            }],
            categoryScores,
            benchmarkChecks,
            aiExcerpt: bm.excerpt,
            sampleQueries: bm.raw.sampleQueries ?? [],
        },
    };

    try {
        const ttl =
            mentionRate >= 80 ? 172_800 :
            mentionRate < 30 ? 21_600 :
            86_400;

        await redis.set(cacheKey, JSON.stringify(result), { ex: ttl });
        logger.debug(`[AEO Cache] Stored result for ${domain} (TTL ${ttl}s, score ${mentionRate})`);
    } catch (e) {
        logger.warn("[AEO Cache] Redis write failed", { error: e });
    }

    return result;
}

export async function checkLlmMentions(
    siteId: string
): Promise<{ success: true; reportId: string } | { success: false; error: string }> {
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, subscriptionTier: true },
        });
        if (!user) return { success: false, error: "User not found" };

        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: user.id },
            select: { id: true, domain: true, targetKeyword: true, brandName: true },
        });
        if (!site) return { success: false, error: "Site not found" };

        if (!process.env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured." };
        }

        const effectiveTier = await getEffectiveTier(user.id);
        const tierCheck = await checkAeoLimit(user.id, effectiveTier);
        if (!tierCheck.allowed) {
            return {
                success: false,
                error: `Monthly AEO scan limit reached. Resets on ${tierCheck.resetAt.toLocaleDateString()}.`,
            };
        }

        const recentReport = await prisma.aeoReport.findFirst({
            where: {
                siteId: site.id,
                status: "COMPLETED",
                score: { gt: 0 }, // Never reuse a zero-score report — brand detection may have failed
                createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (recentReport) {
            logger.debug(`[AEO] Short-circuiting — fresh non-zero completed report exists for ${site.domain}`);
            return { success: true, reportId: recentReport.id };
        }

        const burstCheck = await checkRateLimit(`aeo-check:${siteId}`, 5, 86400);
        if (!burstCheck.allowed) {
            return { success: false, error: "You have reached the daily limit of 5 AEO checks for this site." };
        }

        const siteKeywords: string[] = (site as typeof site & { targetKeyword?: string }).targetKeyword
            ? [(site as typeof site & { targetKeyword?: string }).targetKeyword as string]
            : [];

        const report = await prisma.aeoReport.create({
            data: {
                siteId: site.id,
                grade: "-",
                score: 0,
                citationScore: 0,
                schemaTypes: [],
                checks: { status: "AEO scan running in the background — typically 1–2 minutes." },
                topRecommendations: ["Scan in progress…"],
                status: "PENDING",
            },
            select: { id: true },
        });

        try {
            await inngest.send({
                name: "aeo.rank.run",
                data: { siteId: site.id, reportId: report.id, domain: site.domain, keywords: siteKeywords, brandName: site.brandName ?? undefined },
            });
            return { success: true, reportId: report.id };
        } catch (inngestErr) {
            logger.warn("[AEO] Inngest unavailable — running directly", { error: inngestErr });

            const alreadyDone = await prisma.aeoReport.findUnique({
                where: { id: report.id },
                select: { status: true },
            });
            if (alreadyDone?.status === "COMPLETED") return { success: true, reportId: report.id };

            try {
                const result = await executeLlmQueries(site.domain, siteKeywords, true, site.brandName);
                await prisma.aeoReport.update({
                    where: { id: report.id },
                    data: {
                        status: "COMPLETED",
                        score: result.mentionRate,
                        grade: result.grade,
                        citationScore: result.mentionRate,
                        topRecommendations: result.recommendations,
                        schemaTypes: [],
                        checks: result.checks as object,
                    },
                });
                return { success: true, reportId: report.id };
            } catch (directError) {
                const errMsg = (directError as Error)?.message ?? "";
                const isQuota = /quota|rate.limit|resource.exhausted|429|GEMINI_QUOTA/i.test(errMsg);
                await prisma.aeoReport.update({
                    where: { id: report.id },
                    data: { status: "FAILED", grade: "F" },
                });
                logger.error("[AEO] Direct fallback failed", { error: directError });
                return {
                    success: false,
                    error: isQuota
                        ? "Gemini API quota exceeded. Please wait a few minutes and try again."
                        : "AEO check failed. Verify your GEMINI_API_KEY.",
                };
            }
        }
    } catch (error) {
        logger.error("[AEO] checkLlmMentions failed", { error });
        return { success: false, error: "Failed to queue AEO check." };
    }
}

type PrismaAeoReport = NonNullable<Awaited<ReturnType<typeof prisma.aeoReport.findFirst>>>;
type SiteWithReport = {
    site: {
        id: string;
        domain: string;
        createdAt: Date;
        targetKeyword: string | null;
    };
    latest: (PrismaAeoReport & { scoreDelta: number }) | null;
};

export async function getAllSitesWithMentions(): Promise<{ success: boolean; sites: SiteWithReport[] }> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, sites: [] };

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true },
        });
        if (!user) return { success: false, sites: [] };

        const sites = await prisma.site.findMany({
            where: { userId: user.id },
            select: { id: true, domain: true, createdAt: true, targetKeyword: true },
            orderBy: { createdAt: "desc" },
        });
        if (!sites.length) return { success: true, sites: [] };

        const siteIds = sites.map((s) => s.id);

        const allReports = await prisma.aeoReport.findMany({
            where: {
                siteId: { in: siteIds },
                status: "COMPLETED",
                NOT: { grade: { in: ["Pending", "-"] } },
            },
            orderBy: { createdAt: "desc" },
        });

        const reportsBySite = new Map<string, PrismaAeoReport[]>();
        for (const report of allReports) {
            const existing = reportsBySite.get(report.siteId) ?? [];
            if (existing.length < 2) {
                reportsBySite.set(report.siteId, [...existing, report]);
            }
        }

        const sitesWithData: SiteWithReport[] = sites.map((site) => {
            const [latest, previous] = reportsBySite.get(site.id) ?? [];
            const scoreDelta = latest && previous ? latest.score - previous.score : 0;
            return {
                site,
                latest: latest ? { ...latest, scoreDelta } : null,
            };
        });

        return { success: true, sites: sitesWithData };
    } catch (error) {
        logger.error("[AEO] getAllSitesWithMentions failed", { error });
        return { success: false, sites: [] };
    }
}
// ── AEO Score Trend ──────────────────────────────────────────────────────────
// Returns up to 12 historical AeoReport scores for a site so the UI can
// render a trend sparkline. No new schema needed — reuses existing AeoReport.

export interface AeoTrendPoint {
    date:         string; // ISO date string
    score:        number;
    citationScore: number;
    grade:        string;
}

export async function getAeoScoreTrend(siteId: string): Promise<{
    success: boolean;
    trend?: AeoTrendPoint[];
    error?: string;
}> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, error: "Not authenticated" };

        // Verify site ownership
        const site = await prisma.site.findFirst({
            where: { id: siteId, userId: session.user.id },
            select: { id: true },
        });
        if (!site) return { success: false, error: "Site not found" };

        const reports = await prisma.aeoReport.findMany({
            where: { siteId, status: "COMPLETED" },
            orderBy: { createdAt: "asc" },
            take: 12,
            select: {
                score: true,
                citationScore: true,
                grade: true,
                createdAt: true,
            },
        });

        const trend: AeoTrendPoint[] = reports.map(r => ({
            date:          r.createdAt.toISOString(),
            score:         r.score,
            citationScore: r.citationScore,
            grade:         r.grade,
        }));

        return { success: true, trend };
    } catch (error) {
        logger.error("[AEO] getAeoScoreTrend failed", { error });
        return { success: false, error: "Failed to load trend data" };
    }
}
