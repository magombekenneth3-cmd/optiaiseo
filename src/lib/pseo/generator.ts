import { logger } from "@/lib/logger";
import { callGeminiJson } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";

export interface PseoVariableRow {
    [key: string]: string;
}

export interface PseoBatchRequest {
    pattern: string;
    dataset: PseoVariableRow[];
    siteId: string;
    siteDomain: string;
    authorName?: string;
}

export interface PseoGeneratedPage {
    slug: string;
    title: string;
    metaDescription: string;
    contentHtml: string;
    schemaJsonLd: Record<string, unknown>[];
    heroVisualSvg: string;
    imagePrompt: string;
    variableData: PseoVariableRow;
}

export interface PseoBatchResult {
    pattern: string;
    totalGenerated: number;
    pages: PseoGeneratedPage[];
}

export function replacePlaceholders(template: string, data: PseoVariableRow): string {
    let result = template;
    for (const [key, val] of Object.entries(data)) {
        const regex = new RegExp(`\\[${key}\\]`, "gi");
        result = result.replace(regex, val);
    }
    return result;
}

function generateDynamicSvgBanner(title: string, subtitle: string): string {
    const escTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escSub = subtitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="100%" height="100%">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGrad)"/>
  <circle cx="1000" cy="150" r="250" fill="#38bdf8" opacity="0.08"/>
  <rect x="80" y="80" width="160" height="36" rx="18" fill="url(#accentGrad)" opacity="0.9"/>
  <text x="160" y="103" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="middle">VERIFIED SERVICE</text>
  <text x="80" y="240" font-family="system-ui, sans-serif" font-size="48" font-weight="800" fill="#ffffff">${escTitle.slice(0, 42)}</text>
  <text x="80" y="310" font-family="system-ui, sans-serif" font-size="24" font-weight="500" fill="#94a3b8">${escSub.slice(0, 60)}</text>
  <rect x="80" y="480" width="1040" height="1" fill="#334155"/>
  <text x="80" y="530" font-family="system-ui, sans-serif" font-size="18" font-weight="600" fill="#38bdf8">OptiAISEO Programmatic Engine</text>
</svg>`;
}

export async function generateSinglePseoPage(
    pattern: string,
    row: PseoVariableRow,
    siteDomain: string,
    authorName = "Editorial Team"
): Promise<PseoGeneratedPage> {
    const rawTitle = replacePlaceholders(pattern, row);
    const primaryVar = Object.values(row)[0] || "Service";
    const secondaryVar = Object.values(row)[1] || "Location";

    const slug = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const pageUrl = `https://${siteDomain}/${slug}`;

    const prompt = `You are an expert Programmatic SEO content generator.
Generate a unique, high-intent landing page targeting: "${rawTitle}".
Variable Row Data: ${JSON.stringify(row)}
Site Domain: ${siteDomain}

Respond in strict JSON:
{
  "title": "${rawTitle}",
  "metaDescription": "Concise 140-160 char meta description including ${primaryVar} and ${secondaryVar}.",
  "heroSubtitle": "1-sentence compelling value proposition for ${primaryVar} in ${secondaryVar}.",
  "imagePrompt": "Detailed visual image prompt for generating custom banner graphic.",
  "sections": [
    {
      "heading": "Overview of ${primaryVar} in ${secondaryVar}",
      "body": "200-word specific explanation of services, features, and local/niche fit."
    },
    {
      "heading": "Key Benefits & Deliverables",
      "body": "Detailed breakdown of deliverables and expected ROI metrics."
    },
    {
      "heading": "Frequently Asked Questions",
      "body": "Direct Q&A answers targeting common buyer objections."
    }
  ],
  "faqs": [
    { "question": "What is the cost of ${primaryVar} in ${secondaryVar}?", "answer": "Pricing depends on scope, starting from competitive baseline packages." },
    { "question": "How fast can ${primaryVar} be delivered?", "answer": "Turnaround ranges between 24 hours to 5 business days." }
  ]
}`;

    const fallbackOutput = {
        title: rawTitle,
        metaDescription: `Get top-rated ${primaryVar} solutions in ${secondaryVar}. Verified results and expert support.`,
        heroSubtitle: `Professional ${primaryVar} services tailored for ${secondaryVar}.`,
        imagePrompt: `Professional vector graphic depicting ${primaryVar} in ${secondaryVar}`,
        sections: [
            { heading: `Overview of ${primaryVar}`, body: `High-performance ${primaryVar} tailored for ${secondaryVar}.` },
            { heading: `Why Choose Us`, body: `Proven track record of delivering ${primaryVar} with verified results.` }
        ],
        faqs: [
            { question: `How to get started with ${primaryVar}?`, answer: `Contact our team to schedule a consultation.` }
        ]
    };

    let aiData = fallbackOutput;
    try {
        if (process.env.GEMINI_API_KEY) {
            aiData = await callGeminiJson<typeof fallbackOutput>(prompt, {
                model: AI_MODELS.GEMINI_FLASH,
                temperature: 0.3,
            });
        }
    } catch (err: unknown) {
        logger.warn("[pSEO] Page generation fallback used:", { error: (err as Error)?.message });
    }

    const contentHtml = `
<section class="pseo-hero">
  <h1>${aiData.title}</h1>
  <p class="lead">${aiData.heroSubtitle}</p>
</section>
${aiData.sections.map(s => `
<section class="pseo-section">
  <h2>${s.heading}</h2>
  <p>${s.body}</p>
</section>`).join("\n")}
<section class="pseo-faqs">
  <h2>Frequently Asked Questions</h2>
  ${aiData.faqs.map(f => `
  <div class="faq-item">
    <h3>${f.question}</h3>
    <p>${f.answer}</p>
  </div>`).join("\n")}
</section>`;

    const heroVisualSvg = generateDynamicSvgBanner(aiData.title, aiData.heroSubtitle);

    const schemaJsonLd = [
        {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": aiData.title,
            "url": pageUrl,
            "description": aiData.metaDescription
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": `https://${siteDomain}` },
                { "@type": "ListItem", "position": 2, "name": aiData.title, "item": pageUrl }
            ]
        },
        {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": aiData.title,
            "provider": {
                "@type": "Organization",
                "name": authorName,
                "url": `https://${siteDomain}`
            },
            "areaServed": {
                "@type": "Place",
                "name": secondaryVar
            }
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": aiData.faqs.map(f => ({
                "@type": "Question",
                "name": f.question,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f.answer
                }
            }))
        }
    ];

    return {
        slug,
        title: aiData.title,
        metaDescription: aiData.metaDescription,
        contentHtml,
        schemaJsonLd,
        heroVisualSvg,
        imagePrompt: aiData.imagePrompt,
        variableData: row,
    };
}

export async function generatePseoBatch(req: PseoBatchRequest): Promise<PseoBatchResult> {
    const pages: PseoGeneratedPage[] = [];

    for (const row of req.dataset) {
        try {
            const page = await generateSinglePseoPage(req.pattern, row, req.siteDomain, req.authorName);
            pages.push(page);
        } catch (err: unknown) {
            logger.error("[pSEO] Single page generation failed:", { error: (err as Error)?.message });
        }
    }

    return {
        pattern: req.pattern,
        totalGenerated: pages.length,
        pages,
    };
}
