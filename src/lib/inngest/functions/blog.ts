            enrichmentScore: number;
        }>(
            `You are an SEO content strategist. Using the topic and available SERP context for "${keyword}", identify:
1. The 12 most relevant entities, concepts, tools, and related terms for a strong article on this topic
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
            `Based on this article about "${keyword}", generate ONE safe, declarative interactive-content placeholder.

Rules:
- Return HTML only.
- No JavaScript.
- No <script>, event handlers, iframes, forms, external resources, or executable code.
- Use only div, p, h3, label, input, ul, li, span.
- The result is a progressive-enhancement placeholder; the application may attach behavior later.
- Self-contained in a single div with id="blog-interactive-widget".
- Mobile responsive with inline styles only.
- Maximum 40 lines.

Article excerpt:
${content.substring(0, 3000)}

Return ONLY the HTML starting with <div id="blog-interactive-widget">`,
            { maxOutputTokens: 2048, temperature: 0.2, timeoutMs: 45000 }
        );
        const match = text.match(/<div[\s\S]*id=["']blog-interactive-widget["'][\s\S]*<\/div>\s*$/i);
        if (!match) return null;
        const html = match[0].trim();
        if (/<script|javascript:|on\w+\s*=|<iframe|<form/i.test(html)) return null;
        return html;
    } catch (e: unknown) {
        logger.warn("[Blog/Widget] Widget generation failed:", { error: (e as Error)?.message });
        return null;
    }
}

function extractFaqsForSchema(content: string): { question: string; answer: string }[] {
    const items: { question: string; answer: string }[] = [];
    const pattern = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null && items.length < 7) {
        const question = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const answer = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (question.length >= 8 && answer.length >= 2) items.push({ question, answer });
    }
    return items;
}

function buildSchemaScript(value: Record<string, unknown>): string {
    return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;
}

async function generateSchemaMarkup(params: {
    title: string;
    keyword: string;
    content: string;
    slug: string;
    siteDomain: string;
    author: AuthorProfile;
}): Promise<string | null> {
    try {
        const now = new Date().toISOString();
        const normalizedDomain = params.siteDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const siteUrl = normalizedDomain ? `https://${normalizedDomain}` : "https://example.com";
        const articleUrl = `${siteUrl}/blog/${params.slug}`;
        const faqItems = extractFaqsForSchema(params.content);
        const scripts = [
            buildSchemaScript({
                "@context": "https://schema.org",
                "@type": "Article",
                headline: params.title,
                description: params.title,
                author: {
                    "@type": "Person",
                    name: params.author.name,
                    ...(params.author.role ? { jobTitle: params.author.role } : {}),
                },
                datePublished: now,
                dateModified: now,
                mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
                publisher: { "@type": "Organization", name: params.siteDomain },
            }),
            ...(faqItems.length > 0