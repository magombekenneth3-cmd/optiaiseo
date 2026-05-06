import { logger } from "@/lib/logger";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SiteContext } from "./context";
import { injectInternalLinks } from "./internalLinks";
import { getFunnelForIntent, SearchIntent as FunnelIntent } from "../aeo/funnels";
import {
    getSerpContextForKeyword,
    classifySerpFormat,
    formatToPromptHint,
    buildCompetitorProfiles,
    buildCompetitorBeatStrategy,
} from "./serp";
import { AI_MODELS } from "@/lib/constants/ai-models";
import {
    PromptContext,
    SearchIntent,
    buildPromptContext,
    detectIntent,
    cleanDomainToDisplayName,
} from "./prompt-context";
import {
    getClaimRules,
    getToneRules,
    getStructureRules,
    getScopeRules,
    getAuthorGrounding,
    getHumanizePrompt,
    getComparisonTableRule,
    getQuickAnswerRule,
} from "./rules";
import {
    auditBannedPhrases,
    auditComparisonTable,
    auditRhythm,
    validateListCount,
    validateMetaDescription,
    validateQuickAnswerUniqueness,
    runCompositeValidation,
} from "./validators";

export interface BlogPostDraft {
    title: string;
    slug: string;
    content: string;
    contentMarkdown: string;
    excerpt: string;
    metaDescription: string;
    targetKeywords: string[];
    suggestedImagePrompt?: string;
    heroImage?: UnsplashPhoto;
    intent?: SearchIntent;
    validationErrors: string[];
    validationWarnings: string[];
    validationScore: number;
}

export interface AuthorProfile {
    name: string;
    role?: string;
    bio?: string;
    realExperience?: string | null;
    realNumbers?: string | null;
    localContext?: string | null;
}

interface UnsplashPhoto {
    url: string;
    thumb: string;
    alt: string;
    photographer: string;
    photographerUrl: string;
    unsplashUrl: string;
}

export interface GeminiBlogResponse {
    title: string;
    slug: string;
    content: string;
    excerpt: string;
    metaDescription: string;
    targetKeywords: string[];
    suggestedImagePrompt?: string;
    faqs: { question: string; answer: string }[];
    sections: { heading: string; imageQuery: string }[];
    quickAnswer: string;
    comparisonTable: {
        problem: string;
        industryAvg: string;
        fix: string;
        result: string;
    }[];
}

