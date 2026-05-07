import { logger } from "@/lib/logger";
import { extractBrandIdentity } from "@/lib/aeo/brand-utils";
import { GoogleGenAI } from "@google/genai";
import { auditMultiModelMentions, MentionResult } from "./multi-model";
import { verifyBrandFacts, FactCheck } from "./fact-verification";
import { saveAeoSnapshot } from "./snapshots";
import { checkGoogleAIOverview } from "./google-aio-check";
import { detectSchemaGaps } from "./schema-gaps";
import { diagnoseAeoData, MentionRecord, AeoDiagnosis } from "./diagnosis";
import { prisma } from "@/lib/prisma";
import { cachedQuestions } from "./response-cache";
import { isSafeUrl } from "@/lib/security/safe-url";
import {
    GEMINI_3_FLASH,
    GEMINI_3_1_PRO,
    GEMINI_2_5_FLASH,
    GEMINI_2_5_PRO,
    GEMINI_2_0_FLASH,
    GEMINI_2_0_PRO
} from "@/lib/constants/ai-models";



export interface AeoCheck {
    id: string
    category: "schema" | "eeat" | "content" | "technical" | "citation" | "geo" | "aio"
    label: string
    passed: boolean
    impact: "high" | "medium" | "low"
    detail: string
    recommendation: string
}

export interface AeoResult {
    url: string
    score: number
    grade: "A" | "B" | "C" | "D" | "F"
    checks: AeoCheck[]
    schemaTypes: string[]
    schemaGaps?: string[]
    citationScore: number
    multiEngineScore?: {
        perplexity: number
        chatgpt: number
        googleAio: number
        claude?: number
    }
    generativeShareOfVoice: number // 0-100
    citationLikelihood: number // 0-100 (Predictive)
    multiModelResults: MentionResult[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelCitationResults?: any
    factCheckResults?: FactCheck[]
    topRecommendations: string[]
    scannedAt: Date
    missingIntegrations?: string[]
    layerScores?: { aeo: number; geo: number; aio: number }
    
    diagnosis: AeoDiagnosis | null
}

// =============================================================================
// HELPERS
// =============================================================================

/** Computes a 0-100 score for a subset of check categories */
const computeLayerScore = (checks: AeoCheck[], categories: AeoCheck["category"][]): number => {
    const subset = checks.filter(c => categories.includes(c.category))
    if (subset.length === 0) return -1
    const weights: Record<AeoCheck["impact"], number> = { high: 15, medium: 8, low: 4 }
    const total = subset.reduce((s, c) => s + weights[c.impact], 0)
    const earned = subset.filter(c => c.passed).reduce((s, c) => s + weights[c.impact], 0)
    return Math.round((earned / total) * 100)
}

const fetchPage = async (url: string): Promise<string | null> => {
    // SSRF guard — this function receives user-supplied URLs from the AEO
    // check flow. Validate before making any network request.
    const safeCheck = isSafeUrl(url);
    if (!safeCheck.ok || !safeCheck.url) {
        logger.warn("[AEO] fetchPage blocked unsafe URL", { url, reason: safeCheck.error });
        return null;
    }

    try {
        const res = await fetch(safeCheck.url.href, {
            headers: { "User-Agent": "AEOBot/1.0 (Answer Engine Optimization Checker)" },
            signal: AbortSignal.timeout(12000),
            redirect: "manual",
        });

        // Validate redirect destination before following
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (!location) return null;
            const redirectCheck = isSafeUrl(location);
            if (!redirectCheck.ok || !redirectCheck.url) {
                logger.warn("[AEO] fetchPage blocked unsafe redirect", { url, location });
                return null;
            }
            const redirectRes = await fetch(redirectCheck.url.href, {
                headers: { "User-Agent": "AEOBot/1.0 (Answer Engine Optimization Checker)" },
                signal: AbortSignal.timeout(12000),
                redirect: "manual",
            });
            if (!redirectRes.ok) return null;
            return await redirectRes.text();
        }

        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
};

/**
 * Discovers site pages via sitemap.xml and returns HTML for up to MAX_AUDIT_PAGES pages.
 * Falls back to just the homepage if the sitemap is missing or empty.
 */
const MAX_AUDIT_PAGES = 20

const discoverPagesFromSitemap = async (origin: string): Promise<string[]> => {
    const pages: string[] = [origin]
    try {
        const sitemapXml = await fetchPage(`${origin}/sitemap.xml`)
        if (!sitemapXml || !sitemapXml.includes('<urlset')) return pages

        const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi
        let match: RegExpExecArray | null
        const seen = new Set<string>([origin])

        while ((match = locRegex.exec(sitemapXml)) !== null && pages.length < MAX_AUDIT_PAGES) {
            const rawUrl = match[1].trim()
            // Only include same-origin, non-asset URLs
            if (
                rawUrl.startsWith(origin) &&
                !seen.has(rawUrl) &&
                !/\.(xml|pdf|jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|ttf)$/i.test(rawUrl)
            ) {
                seen.add(rawUrl)
                pages.push(rawUrl)
            }
        }
    } catch {
        // Sitemap unavailable — just use the homepage
    }
    return pages
}

const extractSchemaTypes = (html: string): string[] => {
    const types: string[] = []
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let match
    while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
             
            const data = JSON.parse(match[1])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const getTypes = (obj: any): void => {
                if (!obj) return
                if (obj["@type"]) {
                    const t = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]]
                    types.push(...t)
                }
                if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(getTypes)
            }
            getTypes(data)
        } catch { }
    }
    // Also check itemtype attributes
    const itemtypeRegex = /itemtype=["'][^"']*schema\.org\/([^"'/]+)["']/gi
    while ((match = itemtypeRegex.exec(html)) !== null) {
        types.push(match[1])
    }
    return [...new Set(types)]
}

// =============================================================================
// PERPLEXITY CITATION CHECK
// Queries Perplexity with brand-related questions and checks if the domain
// appears in citations. Falls back to mock score if no API key.
// =============================================================================

const generateRelevantQuestions = async (
    domain: string,
    coreServices: string | null | undefined,
    pageContent: string | null
): Promise<string[]> => {
    return cachedQuestions(domain, coreServices, async () => {
    const fallback = coreServices ? [
        `How does ${domain} help with ${coreServices}?`,
        `What is ${coreServices} and why does it matter?`,
        `How to get started with ${coreServices}`,
        `What are the benefits of ${coreServices}?`,
        `Best tools for ${coreServices} in 2024`,
        `${domain} ${coreServices} pricing and plans`,
        `Is ${domain} worth it for ${coreServices}?`,
        `Top ${coreServices} platforms compared`,
        `Why is my ${coreServices} not working?`,
        `Common ${coreServices} mistakes to avoid`,
        `${domain} vs competitors for ${coreServices}`,
        `Alternatives to ${domain} for ${coreServices}`,
        `${domain} ${coreServices} features`,
        `How to use ${domain} for ${coreServices}`,
    ] : [
        `What does ${domain} do?`,
        `Tell me about ${domain}`,
        `What services does ${domain} offer?`,
        `Is ${domain} reliable?`,
    ];

    if (!process.env.GEMINI_API_KEY || !pageContent) return fallback;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const cleanText = pageContent
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .substring(0, 6000);

        const prompt = `You are a senior AEO (Answer Engine Optimization) researcher auditing how well a website answers real user queries in AI engines (Perplexity, ChatGPT, Google AI Overviews).

Your task: Generate exactly 20 highly specific questions a real user would ask an AI assistant to find this website.

IMPORTANT RULES:
- Every question must be directly answerable by content on THIS specific website
- Questions must be specific to the actual services/products described — never generic
- Use natural language as users actually type to AI (not keyword-style queries)
- Include question words: how, what, why, which, can, is, does, should
- Site domain: ${domain}
- Core services: ${coreServices || 'inferred from content below'}

Distribute exactly 4 questions per intent category:
1. INFORMATIONAL — Education-seeking: "How does X work?", "What is Y?", "Why should I care about Z?"
2. COMMERCIAL — Evaluation/purchase decisions: "Best tool for X", "Is [brand] worth it for Y?", "[brand] vs alternatives"
3. PROBLEM-AWARE — Troubleshooting or avoiding mistakes: "Why is my X not working?", "How to fix Y?", "Common Z mistakes"
4. COMPARISON — Direct comparison intent: "[brand] vs [competitor] for X", "Which is better for Y?", "Alternatives to [brand]"
5. NAVIGATIONAL — Brand-specific how-to: "How to use [brand] for X", "Does [brand] do Y?", "[brand] X feature"

For each question, think: Would Perplexity or ChatGPT return this website as a citation? If yes, include it.

Respond with a JSON array of exactly 20 question strings — no explanation, no numbering:
["question 1", "question 2", ... "question 20"]

Website content to base questions on:
---
${cleanText}
---`;

        const response = await ai.models.generateContent({
            model: GEMINI_3_1_PRO,
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.2 }
        });

        const text = response.text?.trim() ?? '';
        const jsonText = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
            logger.debug(`[AEO] Generated ${parsed.length} site-specific questions for ${domain}`);
            return parsed.slice(0, 20);
        }
        return fallback;
    } catch (err: unknown) {
        logger.warn('[AEO] Gemini question generation failed, using fallback questions:', { error: (err as Error)?.message || String(err) });
        return fallback;
    }
    });
};

