
export interface SchemaGap {
    id:    string;
    label: string;
}

function extractSchemaTypesFromHtml(html: string): Set<string> {
    const types = new Set<string>();
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
            const obj = JSON.parse(match[1].trim());
            const collect = (node: unknown): void => {
                if (!node || typeof node !== 'object') return;
                const n = node as Record<string, unknown>;
                const t = n['@type'];
                if (typeof t === 'string') types.add(t);
                if (Array.isArray(t)) t.forEach(s => typeof s === 'string' && types.add(s));
                if (Array.isArray(n['@graph'])) n['@graph'].forEach(collect);
                // Traverse nested objects (e.g. mainEntity, offers)
                Object.values(n).forEach(v => {
                    if (v && typeof v === 'object' && !Array.isArray(v)) collect(v);
                    if (Array.isArray(v)) v.forEach(collect);
                });
            };
            collect(obj);
        } catch {
            // JSON parse error — skip silently (schema.ts already surfaces this)
        }
    }

    return types;
}

/**
 * Returns structured {id, label} gap objects.
 * The `id` matches the resolveFilePath() map in src/lib/seo/ai.ts so that
 * generateAeoFixInternal() can route to the correct template / code path.
 * Callers that previously expected string[] should access `.label` for display.
 */
export function detectSchemaGaps(html: string, domain: string): SchemaGap[] {
    const gaps: SchemaGap[] = [];
    const types = extractSchemaTypesFromHtml(html);

    // FAQPage: detect question headings like <h2>Why is...?</h2>
    if (/\?<\/h[2-4]>/i.test(html) && !types.has('FAQPage')) {
        gaps.push({
            id:    'schema-faqpage',
            label: 'FAQPage schema missing (detected Q&A headings — add FAQPage JSON-LD)',
        });
    }

    // HowTo: detect step-by-step content patterns
    if (/\b(step\s+\d+|how\s+to)\b/i.test(html) && !types.has('HowTo')) {
        gaps.push({
            id:    'schema-howto',
            label: 'HowTo schema missing (detected step-by-step content)',
        });
    }

    // Article/BlogPosting: blog URL pattern
    if (/\/blog\//i.test(domain) && !types.has('Article') && !types.has('BlogPosting') && !types.has('NewsArticle')) {
        gaps.push({
            id:    'schema-article',
            label: 'Article/BlogPosting schema missing on blog URL — required for Google News/Discover',
        });
    }

    // AggregateRating: detect rating signals without schema
    if (/★|⭐|(\d\.?\d?\s*(stars?|rating|out of \d))|testimonial|review/i.test(html)
        && !types.has('AggregateRating') && !types.has('Review')) {
        gaps.push({
            id:    'schema-aggregate-rating',
            label: 'AggregateRating/Review schema missing — detected rating or review content; add to earn star rich snippets',
        });
    }

    // VideoObject: detect embedded videos without schema
    if (/(youtube\.com\/embed|vimeo\.com\/video|<video\b)/i.test(html) && !types.has('VideoObject')) {
        gaps.push({
            id:    'schema-video',
            label: 'VideoObject schema missing — detected embedded video; add to appear in Video rich results',
        });
    }

    // Speakable: recommend for pages with clear intro or FAQ
    // id 'schema-speakable' matches resolveFilePath() → SchemaSpeakable.tsx
    const hasFaqOrIntro = types.has('FAQPage') || /<h[12]/i.test(html);
    if (hasFaqOrIntro && !types.has('Speakable') && !html.toLowerCase().includes('"speakable"')) {
        gaps.push({
            id:    'schema-speakable',
            label: 'Speakable schema not implemented — add to improve visibility in Google Assistant and AI voice answers',
        });
    }

    // Product/SoftwareApplication — only flag for non-blog SaaS-like domains
    if (!types.has('SoftwareApplication') && !types.has('Product') && !/\/blog\//i.test(domain)) {
        gaps.push({
            id:    'schema-product',
            label: 'Product or SoftwareApplication schema missing — critical for SaaS/e-commerce pages',
        });
    }

    return gaps;
}