async function fetchUnsplashPhoto(query: string): Promise<UnsplashPhoto | null> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) return null;
    try {
        const encoded = encodeURIComponent(query.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
        const res = await fetch(
            `https://api.unsplash.com/search/photos?query=${encoded}&per_page=1&orientation=landscape`,
            {
                headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
                signal: AbortSignal.timeout(8000),
            }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const photo = data.results?.[0];
        if (!photo) return null;
        return {
            url: photo.urls.regular,
            thumb: photo.urls.small,
            alt: photo.alt_description || query,
            photographer: photo.user.name,
            photographerUrl: `${photo.user.links.html}?utm_source=seoTool&utm_medium=referral`,
            unsplashUrl: `${photo.links.html}?utm_source=seoTool&utm_medium=referral`,
        };
    } catch { return null; }
}

async function fetchBlogPhotos(heroQuery: string, sectionQueries: string[]) {
    const [hero, ...inline] = await Promise.all([
        fetchUnsplashPhoto(heroQuery),
        ...sectionQueries.slice(0, 3).map(q => fetchUnsplashPhoto(q)),
    ]);
    return { hero, inline };
}

function mdToHtml(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function assembleHtml(params: {
    content: string;
    faqs: { question: string; answer: string }[];
    hero: UnsplashPhoto | null;
    inlinePhotos: (UnsplashPhoto | null)[];
    quickAnswer: string;
    comparisonTable: GeminiBlogResponse["comparisonTable"];
    author: AuthorProfile;
    funnelHtml?: string;
    ctx: PromptContext;
}): string {
    const { content, faqs, hero, inlinePhotos, quickAnswer, comparisonTable, author, funnelHtml, ctx } = params;

    let html = content
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
        .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
        .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
        .replace(/^(?!<[hul]|<\/[hul]|\|)(.+)$/gm, "<p>$1</p>")
        .replace(/<p>\s*<\/p>/g, "")
        .replace(/<p>(<h[1-6]>)/g, "$1")
        .replace(/(<\/h[1-6]>)<\/p>/g, "$1");

    html = html.replace(/<h1>[^<]*<\/h1>/gi, "");
    html = html.replace(/<h2>(.+?)<\/h2>/g, (_m, heading: string) => {
        const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return `<h2 id="${id}">${heading}</h2>`;
    });

    const h2Matches = [...html.matchAll(/<h2 id="([^"]+)">(.+?)<\/h2>/g)];
    const tocHtml = h2Matches.length >= 3 ? `
<nav style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem 1.5rem;margin:1.5rem 0;" aria-label="Table of contents">
  <p style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin:0 0 0.75rem;">In This Article</p>
  <ol style="margin:0;padding-left:1.25rem;color:#334155;font-size:0.9rem;line-height:1.8;">
    ${h2Matches.map(([, id, heading]) => `<li><a href="#${id}" style="color:#0ea5e9;text-decoration:none;font-weight:500;">${heading}</a></li>`).join("\n    ")}
  </ol>
</nav>` : "";

    let comparisonHtml = "";
    if (ctx.riskTier !== "high" && comparisonTable?.length > 0) {
        const { flaggedIndexes, warnings: tableWarnings } = auditComparisonTable(comparisonTable);
        tableWarnings.forEach(w => logger.warn("[Blog Engine] Table audit:", { warning: w }));

        if (flaggedIndexes.length === comparisonTable.length) {
            comparisonHtml = `
<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:1rem 1.25rem;margin:1.5rem 0;">
  <p style="margin:0;font-size:0.875rem;color:#92400e;line-height:1.6;">
    <strong>Editor:</strong> This comparison table contains unverified statistics.
    Replace the Result column with real data, or remove before publishing.
  </p>
</div>`;
        } else {
            const displayName = ctx.displayName ?? "Recommended Approach";
            comparisonHtml = `
<div style="margin:2rem 0;overflow-x:auto;border:1px solid #e5e7eb;border-radius:12px;">
  <table style="width:100%;border-collapse:collapse;font-size:0.9rem;text-align:left;">
    <thead style="background:#f8fafc;border-bottom:2px solid #e5e7eb;">
      <tr>
        <th style="padding:12px 16px;font-weight:700;color:#1e293b;">Problem</th>
        <th style="padding:12px 16px;font-weight:700;color:#1e293b;">Industry Average</th>
        <th style="padding:12px 16px;font-weight:700;color:#10b981;">${displayName}</th>
        <th style="padding:12px 16px;font-weight:700;color:#1e293b;">Result</th>
      </tr>
    </thead>
    <tbody style="color:#475569;">
      ${comparisonTable.map((row, i) => {
                const badge = flaggedIndexes.includes(i)
                    ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;margin-left:6px;font-weight:700;">[Verify]</span>`
                    : "";
                return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:12px 16px;color:#ef4444;font-weight:500;">${row.problem}</td>
        <td style="padding:12px 16px;">${row.industryAvg}</td>
        <td style="padding:12px 16px;color:#10b981;font-weight:600;">${row.fix}</td>
        <td style="padding:12px 16px;font-weight:700;">${row.result}${badge}</td>
      </tr>`;
            }).join("")}
    </tbody>
  </table>
</div>`;
        }
    }

    const qaCheck = validateQuickAnswerUniqueness(quickAnswer, html);
    const effectiveQA = qaCheck.warnings.length > 0
        ? `${quickAnswer} <em style="font-size:0.8rem;color:#94a3b8;">[Editor: review — too similar to intro]</em>`
        : quickAnswer;

    const summaryHtml = `
<div style="background:#f0f9ff;border:2px solid #bae6fd;border-left:6px solid #0ea5e9;border-radius:12px;padding:1.5rem;margin:1.5rem 0;">
  <p style="font-size:1.05rem;line-height:1.65;color:#0c4a6e;font-weight:500;margin:0;">${effectiveQA}</p>
</div>`;

    let photoIdx = 0;
    html = html.replace(/<h2 id="([^"]+)">(.+?)<\/h2>/g, (match) => {
        const photo = inlinePhotos[photoIdx++];
        if (!photo) return match;
        return `${match}
<figure style="margin:1.5rem 0;border-radius:12px;overflow:hidden;">
  <img src="${photo.url}" alt="${photo.alt}" loading="lazy" style="width:100%;height:320px;object-fit:cover;display:block;" />
  <figcaption style="font-size:0.75rem;color:#6b7280;padding:6px 10px;background:#f9fafb;">
    Photo by <a href="${photo.photographerUrl}" target="_blank" rel="noopener">${photo.photographer}</a> on <a href="${photo.unsplashUrl}" target="_blank" rel="noopener">Unsplash</a>
  </figcaption>
</figure>`;
    });

    const faqHtml = faqs.length > 0 ? `
<section style="margin-top:3rem;border-top:2px solid #e5e7eb;padding-top:2rem;">
  <h2 id="frequently-asked-questions" style="font-size:1.5rem;font-weight:800;color:#1e293b;margin-bottom:1.5rem;">Frequently Asked Questions</h2>
  ${faqs.map(faq => `
  <div style="margin-bottom:1rem;border:1px solid #f1f5f9;border-radius:12px;">
    <h3 style="padding:1rem;font-size:1rem;font-weight:700;background:#f8fafc;border-radius:12px;margin:0;">${mdToHtml(faq.question)}</h3>
    <p style="padding:0.75rem 1rem 1rem;color:#475569;line-height:1.6;margin:0;">${mdToHtml(faq.answer)}</p>
  </div>`).join("")}
</section>` : "";

    const authorHtml = `
<div style="margin-top:4rem;padding:2rem;background:#1e293b;color:#f8fafc;border-radius:16px;display:flex;gap:1.5rem;align-items:start;">
  <div style="width:56px;height:56px;border-radius:50%;background:#334155;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">✍️</div>
  <div>
    <p style="font-weight:800;font-size:1.05rem;margin:0 0 0.2rem;">${author.name}</p>
    ${author.role ? `<p style="font-size:0.8rem;color:#94a3b8;font-weight:600;text-transform:uppercase;margin:0 0 0.75rem;">${author.role}</p>` : ""}
    ${author.bio ? `<p style="font-size:0.9rem;line-height:1.6;color:#cbd5e1;margin:0;">${author.bio}</p>` : ""}
  </div>
</div>`;

    const nextStepsHtml = funnelHtml ? `
<section style="margin-top:3rem;padding:2rem;border:2px solid #e2e8f0;border-radius:16px;">
  <h2 id="next-steps" style="font-size:1.4rem;font-weight:800;color:#1e293b;margin-top:0;">Next Steps</h2>
  ${funnelHtml}
</section>` : "";

    const date = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

    return `
<p style="font-size:0.8rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">
  By ${author.name}${author.role ? ` · ${author.role}` : ""} · Updated ${date}
</p>
${hero ? `
<figure style="margin:1.5rem 0;border-radius:16px;overflow:hidden;">
  <img src="${hero.url}" alt="${hero.alt}" style="width:100%;height:420px;object-fit:cover;display:block;" />
  <figcaption style="font-size:0.75rem;color:#6b7280;padding:6px 10px;background:#f9fafb;">
    Photo by <a href="${hero.photographerUrl}" target="_blank" rel="noopener">${hero.photographer}</a> on <a href="${hero.unsplashUrl}" target="_blank" rel="noopener">Unsplash</a>
  </figcaption>