export interface CitationContext {
    question: string;
    citedUrl?: string;
    snippetAround: string; // 200-char window where brand was mentioned
}

const checkPerplexityCitation = async (
    domain: string,
    coreServices: string | null | undefined,
    pageContent: string | null
): Promise<{ score: number; contexts: CitationContext[] }> => {
    if (!process.env.PERPLEXITY_API_KEY) {
        return { score: -1, contexts: [] }
    }

    const questions = await generateRelevantQuestions(domain, coreServices, pageContent);

    const results = await Promise.all(
        questions.map(async (question) => {
            try {
                const res = await fetch("https://api.perplexity.ai/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: "sonar",
                        messages: [{ role: "user", content: question }],
                        search_domain_filter: [],
                        return_citations: true,
                    }),
                    signal: AbortSignal.timeout(15000),
                })

                if (!res.ok) return { mentioned: false, context: null }

                const data = await res.json()
                const citations: string[] = data.citations ?? []
                const content: string = data.choices?.[0]?.message?.content ?? ""

                const mentioned = citations.some((c: string) => c.includes(domain)) ||
                    content.toLowerCase().includes(domain.toLowerCase())

                // FIX #8: Extract citation context
                let context: CitationContext | null = null;
                if (mentioned) {
                    const citedUrl = citations.find((c: string) => c.includes(domain));
                    // Find the window of text around the brand mention
                    const idx = content.toLowerCase().indexOf(domain.toLowerCase());
                    const snippetAround = idx >= 0
                        ? content.slice(Math.max(0, idx - 80), idx + 120).trim()
                        : content.slice(0, 200);
                    context = { question, citedUrl, snippetAround };
                }

                return { mentioned, context }
            } catch {
                return { mentioned: false, context: null }
            }
        })
    );

    const mentionedResults = results.filter(r => r.mentioned);
    const score = Math.round((mentionedResults.length / questions.length) * 100);
    const contexts = mentionedResults.map(r => r.context).filter((c): c is CitationContext => c !== null);

    return { score, contexts }
}




const predictCitationLikelihood = (checks: AeoCheck[]): number => {

    const likelihoodWeights: Record<string, number> = {
        "schema_faq": 15,
        "schema_organization": 12,
        "eeat_author": 10,
        "eeat_about": 10,
        "content_definitions": 8,
        "content_statistics": 10,
        "content_entity_density": 12,
        "content_micro_answers": 10,
        "tech_robots": 8,
        "tech_canonical": 5
    }

    let score = 0
    let maxScore = 0

    checks.forEach(c => {
        if (likelihoodWeights[c.id]) {
            maxScore += likelihoodWeights[c.id]
            if (c.passed) score += likelihoodWeights[c.id]
        }
    })

    return Math.round((score / (maxScore || 1)) * 100)
}

// =============================================================================
// MAIN AEO AUDIT
// =============================================================================

