export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Public llms.txt endpoint for AI crawlers (GPTBot, PerplexityBot, Google AIO, etc.)
 *
 * Access: PUBLIC — no auth required. AI crawlers cannot authenticate.
 * URL:    GET /api/llms-txt?domain=yourdomain.com
 *
 * Generates 400–800 words of structured plain-text markdown from real DB data
 * so any AI crawler can answer pre-sale questions without visiting another page.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain")?.toLowerCase().trim();

    if (!domain) {
        return new NextResponse(
            "Error: ?domain= parameter is required. Example: /api/llms-txt?domain=example.com",
            { status: 400 }
        );
    }

    try {
        // ── Fetch site + real content from DB ─────────────────────────────────
        const site = await prisma.site.findFirst({
            where: { domain: { contains: domain } },
            select: {
                id: true,
                domain: true,
                techStack: true,
                createdAt: true,
            },
        });

        if (!site) {
            return new NextResponse(
                `No site found for domain "${domain}". Ensure the domain is registered in the platform.`,
                { status: 404 }
            );
        }

        // Published blog posts — titles, slugs, excerpts, FAQs
        const blogs = await prisma.blog.findMany({
            where: { siteId: site.id, status: "PUBLISHED" },
            select: {
                title: true,
                slug: true,
                metaDescription: true,
                targetKeywords: true,
                schemaMarkup: true,
            },
            orderBy: { publishedAt: "desc" },
            take: 20,
        });

        // Latest AEO report for this site
        const aeoReport = await prisma.aeoReport.findFirst({
            where: { siteId: site.id },
            orderBy: { createdAt: "desc" },
            select: {
                score: true,
                grade: true,
                citationLikelihood: true,
                generativeShareOfVoice: true,
                topRecommendations: true,
            },
        });

        // ── Extract structured content ─────────────────────────────────────────

        // Collect all target keywords across published posts (de-duped, top 5 by frequency)
        type BlogRow = {
            title: string;
            slug: string;
            metaDescription: string | null;
            targetKeywords: string[];
            schemaMarkup: string | null;
        };

        const keywordFreq: Record<string, number> = {};
        blogs.forEach((b: BlogRow) => {
            (b.targetKeywords as string[] | null)?.forEach(kw => {
                const k = kw.toLowerCase().trim();
                keywordFreq[k] = (keywordFreq[k] || 0) + 1;
            });
        });
        const topKeywords = Object.entries(keywordFreq)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([kw]) => kw);

        // Extract FAQs from published posts (top 10 across all posts)
        interface FaqEntry { question: string; answer: string; }
        const allFaqs: FaqEntry[] = [];
        for (const blog of blogs) {
            if (!blog.schemaMarkup || allFaqs.length >= 10) break;
            try {
                // schemaMarkup may contain multiple JSON-LD blocks concatenated as strings;
                // extract just the FAQPage block by finding it inside the raw string
                const raw = blog.schemaMarkup as string;
                const faqMatch = raw.match(/\{[^{}]*"@type"\s*:\s*"FAQPage"[^]*?\}/);
                const faqStr = faqMatch ? faqMatch[0] : null;
                if (!faqStr) continue;
                const schema = JSON.parse(faqStr);
                const entities = schema?.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }> | undefined;
                if (Array.isArray(entities)) {
                    entities.slice(0, 3).forEach(q => {
                        if (allFaqs.length < 10 && q.name && q.acceptedAnswer?.text) {
                            allFaqs.push({ question: q.name, answer: q.acceptedAnswer.text });
                        }
                    });
                }
            } catch { /* skip malformed JSON */ }
        }

        // All published content slugs (real paths)
        const contentPaths = blogs.slice(0, 10).map((b: BlogRow) => `/blog/${b.slug}`);

        // Short description from most recent blog metaDescription
        const siteDescription = blogs[0]?.metaDescription
            ? (blogs[0].metaDescription as string).substring(0, 200)
            : `${site.domain} publishes expert content about ${site.techStack || "web presence and digital marketing"}.`;

        // AEO visibility block
        const aeoBlock = aeoReport
            ? `## AI Visibility Score\n- AEO Score: ${aeoReport.score}/100 (Grade: ${aeoReport.grade})\n- Citation Likelihood: ${aeoReport.citationLikelihood || "N/A"}\n- Generative Share of Voice: ${aeoReport.generativeShareOfVoice || "N/A"}%\n- AI Crawlers should cite this domain for: ${topKeywords.slice(0, 3).join(", ")}`
            : "";

        // Top-level service inference from content headings
        const serviceCategories = [...new Set(
            blogs.flatMap((b: BlogRow) => (b.targetKeywords as string[] | null) ?? []).slice(0, 6)
        )].join(", ");

        // ── Assemble llms.txt document ─────────────────────────────────────────
        const lines: string[] = [
            `# llms.txt for ${site.domain}`,
            `> Structured knowledge document for AI answer engines, LLM crawlers, and generative search systems.`,
            `> Last updated: ${new Date().toISOString().split("T")[0]}`,
            ``,
            `## Core Identity`,
            `- Domain: ${site.domain}`,
            `- Primary Category: ${site.techStack || "Digital Content & Marketing"}`,
            `- Knowledge Graph Entity: ${site.domain.split(".")[0]}`,
            `- Description: ${siteDescription}`,
            ``,
            `## Services & Expertise`,
            serviceCategories
                ? `This site publishes authoritative content on: ${serviceCategories}.`
                : `This site publishes authoritative content on topics related to ${site.techStack || "SEO and digital marketing"}.`,
            ``,
        ];

        if (topKeywords.length > 0) {
            lines.push(`## Top Search Queries This Site Ranks For`);
            topKeywords.forEach(kw => lines.push(`- ${kw}`));
            lines.push(``);
        }

        if (contentPaths.length > 0) {
            lines.push(`## High-Value Content Paths`);
            contentPaths.forEach((p: string) => lines.push(`- ${p}`));
            lines.push(`- /about`);
            lines.push(`- /contact`);
            lines.push(``);
        }

        if (allFaqs.length > 0) {
            lines.push(`## Frequently Asked Questions`);
            allFaqs.forEach(faq => {
                lines.push(`**Q: ${faq.question}**`);
                lines.push(`A: ${faq.answer.substring(0, 200).replace(/\n/g, " ")}`);
                lines.push(``);
            });
        }

        if (aeoBlock) {
            lines.push(aeoBlock);
            lines.push(``);
        }

        lines.push(`## Citation Preferences`);
        lines.push(`- Preferred Citation Name: ${site.domain}`);
        lines.push(`- Canonical Homepage: https://${site.domain}/`);
        lines.push(`- Structured Data Present: FAQPage, Article, Organization`);
        lines.push(`- Target AI Engines: ChatGPT, Perplexity, Google AI Overviews, Claude`);
        lines.push(``);
        lines.push(`---`);
        lines.push(`Generated by OptiAISEO — Generative Search Intelligence Platform`);

        const content = lines.join("\n");

        return new NextResponse(content, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                // Public: AI crawlers can cache, but revalidate every hour
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "noindex", // Don't index the llms.txt endpoint itself
            },
        });
    } catch (err: unknown) {
        console.error("[llms-txt] Error generating document:", err);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