</figure>` : ""}
${summaryHtml}
${tocHtml}
${comparisonHtml}
${html}
${faqHtml}
${nextStepsHtml}
${authorHtml}`;
}

export const getAiClient = () => {
    if (!process.env.GEMINI_API_KEY) return null;
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 120000 } });
};

export function buildBlogResponseSchema(ctx: PromptContext): Schema {
    const wordTarget =
        ctx.intent === "transactional" ? 1500
        : ctx.intent === "commercial"  ? 2200
        : ctx.intent === "local"       ? 1800
        :                                2200;

    return {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: `Article title. Primary keyword \"${ctx.keyword}\" must appear within the first 60 characters. No click-bait superlatives.`,
            },
            slug: { type: Type.STRING },
            quickAnswer: {
                type: Type.STRING,
                description: getQuickAnswerRule(ctx),
            },
            comparisonTable: {
                type: Type.ARRAY,
                description: getComparisonTableRule(ctx),
                items: {
                    type: Type.OBJECT,
                    properties: {
                        problem: { type: Type.STRING },
                        industryAvg: { type: Type.STRING },
                        fix: { type: Type.STRING },
                        result: { type: Type.STRING },
                    },
                    required: ["problem", "industryAvg", "fix", "result"],
                },
            },
            content: {
                type: Type.STRING,
                description: `Full article in Markdown. Minimum ${wordTarget} words, maximum 6,000 words — do NOT exceed 6,000 words under any circumstances. ONE H1 = the title (keyword in first 60 chars). 5–8 H2s following the intent blueprint. H3s under H2s. Answer search intent in the FIRST 30% of the article. Keyword density 0.5–2.5% (keyword appears 8–15 times). No invented statistics. FAQs must mirror real People Also Ask queries — every FAQ answer opens with Yes/No/a number/a named tool.${ctx.riskTier === "high" ? " HIGH-RISK: Every claim needs a named source." : ""}`,
            },
            excerpt: { type: Type.STRING },
            metaDescription: {
                type: Type.STRING,
                description: `Exactly 140–160 characters. Primary keyword \"${ctx.keyword}\" within the first 120 characters. No superlatives. Written as ad copy — compels clicks.`,
            },
            targetKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedImagePrompt: { type: Type.STRING },
            faqs: {
                type: Type.ARRAY,
                description: `5–7 FAQ items aligned to real People Also Ask queries for "${ctx.keyword}". Each answer MUST open with: Yes / No / a number / a tool name / a time frame. Max 3 sentences per answer.`,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        answer: { type: Type.STRING },
                    },
                    required: ["question", "answer"],
                },
            },
            sections: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        heading: { type: Type.STRING },
                        imageQuery: { type: Type.STRING },
                    },
                    required: ["heading", "imageQuery"],
                },
            },
        },
        required: ["title", "slug", "content", "excerpt", "metaDescription",
            "targetKeywords", "faqs", "sections", "quickAnswer", "comparisonTable"],
    };
}