export const runAeoAudit = async (domain: string, coreServices?: string | null, lite = false, brandNameOverride?: string | null): Promise<AeoResult> => {
    const url = domain.startsWith("http") ? domain : `https://${domain}`
    const checks: AeoCheck[] = []
    const schemaTypes: string[] = []

    
    // Use extractBrandIdentity so the display name matches everywhere else in the app
    // and respects the user's brandNameOverride (e.g. "OptiAISEO" not "Opti AI SEO")
    const rawBrand = extractBrandIdentity(domain, brandNameOverride).displayName

    // Discover all site pages via sitemap for comprehensive multi-page auditing
    const sitePages = await discoverPagesFromSitemap(url)
    logger.debug(`[AEO] Discovered ${sitePages.length} pages for ${domain} via sitemap`)

    const html = await fetchPage(url)

    if (!html) {
        return {
            url, score: 0, grade: "F", checks: [], schemaTypes: [], citationScore: 0,
            generativeShareOfVoice: 0,
            citationLikelihood: 0,
            multiModelResults: [],
            topRecommendations: ["Could not fetch the page — ensure the URL is publicly accessible"],
            scannedAt: new Date(),
            diagnosis: null,
        }
    }

    // Fetch additional pages from sitemap in parallel (cap at 10 extra pages to keep audit time reasonable)
    const extraPageUrls = sitePages.slice(1, 11)
    const extraHtmlPages = extraPageUrls.length > 0
        ? await Promise.all(extraPageUrls.map(u => fetchPage(u)))
        : []
    // Combine homepage + extra pages into one big text for content checks
    const allPagesHtml = [html, ...extraHtmlPages.filter((h): h is string => h !== null)].join(' ')

    const foundSchemaTypes = extractSchemaTypes(html)
    schemaTypes.push(...foundSchemaTypes)

    // Detect missing schemas based on content heuristic.
    // detectSchemaGaps() returns SchemaGap[] ({id, label}) — map to label strings
    // here so AeoResult.schemaGaps remains string[] and all consumers stay intact.
    // The structured ids are used internally by fix-engine.ts for routing.
    const schemaGaps: string[] = detectSchemaGaps(html, url).map(g => g.label)

    // ── SCHEMA CHECKS ────────────────────────────────────────────────────────

    const hasFaq = foundSchemaTypes.some(t => t.toLowerCase().includes("faq") || t.toLowerCase().includes("question"))
    checks.push({
        id: "schema_faq",
        category: "schema",
        label: "FAQ Schema Markup",
        passed: hasFaq,
        impact: "high",
        detail: hasFaq ? `Found FAQ/Question schema type` : "No FAQ schema found",
        recommendation: hasFaq
            ? "Great — FAQ schema helps AI engines extract Q&A directly"
            : "Add FAQPage schema with common questions your customers ask. This is the #1 factor for AI answer inclusion.",
    })

    const hasHowTo = foundSchemaTypes.some(t => t.toLowerCase().includes("howto") || t.toLowerCase().includes("step"))
    checks.push({
        id: "schema_howto",
        category: "schema",
        label: "HowTo Schema Markup",
        passed: hasHowTo,
        impact: "high",
        detail: hasHowTo ? "HowTo schema detected" : "No HowTo schema found",
        recommendation: hasHowTo
            ? "HowTo schema is present — AI engines can extract step-by-step content"
            : "Add HowTo schema for any tutorials or guides. AI overviews frequently feature step-by-step content.",
    })

    const hasArticle = foundSchemaTypes.some(t => ["Article", "NewsArticle", "BlogPosting", "TechArticle"].includes(t))
    checks.push({
        id: "schema_article",
        category: "schema",
        label: "Article/BlogPosting Schema",
        passed: hasArticle,
        impact: "medium",
        detail: hasArticle ? `Article schema: ${foundSchemaTypes.filter(t => ["Article", "NewsArticle", "BlogPosting", "TechArticle"].includes(t)).join(", ")}` : "No article schema",
        recommendation: hasArticle
            ? "Article schema helps AI engines identify authoritative content"
            : "Add Article or BlogPosting schema to your content pages with author, datePublished, and headline.",
    })

    const hasSpeakable = html.toLowerCase().includes('"speakable"') || html.toLowerCase().includes("speakable")
    checks.push({
        id: "schema_speakable",
        category: "schema",
        label: "Speakable Schema (Voice/AI)",
        passed: hasSpeakable,
        impact: "medium",
        detail: hasSpeakable ? "Speakable schema detected" : "No Speakable schema",
        recommendation: hasSpeakable
            ? "Speakable schema helps Google Assistant and AI voice responses cite your content"
            : "Add Speakable schema to highlight the most answer-worthy sections of your pages.",
    })

    const hasOrg = foundSchemaTypes.some(t => ["Organization", "LocalBusiness", "Corporation"].includes(t))
    checks.push({
        id: "schema_organization",
        category: "schema",
        label: "Organization Schema",
        passed: hasOrg,
        impact: "high",
        detail: hasOrg ? "Organization schema found" : "No Organization schema",
        recommendation: hasOrg
            ? "Organization schema helps AI engines understand your brand identity"
            : "Add Organization schema with name, url, logo, sameAs (social profiles), and description. Critical for brand recognition by AI engines.",
    })

    // ── PARALLEL FETCH ────────────────────────────────────────────────────────
    // Fetch all ancillary pages in parallel to cut audit time from ~15s → ~5s
    const [aboutHtml, contactHtml, privacyHtml, privacyPolicyHtml, robotsHtml, sitemapHtml] = await Promise.all([
        fetchPage(`${url}/about`),
        fetchPage(`${url}/contact`),
        fetchPage(`${url}/privacy`),
        fetchPage(`${url}/privacy-policy`),
        fetchPage(`${url}/robots.txt`),
        fetchPage(`${url}/sitemap.xml`),
    ]);

    // ── E-E-A-T CHECKS ───────────────────────────────────────────────────────

    const hasAuthor = html.toLowerCase().includes("author") &&
        (html.includes('"author"') || html.toLowerCase().includes("written by") || html.toLowerCase().includes("by "))
    checks.push({
        id: "eeat_author",
        category: "eeat",
        label: "Author Attribution",
        passed: hasAuthor,
        impact: "high",
        detail: hasAuthor ? "Author information detected on page" : "No author attribution found",
        recommendation: hasAuthor
            ? "Author markup helps establish Expertise and Authoritativeness signals"
            : "Add clear author bylines with Person schema markup. Link to author bio pages. AI engines weight heavily-authored content.",
    })

    const hasAboutPage = aboutHtml !== null && aboutHtml.length > 500
    checks.push({
        id: "eeat_about",
        category: "eeat",
        label: "About Page",
        passed: hasAboutPage,
        impact: "high",
        detail: hasAboutPage ? "/about page found and accessible" : "No /about page found",
        recommendation: hasAboutPage
            ? "About page establishes who you are — critical for AI trust signals"
            : `Create a detailed ${domain}/about page with your team, mission, and credentials. AI engines use this to verify ${rawBrand}'s entity identity.`,
    })

    const hasContactPage = contactHtml !== null && contactHtml.length > 200
    checks.push({
        id: "eeat_contact",
        category: "eeat",
        label: "Contact Page",
        passed: hasContactPage,
        impact: "medium",
        detail: hasContactPage ? "/contact page found" : "No /contact page found",
        recommendation: hasContactPage
            ? "Contact page signals trustworthiness to both users and AI engines"
            : "Add a /contact page with email, address, or contact form. This is a basic Trust signal.",
    })

    const hasPrivacy = privacyHtml !== null || privacyPolicyHtml !== null
    checks.push({
        id: "eeat_privacy",
        category: "eeat",
        label: "Privacy Policy",
        passed: hasPrivacy,
        impact: "low",
        detail: hasPrivacy ? "Privacy policy page found" : "No privacy policy found",
        recommendation: hasPrivacy
            ? "Privacy policy present — good trust signal"
            : "Add a privacy policy page. Required for GDPR and helps establish site legitimacy.",
    })

    // ── CONTENT FORMAT CHECKS (multi-page — checked across all discovered pages) ──

    const hasFaqContent = /(<h[1-6][^>]*>)?\s*(frequently asked|faq|common question)/i.test(allPagesHtml)
        || /<details|<summary/i.test(allPagesHtml)
    checks.push({
        id: "content_faq_section",
        category: "content",
        label: "FAQ Content Section",
        passed: hasFaqContent,
        impact: "high",
        detail: hasFaqContent
            ? `FAQ or Q&A content section detected (checked ${sitePages.length} page${sitePages.length > 1 ? 's' : ''})`
            : `No FAQ section found across ${sitePages.length} scanned page${sitePages.length > 1 ? 's' : ''}`,
        recommendation: hasFaqContent
            ? "Q&A format content is highly likely to be featured in AI answers"
            : "Add a FAQ section with clear question headings and concise paragraph answers. Use <details>/<summary> or H3 question format.",
    })

    const hasDefinitions = /\b(what is|what are|definition of|meaning of|refers to)\b/i.test(allPagesHtml)
    checks.push({
        id: "content_definitions",
        category: "content",
        label: "Definitional Content",
        passed: hasDefinitions,
        impact: "medium",
        detail: hasDefinitions ? "Definitional phrasing detected ('What is...', 'refers to...')" : "No definitional content found",
        recommendation: hasDefinitions
            ? "Definitional content ranks well in AI overviews and featured snippets"
            : "Add 'What is X?' sections to key pages. AI answer engines pull definitions directly from clear, concise paragraphs.",
    })

    const hasTableOfContents = allPagesHtml.includes("table-of-contents") || allPagesHtml.includes("toc") || /#[a-z-]+-[a-z]/i.test(allPagesHtml)
    checks.push({
        id: "content_toc",
        category: "content",
        label: "Table of Contents / Anchors",
        passed: hasTableOfContents,
        impact: "low",
        detail: hasTableOfContents ? "Table of contents or anchor links detected" : "No table of contents found",
        recommendation: hasTableOfContents
            ? "TOC helps AI crawlers understand page structure"
            : "Add a table of contents with anchor links to long-form content.",
    })

    const hasStatistics = /\b(\d{1,3}%|\d{1,3} percent|1 in \d+|majority of|statistics? show)\b/i.test(allPagesHtml)
    checks.push({
        id: "content_statistics",
        category: "content",
        label: "Verifiable Claims & Statistics",
        passed: hasStatistics,
        impact: "high",
        detail: hasStatistics ? "Statistical data or percentage claims detected" : "No statistical claims or numbers detected",
        recommendation: hasStatistics
            ? "Data-dense content is highly cited by LLMs"
            : "Embed verifiable statistics or claims. LLMs prefer quoting authoritative numbers and data points in their answers.",
    })

    const hasEntityDensity = /\b(founded in|located in|is a type of|serves the|categorized as|industry)\b/i.test(allPagesHtml)
    checks.push({
        id: "content_entity_density",
        category: "content",
        label: "Knowledge Graph Entity Context",
        passed: hasEntityDensity,
        impact: "high",
        detail: hasEntityDensity ? "Entity relationship markers detected" : "Entity context is thin or missing",
        recommendation: hasEntityDensity
            ? "Strong entity context helps AI models categorize your brand"
            : "Add a dense 'Entity Description' paragraph defining exactly what your business is, its category, and its relationships to other concepts.",
    })

    const hasMicroAnswers = /<strong>Q:<\/strong>|\b(short answer:|in summary,|to summarize,)\b/i.test(allPagesHtml)
    checks.push({
        id: "content_micro_answers",
        category: "content",
        label: "Direct Micro-Answers",
        passed: hasMicroAnswers,
        impact: "medium",
        detail: hasMicroAnswers ? "Micro-answer formatting detected" : "No zero-click micro-answers found",
        recommendation: hasMicroAnswers
            ? "Concise answers are easily extracted by AI snapshots"
            : "Provide 1-2 sentence, definitive answers to common queries clearly formatted as 'Short Answer:' or similar.",
    })

    // ── CORE SERVICES ALIGNMENT CHECK ───────────────────────────────────────

    if (!lite && coreServices && process.env.GEMINI_API_KEY) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            // Extract text from HTML roughly
            const cleanText = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .substring(0, 6000);

            // Use Gemini Google Search grounding — this retrieves real search results
            // and checks whether the domain appears in them. This measures what Google's
            // own AI actually surfaces, not what the model knows from training data.
            const groundedResponse = await ai.models.generateContent({
                model: GEMINI_2_5_FLASH,
                contents: `What are the best ${coreServices}? Is ${domain} commonly cited or recommended for ${coreServices}?`,
                // @ts-expect-error — googleSearch is a valid tool in the Gemini API
                tools: [{ googleSearch: {} }],
                config: { temperature: 0.1 },
            });

            // Check whether the domain appears in the retrieved search sources
            // groundingMetadata.groundingChunks contains the actual URLs retrieved
            const groundingChunks =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (groundedResponse as any).candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
            const citedInGrounding: boolean = groundingChunks.some(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (chunk: any) => typeof chunk?.web?.uri === 'string' && chunk.web.uri.includes(domain)
            );
            const groundingSourceCount: number = groundingChunks.length;

            // Also run the page content alignment check (plain text, no grounding)
            const alignmentResponse = await ai.models.generateContent({
                model: GEMINI_2_5_FLASH,
                contents: `
You are an SEO analyzer. Evaluate if the following webpage content clearly communicates its core services.
Core Services: "${coreServices}"

Analyze the content and respond in strict JSON format:
{
  "passed": boolean,
  "confidence": number,
  "detail": "short explanation of what was found or missing",
  "recommendation": "short actionable advice on how to improve content to better highlight these services"
}

Webpage Content:
---
${cleanText}
---
`,
                config: {
                    responseMimeType: "application/json",
                    temperature: 0.1,
                }
            });

            const resultText = alignmentResponse.text;
            if (resultText) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let alignment: any;
                try {
                    alignment = JSON.parse(resultText);
                } catch {
                    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) alignment = JSON.parse(jsonMatch[0]);
                }
                if (alignment) {
                    const groundingNote = groundingSourceCount > 0
                        ? ` | Google Search grounding: ${citedInGrounding ? `✅ ${domain} appears in live search results` : `❌ ${domain} not in top ${groundingSourceCount} Google results`}`
                        : '';
                    checks.push({
                        id: "content_service_alignment",
                        category: "content",
                        label: "Core Service Alignment (AI + Live Search)",
                        passed: alignment.passed,
                        impact: "high",
                        detail: `AI Confidence: ${alignment.confidence ?? 'N/A'}% — ${alignment.detail}${groundingNote}`,
                        recommendation: alignment.passed
                            ? citedInGrounding
                                ? "Core services are well communicated and domain appears in live Google results."
                                : `Core services are communicated on-page but ${domain} is not yet appearing in Google's live results for "${coreServices}". Focus on building more backlinks and increasing content freshness.`
                            : alignment.recommendation,
                    });

                    // Log grounding citation result for observability
                    logger.info(`[AEO/Grounding] ${domain} — cited in Google Search: ${citedInGrounding} (${groundingSourceCount} sources retrieved)`);
                }
            }

        } catch (error: unknown) {
            logger.error("[AEO] Gemini grounded alignment check failed:", { error: (error as Error)?.message || String(error) });
        }
    }

    // ── ENTITY-FIRST AEO CHECKS ───────────────────────────────────────────────
    // These three checks test entity clarity — the most important factor for AI
    // citation and generative search inclusion for service businesses.

    // Check 1: Entity Definition Clarity
    // Does the page define its primary service early (within first 600 chars)?
    // AI systems extract answers from the opening content. If a service isn't
    // named clearly up front, the page gets skipped for AI snippet inclusion.
    if (coreServices) {
        const firstParagraph = html
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 600);

        const hasEntityDefinition = coreServices
            .split(",")
            .map((s: string) => s.trim().toLowerCase())
            .some((service: string) => firstParagraph.toLowerCase().includes(service.split(" ")[0]));

        checks.push({
            id: "entity-definition",
            category: "content",
            label: "Entity Definition Clarity",
            passed: !!hasEntityDefinition,
            impact: "high",
            detail: hasEntityDefinition
                ? "The page clearly defines its service within the first 600 characters — strong entity signal."
                : "No service entity detected in the opening content. AI systems extract answers from the first paragraph.",
            recommendation: hasEntityDefinition
                ? "Good — the entity is declared early in the content."
                : `Add a one-sentence definition of your main service in the first paragraph. Example: "${coreServices.split(",")[0]?.trim()} is a service that..." — AI engines need this to categorize and cite your page.`,
        });
    }

    // Check 2: Location Entity Signal
    // If the business serves a specific location, it must appear on the page for
    // local AI answers and map-pack inclusion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siteRecord = await prisma.site.findFirst({ where: { domain } }).catch(() => null) as any;
    const siteLocation: string | null = siteRecord?.location ?? null;

    if (siteLocation) {
        const locationMentioned = html.toLowerCase().includes(
            siteLocation.toLowerCase().split(",")[0]
        );
        checks.push({
            id: "location-entity",
            category: "content",
            label: "Location Entity Signal",
            passed: !!locationMentioned,
            impact: "high",
            detail: locationMentioned
                ? `Location "${siteLocation}" is mentioned on the page — good local entity signal.`
                : `Location "${siteLocation}" is not found on this page. Local businesses need location signals for map packs and local AI answers.`,
            recommendation: locationMentioned
                ? "Good — location context is present."
                : `Add "${siteLocation}" naturally within the first two paragraphs and in the H1 or H2. This is required for local AI citation.`,
        });
    }

    // Check 3: Service Schema Presence
    // Service/ProfessionalService schema is the most important schema type for
    // service businesses — AI engines use it to extract structured offering data.
    const hasServiceSchema = foundSchemaTypes.some(t =>
        t === "Service" || t === "ProfessionalService"
    );
    checks.push({
        id: "service-schema",
        category: "schema",
        label: "Service Schema Markup",
        passed: hasServiceSchema,
        impact: "high",
        detail: hasServiceSchema
            ? "Service schema detected — AI systems can extract structured service data for citation."
            : "No Service or ProfessionalService schema found. This is the most important schema type for service businesses.",
        recommendation: hasServiceSchema
            ? "Service schema is present — AI engines can extract and cite your service data."
            : "Add Service JSON-LD schema to every service page. Required: name, provider. Recommended: description, serviceType, areaServed. Use the Entity Panel in your dashboard to generate these automatically.",
    });

    // ── TECHNICAL CHECKS ─────────────────────────────────────────────────────

    const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html)
    checks.push({
        id: "tech_canonical",
        category: "technical",
        label: "Canonical Tag",
        passed: hasCanonical,
        impact: "medium",
        detail: hasCanonical ? "Canonical tag present" : "No canonical tag",
        recommendation: hasCanonical
            ? "Canonical tag prevents duplicate content confusion in AI crawlers"
            : "Add a canonical tag to every page to prevent AI engines from indexing duplicates.",
    })

    // tech_robots removed — geo_ai_bot_access (below) already checks GPTBot,
    // PerplexityBot, and Anthropic with higher-impact weighting. Keeping both
    // would double-count the same signal in the overall score.

    const hasSitemap = sitemapHtml !== null && sitemapHtml.includes("<urlset")
    checks.push({
        id: "tech_sitemap",
        category: "technical",
        label: "XML Sitemap",
        passed: hasSitemap,
        impact: "medium",
        detail: hasSitemap ? "sitemap.xml found" : "No sitemap.xml found",
        recommendation: hasSitemap
            ? "Sitemap helps AI crawlers find all your content efficiently"
            : "Create and submit a sitemap.xml. Perplexity and other crawlers use sitemaps to discover content.",
    })

    // ── GEO CHECKS — be chosen/recommended by AI ─────────────────────────────

    // Fix 3: Parallelise all four GEO page fetches — cuts audit time by ~3-5s
    const [pricingHtml, compareHtml, blogHtmlRaw, resourcesHtml, llmsTxtGeoHtml] = await Promise.all([
        fetchPage(`${url}/pricing`),
        fetchPage(`${url}/compare`),
        fetchPage(`${url}/blog`),
        fetchPage(`${url}/resources`),
        fetchPage(`${url}/llms.txt`),
    ]);
    const blogHtml = blogHtmlRaw ?? resourcesHtml;

    const hasPricing = (pricingHtml !== null && pricingHtml.length > 300) ||
        /\b(pricing|price|\$\d|per month|per year|free plan|paid plan|plans? &amp; pricing|starting at)\b/i.test(html)
    checks.push({
        id: "geo_pricing_clarity",
        category: "geo",
        label: "Transparent Pricing",
        passed: hasPricing,
        impact: "high",
        detail: hasPricing ? "Pricing page or pricing content found" : "No pricing information found on the site",
        recommendation: hasPricing
            ? "Clear pricing helps AI confidently recommend you over vague competitors"
            : "Add a /pricing page with clear tiers, prices, and a free-trial option. AI skips businesses with vague pricing when making purchase recommendations.",
    })

    const hasUseCases = /\b(use case|who (it'?s|this is) for|ideal for|best for|perfect for|built for|designed for|works (best|great) for)\b/i.test(html)
    checks.push({
        id: "geo_use_cases",
        category: "geo",
        label: "Clear Use Cases",
        passed: hasUseCases,
        impact: "high",
        detail: hasUseCases ? "Use case or target audience language detected" : "No use-case targeting found",
        recommendation: hasUseCases
            ? "Specific use cases help AI match your service to the right buyer"
            : "Add explicit 'Who it's for' or 'Use Cases' sections. AI uses these to decide fitness when someone asks for a recommendation.",
    })

    const hasComparison = (compareHtml !== null && compareHtml.length > 300) ||
        /\b(vs\.?|versus|compared to|alternatives? to|\bcompare\b)\b/i.test(html)
    checks.push({
        id: "geo_comparison_page",
        category: "geo",
        label: "Comparison / vs Pages",
        passed: hasComparison,
        impact: "medium",
        detail: hasComparison ? "Comparison content or /compare page found" : "No comparison or 'vs' content detected",
        recommendation: hasComparison
            ? "Comparison pages improve your GEO — AI cites them when answering 'X vs Y' queries"
            : `Create a '${rawBrand} vs [Competitor]' page. AI synthesises comparisons; if your content already does it, you get cited.`,
    })

    const hasReviews = /\b(testimonial|review|customer story|\d(\.\d)? (star|out of)|rated \d|five.star|google review)\b/i.test(html) ||
        foundSchemaTypes.some(t => ["Review", "AggregateRating"].includes(t))
    checks.push({
        id: "geo_reviews_testimonials",
        category: "geo",
        label: "Reviews & Testimonials",
        passed: hasReviews,
        impact: "high",
        detail: hasReviews ? "Review or testimonial content detected" : "No reviews or testimonials found",
        recommendation: hasReviews
            ? "Social proof helps AI feel confident recommending you"
            : "Add customer testimonials with star ratings and AggregateRating schema. AI trusts consensus over claims — reviews are the signal.",
    })

    const hasCaseStudies = /\b(case study|success stor|client result|customer result|outcome|before.?after|roi|return on investment)\b/i.test(html)
    checks.push({
        id: "geo_case_studies",
        category: "geo",
        label: "Case Studies / Results",
        passed: hasCaseStudies,
        impact: "medium",
        detail: hasCaseStudies ? "Case study or results content found" : "No case study or results content",
        recommendation: hasCaseStudies
            ? "Concrete results give AI evidence to recommend your product confidently"
            : "Publish case studies with specific numbers (e.g. '42% faster', '$12k saved'). Declarative facts are what AI loves to quote.",
    })

    const hasTopicalDepth = blogHtml !== null && blogHtml.length > 2000
    checks.push({
        id: "geo_topical_depth",
        category: "geo",
        label: "Topical Authority (Blog / Resources)",
        passed: hasTopicalDepth,
        impact: "medium",
        detail: hasTopicalDepth ? "Blog or resources section found" : "No /blog or /resources section found",
        recommendation: hasTopicalDepth
            ? "A content hub builds the topical authority AI needs to recommend you in category queries"
            : "Build a /blog or /resources hub with cluster content around your core topics. AI rewards the brand mentioned most within a topic.",
    })

    // ── GEO CHECKS (continued) — Ahrefs 75k-brand GEO research signals ───────

    // 1. Branded mention signals: third-party mentions are the #1 predictor of
    //    Google AI Overview visibility (stronger than backlinks or domain rating).
    // Fix 2: Corrected \\b → \b (word boundary) — double-escaped regexes never matched
    const hasBrandedMentionSignals = /\b(as (seen|featured|mentioned) (on|in)|featured in|press|media coverage|our partners|trusted by|mentioned by|media mention|covered by)\b/i.test(html)
        || /\b(forbes|techcrunch|wired|guardian|reuters|associated press|bbc|cnn|businessinsider|entrepreneur|inc\.com)\b/i.test(html)
    checks.push({
        id: "geo_branded_mentions",
        category: "geo",
        label: "Third-Party Branded Mention Signals",
        passed: hasBrandedMentionSignals,
        impact: "high",
        detail: hasBrandedMentionSignals
            ? "Press/media mentions or 'As seen on' signals detected — strong branded mention indicator"
            : "No press coverage or third-party mention signals found on the page",
        recommendation: hasBrandedMentionSignals
            ? "Third-party branded mentions are the #1 GEO signal — keep building press and community presence"
            : `Per Ahrefs research, branded mentions on credible, high-traffic pages are the strongest predictor of AI Overview visibility — stronger than backlinks. Get ${rawBrand} mentioned on Reddit threads, industry YouTube channels, and publisher PR campaigns. Add an 'As featured in' press bar to your homepage.`,
    })

    // 2. Longtail content clusters: AI assistants fan queries into dozens of
    //    longtail sub-queries. Sites ranking for those sub-queries get included.
    // Fix 2: Corrected \\b → \b
    const hasLongtailClusters = /\b(complete guide|ultimate guide|everything you need to know|in-depth|deep dive|101 guide|beginners guide|advanced guide|step-by-step guide)\b/i.test(allPagesHtml)
        || (allPagesHtml.match(/<h[23][^>]*>/gi) ?? []).length >= 5
    checks.push({
        id: "geo_longtail_clusters",
        category: "geo",
        label: "Longtail Query Coverage (Content Clusters)",
        passed: hasLongtailClusters,
        impact: "high",
        detail: hasLongtailClusters
            ? "Long-form pillar content or multi-heading H2/H3 structure detected — good longtail sub-query coverage"
            : "Content appears thin on longtail sub-queries (few H2/H3 sections or guides)",
        recommendation: hasLongtailClusters
            ? "Strong content cluster structure — AI fans prompts into sub-queries; you rank for many of them"
            : `Ahrefs data shows AI assistants like ChatGPT fan a single prompt into dozens of longtail sub-queries, then synthesize answers. Build content clusters: a pillar page + 6-10 supporting posts that each answer one specific sub-question. This dramatically increases how often ${rawBrand} gets included in the final AI response.`,
    })

    // 3. Content freshness: AI-cited content is 25.7% fresher than regular
    //    organic results. ChatGPT and Perplexity list citations newest-to-oldest.
    // Fix 2: Corrected \\b → \b
    const hasDateSignals = /\b(updated|last updated|revised|published|\b20(2[3-9]|[3-9]\d)\b)\b/i.test(html)
        || /<time[^>]*datetime/i.test(html)
        || /datePublished|dateModified/i.test(html)
    checks.push({
        id: "geo_content_freshness",
        category: "geo",
        label: "Content Freshness Signals",
        passed: hasDateSignals,
        impact: "high",
        detail: hasDateSignals
            ? "Date published/modified or <time> element detected — freshness signal visible to AI crawlers"
            : "No visible publication or update dates found — AI may deprioritize your content as stale",
        recommendation: hasDateSignals
            ? "Freshness signals detected — maintain a regular update cycle and redate posts when meaningfully revised"
            : `Ahrefs' study of 17M citations found AI-cited content is 25.7% fresher than regular organic results. ChatGPT and Perplexity rank citations newest-to-oldest. Add datePublished and dateModified to your Article schema, show a visible 'Last updated: [date]' on each page, and set a quarterly refresh cycle for your top content.`,
    })

    // 4. AI bot access diversity: 5.9% of sites block OpenAI's GPTBot in
    //    robots.txt. Also check for Perplexity and Anthropic bots.
    const blocksGptBot = robotsHtml?.toLowerCase().includes("gptbot") ?? false
    const blocksPerplexityBot = robotsHtml?.toLowerCase().includes("perplexitybot") ?? false
    const blocksAnthropicBot = robotsHtml?.toLowerCase().includes("anthropic") ?? false
    const allAiBotsAllowed = !blocksGptBot && !blocksPerplexityBot && !blocksAnthropicBot
    checks.push({
        id: "geo_ai_bot_access",
        category: "geo",
        label: "All AI Crawlers Allowed (GPT, Perplexity, Claude)",
        passed: allAiBotsAllowed,
        impact: "high",
        detail: allAiBotsAllowed
            ? "GPTBot, PerplexityBot, and Anthropic bots are not blocked in robots.txt"
            : `Blocked: ${[blocksGptBot && "GPTBot", blocksPerplexityBot && "PerplexityBot", blocksAnthropicBot && "Anthropic"].filter(Boolean).join(", ")} — you are invisible to these AI platforms`,
        recommendation: allAiBotsAllowed
            ? "All major AI crawlers can access your site — essential for citation retrieval (RAG)"
            : `Ahrefs found 5.9% of 140M sites accidentally block OpenAI's GPTBot. Check ${domain}/robots.txt and ensure you have: User-agent: GPTBot / Allow: / and User-agent: PerplexityBot / Allow: / — you cannot rank in AI you won't let crawl you.`,
    })

    // 5. Platform diversification: only 7 of the top 50 cited domains appear
    //    on Google AI, ChatGPT, AND Perplexity. Each platform prefers different sources.
    const hasVideoContent = /(youtube\.com|youtu\.be|vimeo\.com|wistia\.com|loom\.com|video)/i.test(html)
    const hasCommunityPresence = /(reddit\.com|quora\.com|community|forum|discord|slack)/i.test(html)
    const hasNewsPresence = /(press release|news room|newsroom|media|announcement|in the news)/i.test(html)
    const platformDiversityScore = [hasVideoContent, hasCommunityPresence, hasNewsPresence].filter(Boolean).length
    const hasPlatformDiversity = platformDiversityScore >= 2
    checks.push({
        id: "geo_platform_diversity",
        category: "geo",
        label: "Multi-Platform Presence (Video, Community, News)",
        passed: hasPlatformDiversity,
        impact: "medium",
        detail: hasPlatformDiversity
            ? `Multi-platform signals detected: ${[hasVideoContent && "video", hasCommunityPresence && "community/forum", hasNewsPresence && "press/news"].filter(Boolean).join(", ")}`
            : `Only ${platformDiversityScore}/3 platform signals found — ${rawBrand} may be invisible on certain AI platforms`,
        recommendation: hasPlatformDiversity
            ? "Good multi-platform presence — different AI assistants pull from different source types; diversification is key"
            : `Ahrefs found only 7 of the top 50 cited domains appear on Google AI, ChatGPT, AND Perplexity — each platform prefers different sources. Google AI leans on YouTube, Reddit, Quora. ChatGPT prefers Reuters/AP-style publishers. Perplexity cites niche/regional blogs. Diversify: create YouTube content, participate in Reddit threads, and pursue niche publisher mentions — not just your own site.`,
    })

    // ── AIO CHECKS — get your brand understood by AI ─────────────────────────

    const aboutBodyLen = aboutHtml?.length ?? 0
    const aboutRich = aboutBodyLen > 1500 &&
        /\b(founded|established|since \d{4}|family.owned|team of|employees|headquartered|based in)\b/i.test(aboutHtml ?? "")
    checks.push({
        id: "aio_about_richness",
        category: "aio",
        label: "About Page Richness",
        passed: aboutRich,
        impact: "high",
        detail: aboutRich
            ? "About page is detailed with founding/team/location signals"
            : aboutBodyLen > 500
                ? "About page exists but lacks founding date, team size, or location context"
                : "No detailed About page found",
        recommendation: aboutRich
            ? `Rich About page gives AI a reliable knowledge card for ${rawBrand}`
            : `Expand your ${domain}/about page to include: founding year, team size, location, mission and key credentials. AI builds its brand knowledge for ${rawBrand} from this page.`,
    })

    const footerHasContact = /(<footer[^>]*>[\s\S]*?)(\+?[\d\s().-]{7,}|\d{3}[-.\s]\d{3}|\b(address|street|ave|blvd|rd|suite)\b)[\s\S]*?<\/footer>/i.test(html)
    const napConsistent = footerHasContact ||
        (contactHtml !== null && /\+?[\d\s().-]{7,}/.test(contactHtml))
    checks.push({
        id: "aio_nap_consistency",
        category: "aio",
        label: "Business Info Consistency (NAP)",
        passed: napConsistent,
        impact: "high",
        detail: napConsistent ? "Phone or address found in site" : "No consistent Name/Address/Phone detected",
        recommendation: napConsistent
            ? "Consistent NAP helps AI build a reliable entity record for your brand"
            : "Add your business Name, Address, and Phone number consistently in your site footer AND in LocalBusiness schema. Inconsistent NAP makes AI skip you.",
    })

    // llmsTxtGeoHtml was already fetched in the parallel Promise.all above — reuse it
    const hasLlmsTxt = llmsTxtGeoHtml !== null && llmsTxtGeoHtml.length > 50
    checks.push({
        id: "aio_llms_txt",
        category: "aio",
        label: "llms.txt File",
        passed: hasLlmsTxt,
        impact: "medium",
        detail: hasLlmsTxt ? "llms.txt found — AI crawlers have a machine-readable brand summary" : "No llms.txt file found",
        recommendation: hasLlmsTxt
            ? `llms.txt gives AI crawlers direct brand context for ${rawBrand} at index time`
            : `Create ${domain}/llms.txt with "${rawBrand}" as the brand name, your service summary, and key offerings. It's robots.txt for AI — low effort, high signal density.`,
    })

    const hasSocial = /(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com)/i.test(html)
    checks.push({
        id: "aio_social_presence",
        category: "aio",
        label: "Social Profile Links",
        passed: hasSocial,
        impact: "medium",
        detail: hasSocial ? "Social media profile links found" : "No social profile links found on the page",
        recommendation: hasSocial
            ? "Social proof links strengthen your off-site brand footprint"
            : "Link to your active social profiles from your footer. AI builds brand authority from off-site mentions and social presence.",
    })

    const sameAsMatches = (html.match(/"sameAs"\s*:\s*\[/g) ?? []).length > 0
    const sameAsCount = (html.match(/"sameAs"\s*:\s*\[[^\]]*\]/g)?.[0] ?? "").split(',').filter(s => s.includes('http')).length
    const hasSameAs = sameAsMatches && sameAsCount >= 2
    checks.push({
        id: "aio_brand_same_as",
        category: "aio",
        label: "Brand sameAs Schema (≥2 Profiles)",
        passed: hasSameAs,
        impact: "high",
        detail: hasSameAs
            ? `sameAs array with ${sameAsCount} external profiles found in schema`
            : "Organization schema missing sameAs with 2+ external profiles",
        recommendation: hasSameAs
            ? "sameAs links tell AI your brand identity is verified across multiple platforms"
            : "Add a sameAs array to your Organization JSON-LD with links to LinkedIn, Twitter/X, Facebook, Crunchbase, and any Wikipedia entry. This is how AI maps your entity.",
    })

    // ── AIO CHECK: Direct Answer / AI Overview Eligibility ───────────────────
    // Google AI Overviews preferentially extract from pages that:
    // (a) have a short direct-answer paragraph (≤150 words) near the top
    // (b) have FAQ schema on page
    // (c) have their primary question answered in the H1 or first <p>
    {
        const h1Match = html.match(/<h1[^>]*>([^<]{10,200})<\/h1>/i)
        const h1Text = h1Match?.[1]?.trim() ?? ''
        const isQuestionH1 = /^(what|how|why|when|where|which|who|can|does|is|are|should|will|do)\b/i.test(h1Text)

        // Find first <p> after H1 — this is the candidate for direct answer extraction
        const h1Index = h1Match ? html.indexOf(h1Match[0]) : -1
        const htmlAfterH1 = h1Index >= 0 ? html.slice(h1Index + h1Match![0].length) : html
        const firstPMatch = htmlAfterH1.match(/<p[^>]*>([^<]{40,600})<\/p>/i)
        const firstPText = firstPMatch?.[1]?.replace(/<[^>]+>/g, ' ').trim() ?? ''
        const firstPWords = firstPText.split(/\s+/).filter(w => w.length > 0).length
        const hasDirectAnswer = firstPWords >= 30 && firstPWords <= 150

        const hasFaqSchema = /'"@type"\s*:\s*"FAQPage"'/i.test(html) || html.includes('"FAQPage"')
        const hasSpeakable = html.includes('"speakable"') || html.includes('speakable')

        const aioScore = [isQuestionH1, hasDirectAnswer, hasFaqSchema, hasSpeakable].filter(Boolean).length
        checks.push({
            id: "aio_direct_answer_eligibility",
            category: "aio",
            label: "AI Overview Direct-Answer Eligibility",
            passed: aioScore >= 2,
            impact: "high",
            detail: aioScore >= 2
                ? `Strong AI Overview eligibility: ${[
                    isQuestionH1 && 'question-formatted H1',
                    hasDirectAnswer && `direct answer paragraph (${firstPWords} words)`,
                    hasFaqSchema && 'FAQPage schema',
                    hasSpeakable && 'speakable markup',
                  ].filter(Boolean).join(', ')}`
                : `Weak AI Overview eligibility (${aioScore}/4 signals): ${[
                    !isQuestionH1 && 'H1 is not question-formatted',
                    !hasDirectAnswer && (firstPWords > 150 ? `intro paragraph too long (${firstPWords} words, target ≤150)` : 'no concise direct-answer paragraph found'),
                    !hasFaqSchema && 'no FAQPage schema',
                    !hasSpeakable && 'no speakable markup',
                  ].filter(Boolean).join('; ')}`,
            recommendation: aioScore >= 2
                ? "Good AI Overview eligibility signals — maintain the direct-answer structure and FAQ schema"
                : [
                    !isQuestionH1 ? '• Rephrase your H1 as a question (e.g. "How does X work?" or "What is Y?") — Google AI Overviews preferentially extract from pages that directly answer a question.' : '',
                    !hasDirectAnswer ? '• Add a 40–100 word direct-answer paragraph immediately after the H1. This is the exact text AI Overviews extract. No preamble, no "In this article" — just the answer.' : '',
                    !hasFaqSchema ? '• Add FAQPage JSON-LD schema with 5–8 Q&A pairs targeting related questions. FAQ schema is the #1 structural signal for AI Overview inclusion.' : '',
                    !hasSpeakable ? '• Add speakable schema to mark which paragraphs are suitable for audio/voice extraction — a growing signal for Google Assistant and AI Overview audio summaries.' : '',
                  ].filter(Boolean).join('\n'),
        })
    }

    // ── CITATION CHECK ────────────────────────────────────────────────────────

    // Pass actual page HTML so Gemini can generate questions RELEVANT to this site's content.
    // This makes the citation check test meaningful questions, not generic brand queries.
    let citationScore = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fanOutResults: any[] = [];

    if (!lite) {
        const { score: _cScore, contexts: _citationContexts } = await checkPerplexityCitation(domain, coreServices, html)
        citationScore = _cScore;

        // Multi-Model Fan-out for the new model comparison bar
        const questions = await generateRelevantQuestions(domain, coreServices, html);
        const { callGpt4o, callPerplexity } = await import("./llm-callers");
        const { callGemini } = await import("@/lib/gemini");

        const runModelAudit = async (modelName: string, queries: string[], targetDomain: string, llmCaller: (p: string) => Promise<string>) => {
            let citations = 0;
            for (const q of queries) {
                const prompt = `Act as an AI answering: ${q}. Mention brands if relevant.`;
                try {
                    const response = await llmCaller(prompt);
                    if (response.toLowerCase().includes(targetDomain.toLowerCase())) citations++;
                } catch {
                    // Ignore errors for individual queries
                }
            }
            return {
                modelName,
                queriesRun: queries.length,
                citationCount: citations,
                citationRate: queries.length ? Math.round((citations / queries.length) * 100) : 0,
                topCitedQueries: [],
                missedQueries: []
            };
        };

         
        try {
            fanOutResults = await Promise.all([
                runModelAudit("gemini", questions, domain, callGemini),
                runModelAudit("gpt-4o", questions, domain, callGpt4o),
                runModelAudit("perplexity", questions, domain, callPerplexity),
            ]);
         
        } catch (error: unknown) {
            logger.error("[AEO Fan-out] Failed:", { error: (error as Error)?.message || String(error) });
        }

        if (citationScore >= 0) {
            checks.push({
                id: "citation_perplexity",
                category: "citation",
                label: "Perplexity Citation Score",
                passed: citationScore >= 33,
                impact: "high",
                detail: citationScore >= 33
                    ? `Your domain appeared in ${citationScore}% of tested AI queries`
                    : `Your domain appeared in only ${citationScore}% of tested AI queries`,
                recommendation: citationScore >= 66
                    ? "Strong AI citation presence — continue producing authoritative content"
                    : citationScore >= 33
                        ? "Moderate citation presence — improve schema markup and E-E-A-T signals to increase citations"
                         
                        : "Low citation presence — focus on FAQ schema, author attribution, and Organization markup to get picked up",
            })
        }
    }

    // ── MULTI-MODEL AI TRACKING ──────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let multiModelResults = { results: [] as any[], overallScore: 0 };
    let googleAioResult = { score: 0 };

    if (!lite) {
        multiModelResults = await auditMultiModelMentions(domain, coreServices, brandNameOverride);

        // We check the top keyword or just the brand name for Google AIO
        const aioKeyword = coreServices ? `${domain.split('.')[0]} ${coreServices}` : domain.split('.')[0]
        googleAioResult = await checkGoogleAIOverview(domain, aioKeyword)
    }

    const multiEngineScore = {
        perplexity: Math.max(0, citationScore),
        chatgpt: multiModelResults.results.find(r => r.model === "ChatGPT")?.confidence ?? 0,
        googleAio: googleAioResult.score,
        claude: multiModelResults.results.find(r => r.model === "Claude")?.confidence ?? 0,
     
    }

    const generativeShareOfVoice = Math.round(
        (multiEngineScore.perplexity + multiEngineScore.chatgpt + multiEngineScore.googleAio + multiEngineScore.claude + multiModelResults.overallScore) / 5
    )

    // ── AI FACT VERIFICATION ───────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let factVerification = { checks: [] as any[] };
    if (!lite) {
        // Extract some "facts" to verify. In a real scenario, these could be from a brand profile.
        const factsToVerify = [
            { label: "Core Services", value: coreServices || "N/A" },
            { label: "Brand Name", value: domain.split('.')[0] }
        ];

        factVerification = await verifyBrandFacts(domain, factsToVerify);

        checks.push({
            id: "gsov_total",
            category: "citation",
            label: "Generative Share of Voice",
            passed: generativeShareOfVoice > 40,
            impact: "high",
            detail: `Your brand has a ${generativeShareOfVoice}% average visibility across Perplexity, ChatGPT, and Google AI Overviews.`,
            recommendation: generativeShareOfVoice > 60
                ? "Strong GSoV — your site is a primary source for major AI engines."
                : "Low GSoV — improve your technical AI-readiness and entity density to be cited more often."
        })
    }

    // ── CITATION LIKELIHOOD ──────────────────────────────────────────────────

    const citationLikelihood = predictCitationLikelihood(checks)

    // ── SCORE CALCULATION ────────────────────────────────────────────────────

    const weights: Record<AeoCheck["impact"], number> = { high: 15, medium: 8, low: 4 }
    const totalWeight = checks.reduce((sum, c) => sum + weights[c.impact], 0)
    const earnedWeight = checks.filter(c => c.passed).reduce((sum, c) => sum + weights[c.impact], 0)
    const score = Math.round((earnedWeight / totalWeight) * 100)

    const grade: AeoResult["grade"] =
        score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F"

    // Surface the top failing rec from each layer, plus fill remaining slots from high-impact
    const pickTopFail = (cats: AeoCheck["category"][]): string | null =>
        checks.find(c => cats.includes(c.category) && !c.passed && c.impact !== "low")?.recommendation ?? null

    const aeoRec = pickTopFail(["schema", "eeat", "content", "technical", "citation"])
    const geoRec = pickTopFail(["geo"])
    const aioRec = pickTopFail(["aio"])
    const layerRecs = [aeoRec, geoRec, aioRec].filter((r): r is string => r !== null)
    const remainingRecs = checks
        .filter(c => !c.passed && c.impact === "high" && !layerRecs.includes(c.recommendation))
        .map(c => c.recommendation)
    const topRecommendations = [...new Set([...layerRecs, ...remainingRecs])].slice(0, 5)

    const layerScores = {
        aeo: computeLayerScore(checks, ["schema", "eeat", "content", "technical", "citation"]),
        geo: computeLayerScore(checks, ["geo"]),
        aio: computeLayerScore(checks, ["aio"]),
    }

    // ── Fix 4: Build AEO Diagnosis from aiShareOfVoice (real table) ──────────
    // The previous code checked (prisma as any).aeoTracking which is always a
    // truthy object (not the table), so it always tried .findMany() and always
    // threw. The real table is aiShareOfVoice.
    let diagnosis: AeoDiagnosis | null = null;
    try {
        const diagnosisSite = await prisma.site.findFirst({
            where: { domain },
            select: { id: true },
        });

        if (diagnosisSite) {
            const trackingRows = await prisma.aiShareOfVoice.findMany({
                where: { siteId: diagnosisSite.id },
                orderBy: { recordedAt: "desc" },
                take: 100,
                select: {
                    keyword: true,
                    brandMentioned: true,
                    competitorsMentioned: true,
                    recordedAt: true,
                },
            });

            const mentionRecords: MentionRecord[] = trackingRows.map((row) => ({
                keyword: row.keyword,
                mentioned: row.brandMentioned,
                competitorsMentioned: Array.isArray(row.competitorsMentioned)
                    ? row.competitorsMentioned
                    : [],
                queriedAt: row.recordedAt,
            }));

            // Inject explicit brand name hints so diagnosis doesn't misclassify
            // generic short queries as branded based on token overlap.
            const diagnosisDomainSlug = domain.replace(/\..+$/, "");
            const diagnosisBrandHints = [
                ...(brandNameOverride ? [brandNameOverride] : []),
                diagnosisDomainSlug,
            ].filter(Boolean);

            diagnosis = diagnoseAeoData(mentionRecords, [], diagnosisBrandHints);
        }
    } catch (err: unknown) {
        logger.error("[AEO Audit] Diagnosis build failed (non-fatal):", {
            error: (err as Error)?.message ?? String(err),
        });
    }

    const result: AeoResult = {
        url,
        score,
        grade,
        checks,
        schemaTypes,
        schemaGaps,
        citationScore: Math.max(0, citationScore),
        multiEngineScore,
        generativeShareOfVoice,
        citationLikelihood,
        multiModelResults: multiModelResults.results,
        modelCitationResults: { models: fanOutResults },
        factCheckResults: factVerification.checks,
        topRecommendations,
        scannedAt: new Date(),
        layerScores,
        diagnosis,
        missingIntegrations: [
            ...(!process.env.PERPLEXITY_API_KEY ? ['Perplexity (PERPLEXITY_API_KEY)'] : []),
            ...(!process.env.SERPAPI_KEY ? ['SerpAPI/Google AIO (SERPAPI_KEY)'] : []),
            ...(!process.env.GOOGLE_KG_API_KEY ? ['Google Knowledge Graph (GOOGLE_KG_API_KEY)'] : []),
        ].filter(Boolean),
    }

    const site = await prisma.site.findFirst({ where: { domain } })
    if (site) {
        await saveAeoSnapshot(site.id, result).catch(err =>
            logger.error("[AEO Audit] Snapshot save failed:", { error: (err as Error)?.message || String(err) })
        )
    }

    return result
}

export const runAeoAuditLite = async (domain: string, coreServices?: string | null, brandNameOverride?: string | null): Promise<AeoResult> => {
    return runAeoAudit(domain, coreServices, true, brandNameOverride);
};