export async function humanizePost(content: string, ctx: PromptContext): Promise<string> {
    const ai = getAiClient();
    if (!ai) return content;
    try {
        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_3_FLASH,
            contents: getHumanizePrompt(content, ctx),
            config: { temperature: 0.9, maxOutputTokens: 6000 },
        });
        const humanized = response.text?.trim();
        if (!humanized || humanized.length < content.length * 0.5) return content;
        return humanized.replace(/^```html\n?/i, "").replace(/\n?```$/i, "");
    } catch {
        return content;
    }
}

export async function buildPost(
    geminiResponse: GeminiBlogResponse,
    author: AuthorProfile,
    ctx: PromptContext,
    siteId?: string
): Promise<BlogPostDraft> {
    const { title, slug, content, excerpt, metaDescription, targetKeywords, faqs, sections, suggestedImagePrompt } = geminiResponse;

    const heroQuery = suggestedImagePrompt ?? targetKeywords[0] ?? title;
    const sectionQueries = sections?.map(s => s.imageQuery) ?? targetKeywords.slice(1, 4);
    const { hero, inline } = await fetchBlogPhotos(heroQuery, sectionQueries);

    const funnelIntent = (ctx.intent === "local" ? "informational" : ctx.intent) as FunnelIntent;
    const funnel = getFunnelForIntent(
        funnelIntent,
        siteId || "unknown",
        ctx.siteDomain ? `https://${ctx.siteDomain}` : "https://example.com",
        ctx.displayName || ctx.siteDomain?.split(".")[0] || "Our Platform"
    );

    let assembled = assembleHtml({
        content,
        faqs: faqs ?? [],
        hero,
        inlinePhotos: inline,
        quickAnswer: geminiResponse.quickAnswer,
        comparisonTable: geminiResponse.comparisonTable,
        author,
        funnelHtml: funnel.htmlSnippet,
        ctx,
    });

    if (siteId) {
        assembled = await injectInternalLinks(assembled, siteId, slug);
    }

    logger.debug("[Blog Engine] Running humanization pass...", { keyword: ctx.keyword });
    assembled = await humanizePost(assembled, ctx);

    const rhythmWarnings = auditRhythm(assembled);
    const bannedWarnings = auditBannedPhrases(assembled).warnings;
    const listCountErrors = validateListCount(title, assembled).errors;
    const metaResult = validateMetaDescription(metaDescription);

    const validation = runCompositeValidation({
        title,
        htmlContent: assembled,
        markdownContent: content,
        metaDescription,
        quickAnswer: geminiResponse.quickAnswer,
        comparisonTable: geminiResponse.comparisonTable,
        author,
    });

    const allWarnings = [...validation.warnings, ...rhythmWarnings, ...bannedWarnings, ...metaResult.warnings];
    const allErrors = [...validation.errors, ...listCountErrors, ...metaResult.errors];

    if (allWarnings.length > 0) logger.warn("[Blog Engine] Post-audit warnings", { title, warnings: allWarnings });
    if (allErrors.length > 0) logger.error("[Blog Engine] Post-audit errors — forcing DRAFT", { title, errors: allErrors });

    return {
        title,
        slug,
        content: assembled,
        contentMarkdown: content,
        excerpt,
        metaDescription,
        targetKeywords,
        suggestedImagePrompt,
        heroImage: hero ?? undefined,
        intent: ctx.intent,
        validationErrors: allErrors,
        validationWarnings: allWarnings,
        validationScore: validation.score,
    };
}

export async function generateTrendingPost(
    industry: string,
    country: string,
    author: AuthorProfile,
    siteDomain?: string,
    siteId?: string
): Promise<BlogPostDraft> {
    const ai = getAiClient();
    if (!ai) throw new Error("GEMINI_API_KEY is missing.");

    const ctx = buildPromptContext({
        keyword: industry,
        category: industry,
        intent: "informational",
        hasAuthorGrounding: !!(author.realExperience || author.realNumbers),
        displayName: cleanDomainToDisplayName(siteDomain ?? ""),
        siteDomain,
    });

    const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_3_FLASH,
        contents: `You are a senior journalist writing about ${industry} for an audience in ${country}.

GOAL: Produce the single most useful article on this topic — one practitioners in ${industry} would bookmark and that Perplexity/ChatGPT would cite.

${getClaimRules(ctx)}
${getToneRules(ctx)}
${getScopeRules(ctx)}
${getStructureRules(ctx)}
${getAuthorGrounding(author, ctx)}

CONTENT STRUCTURE — follow exactly:
- Intro: 3 sentences per intro rule above. Open with the single most useful fact about ${industry} for ${country} right now.
- H2: What Is Actually Happening in ${industry} Right Now (name specific companies, tools, people)
- H2: Why This Matters for ${country} Specifically (local context: regulations, platforms, buyer behaviour)
- H2: What Most Guides Get Wrong About ${industry} (one contrarian point with a specific reason)
- H2: Step-by-Step: How to Respond Right Now (numbered H3 steps — concrete actions)
- H2: Real Example — What Worked and What Didn't (use [ADD REAL CASE STUDY] if unknown, never invent)
- H2: Frequently Asked Questions (5-7 Q&A, every answer starts with Yes/No/number/named thing)

TITLE-COUNT RULE: If the title contains a number, the content must contain exactly that many H3 items.

Updated ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: buildBlogResponseSchema(ctx),
            temperature: 0.7,
            maxOutputTokens: 8192,
        },
    });

    if (!response.text) throw new Error("Gemini returned empty text.");
    return buildPost(JSON.parse(response.text) as GeminiBlogResponse, author, ctx, siteId);
}

export async function generateEvergreenPost(
    category: string,
    keywords: string[],
    author: AuthorProfile,
    siteContext?: SiteContext | null,
    tone?: string,
    siteId?: string
): Promise<BlogPostDraft> {
    const ai = getAiClient();
    if (!ai) throw new Error("GEMINI_API_KEY is missing.");

    const primaryKeyword = keywords[0];
    const displayName = siteContext?.title.split(" — ")[0] ?? cleanDomainToDisplayName(siteContext?.domain ?? "");

    const ctx = buildPromptContext({
        keyword: primaryKeyword,
        category,
        intent: "informational",
        hasAuthorGrounding: !!(author.realExperience || author.realNumbers),
        displayName,
        siteDomain: siteContext?.domain,
    });

    const siteGrounding = siteContext ? `
Business context:
- Name: "${displayName}"
- Description: "${siteContext.description}"
- Services: ${siteContext.headings.slice(0, 5).join(" | ")}

Position ${displayName} as the authority where naturally relevant — educate first, sell second.` : "";

    let serpContextSection = "";
    let formatHint = "";
    let beatStrategy = "";
    try {
        const serpData = await getSerpContextForKeyword(primaryKeyword, true);
        if (serpData) {
            serpContextSection = `\n${serpData.formattedContext}`;
            const formatSignal = classifySerpFormat(serpData.results);
            formatHint = `\n${formatToPromptHint(formatSignal, primaryKeyword)}`;
            const profiles = buildCompetitorProfiles(serpData.results);
            if (profiles.length > 0) {
                beatStrategy = `\n${buildCompetitorBeatStrategy(profiles, primaryKeyword)}`;
            }
            if (formatSignal.format === "tool" && formatSignal.confidence === "high") {
                logger.warn(`[Blog Engine] SERP for "${primaryKeyword}" is tool-dominated. A blog may underperform.`);
            }
        }
    } catch (e: unknown) {
        logger.error("[Blog Engine] SERP context failed:", { error: (e as Error)?.message });
    }

    const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_3_FLASH,
        contents: `You are a senior technical writer producing a definitive guide on: "${category}".

Target keywords: ${keywords.join(", ")}
PRIMARY KEYWORD: "${primaryKeyword}"
${siteGrounding}
${serpContextSection}
${formatHint}
${beatStrategy}
${getClaimRules(ctx)}
${getToneRules(ctx)}
${getScopeRules(ctx)}
${getStructureRules(ctx)}
${getAuthorGrounding(author, ctx)}

CONTENT STRUCTURE — derive from the SERP data above, not from a template:
- Open with the single most useful insight a practitioner would not already know
- Cover every table-stakes section listed in the beat strategy (these are mandatory)
- Dedicate at least one H2 to an underserved angle competitors miss
- Include one "Honest take:" paragraph with a frank editorial opinion
- Close with a Frequently Asked Questions section — answers must start with Yes/No/a number/a named tool
- DO NOT follow a predictable "What is X → Why X matters → How to X" template unless the SERP data shows that format wins

KEYWORD RULES: "${primaryKeyword}" in first sentence. Used 8-15 times. In at least 2 H2s.
TITLE-COUNT RULE: If title contains a number, content must have exactly that many H3 items.
Tone: ${tone || "Authoritative and direct — trusted expert explaining to a peer, not a textbook"}.
${ctx.riskTier === "high" ? "HIGH-RISK: Add a disclaimer section — informational only, not professional advice." : ""}
Updated ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: buildBlogResponseSchema(ctx),
            temperature: 0.7,
            maxOutputTokens: 8192,
        },
    });

    if (!response.text) throw new Error("Gemini returned empty text.");
    return buildPost(JSON.parse(response.text) as GeminiBlogResponse, author, ctx, siteId);
}

export async function generateBlogFromKeywordGap(
    keyword: string,
    position: number,
    impressions: number,
    author: AuthorProfile,
    targetUrl?: string,
    siteDomain?: string,
    intentOverride?: string,
    siteId?: string
): Promise<BlogPostDraft> {
    const ai = getAiClient();
    if (!ai) throw new Error("GEMINI_API_KEY is missing.");

    const intent = (intentOverride as SearchIntent) ?? detectIntent(keyword);
    const ctx = buildPromptContext({
        keyword,
        category: keyword,
        intent,
        hasAuthorGrounding: !!(author.realExperience || author.realNumbers),
        displayName: cleanDomainToDisplayName(siteDomain ?? ""),
        siteDomain,
    });

    const positionHint =
        position > 20 ? "barely visible — write highly authoritative, exhaustive content"
            : position > 10 ? "on page 2 — write content detailed enough to overtake page 1"
                : "on page 1 but ranking low — write content that deserves top 3";

    let serpContextSection = "";
    let formatHint = "";
    let beatStrategy = "";
    try {
        const serpData = await getSerpContextForKeyword(keyword, true);
        if (serpData) {
            serpContextSection = `\n${serpData.formattedContext}`;
            const formatSignal = classifySerpFormat(serpData.results);
            formatHint = `\n${formatToPromptHint(formatSignal, keyword)}`;
            const profiles = buildCompetitorProfiles(serpData.results);
            if (profiles.length > 0) {
                beatStrategy = `\n${buildCompetitorBeatStrategy(profiles, keyword)}`;
            }
        }
    } catch (e: unknown) {
        logger.error("[Blog Engine] SERP context failed:", { error: (e as Error)?.message });
    }

    const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_3_FLASH,
        contents: `You are a senior SEO content strategist. Write an article targeting: "${keyword}".

CONTEXT:
- Current SERP position: ${position} (${positionHint})
- Monthly impressions: ${impressions.toLocaleString()}
- Search intent: ${intent}
- Site: ${siteDomain || "our site"}
${targetUrl ? `- Existing URL to improve: ${targetUrl}` : ""}
${serpContextSection}
${formatHint}
${beatStrategy}
${getClaimRules(ctx)}
${getToneRules(ctx)}
${getScopeRules(ctx)}
${getStructureRules(ctx)}
${getAuthorGrounding(author, ctx)}

CONTENT STRUCTURE — built from the SERP data above:
- Structure must be derived from competitor gaps, not a default template
- Must cover every table-stakes heading competitors share
- Must go deeper on at least one underserved angle no competitor fully addresses
- Include an "Honest take:" paragraph with a real editorial opinion
- FAQ section at the end; each answer starts with Yes/No/a number/a named tool

KEYWORD RULES: "${keyword}" in first sentence. Used 8-15 times. In at least 2 H2s. 10+ semantic variations.
TITLE-COUNT RULE: If title contains a number, content must have exactly that many H3 items.
${ctx.riskTier === "high" ? "HIGH-RISK: Add a disclaimer section — informational only, not professional advice." : ""}
Updated ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: buildBlogResponseSchema(ctx),
            temperature: 0.4,
            maxOutputTokens: 8192,
        },
    });

    if (!response.text) throw new Error("Gemini returned empty text.");
    return buildPost(JSON.parse(response.text) as GeminiBlogResponse, author, ctx, siteId);
}

export async function generateBlogFromCompetitorGap(
    keyword: string,
    competitorDomain: string,
    searchVolume: number,
    difficulty: number,
    author: AuthorProfile,
    siteDomain?: string,
    intentOverride?: string,
    tone?: string,
    siteId?: string
): Promise<BlogPostDraft> {
    const ai = getAiClient();
    if (!ai) throw new Error("GEMINI_API_KEY is missing.");

    const intent = (intentOverride as SearchIntent) ?? detectIntent(keyword);
    const ctx = buildPromptContext({
        keyword,
        category: keyword,
        intent,
        hasAuthorGrounding: !!(author.realExperience || author.realNumbers),
        displayName: cleanDomainToDisplayName(siteDomain ?? ""),
        siteDomain,
    });

    let serpContextSection = "";
    let formatHint = "";
    let beatStrategy = "";
    try {
        const serpData = await getSerpContextForKeyword(keyword, true);
        if (serpData) {
            serpContextSection = `\n${serpData.formattedContext}`;
            const formatSignal = classifySerpFormat(serpData.results);
            formatHint = `\n${formatToPromptHint(formatSignal, keyword)}`;
            const profiles = buildCompetitorProfiles(serpData.results);
            if (profiles.length > 0) {
                beatStrategy = `\n${buildCompetitorBeatStrategy(profiles, keyword)}`;
            }
        }
    } catch (e: unknown) {
        logger.error("[Blog Engine] SERP context failed:", { error: (e as Error)?.message });
    }

    const response = await ai.models.generateContent({
        model: AI_MODELS.GEMINI_3_FLASH,
        contents: `You are a senior content strategist at ${ctx.displayName || siteDomain || "our company"}.
Write expert content that outranks "${competitorDomain}" for "${keyword}".

CONTEXT:
- Keyword: "${keyword}"
- Monthly search volume: ${searchVolume.toLocaleString()}
- SEO difficulty: ${difficulty}/100
- Competitor to outrank: ${competitorDomain}
${serpContextSection}
${formatHint}
${beatStrategy}
${getClaimRules(ctx)}
${getToneRules(ctx)}
${getScopeRules(ctx)}
${getStructureRules(ctx)}
${getAuthorGrounding(author, ctx)}

COMPETITOR GAP APPROACH:
${beatStrategy ? "Use the beat strategy above to drive your structure." : `Think about what ${competitorDomain}'s article likely lacks — generic advice, missing depth, no real examples.`}
Do NOT open with "Are you looking for…" or "In this article…" or any variation.
Open with the single most surprising or useful fact about "${keyword}" — something a practitioner would not expect.
Take a clear editorial position early. Include one "Honest take:" paragraph with frank opinion, not sales copy.

KEYWORD RULES: "${keyword}" in first sentence. Used 10-16 times. In at least 2 H2s. 12+ semantic variations.
TITLE-COUNT RULE: If title contains a number, content must have exactly that many H3 items.
Tone: ${tone || "Authoritative and direct"}.
${ctx.riskTier === "high" ? "HIGH-RISK: Add a disclaimer section — informational only, not professional advice." : ""}
Updated ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: buildBlogResponseSchema(ctx),
            temperature: 0.4,
            maxOutputTokens: 8192,
        },
    });

    if (!response.text) throw new Error("Gemini returned empty text.");
    return buildPost(JSON.parse(response.text) as GeminiBlogResponse, author, ctx, siteId);
}