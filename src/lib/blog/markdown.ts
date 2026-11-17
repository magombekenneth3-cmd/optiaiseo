import { Marked, type Tokens } from "marked";

const STRUCTURAL_LINE = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<\/?[a-z][^>]*>|```|~~~|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/i;
const INDENTED_LINE = /^(?: {4}|\t)/;

const marked = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: {
        link(this: { parser: { parseInline: (tokens: Tokens.Generic[]) => string } }, token: Tokens.Link) {
            const text = this.parser.parseInline(token.tokens);
            const href = escapeAttribute(token.href);
            const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
            const external = /^https?:\/\//i.test(token.href);
            const target = external ? ' target="_blank" rel="noopener noreferrer"' : "";
            return `<a href="${href}"${title}${target}>${text}</a>`;
        },
    },
});

function escapeAttribute(value: string): string {
    return value.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isProse(line: string): boolean {
    return line.trim().length > 0 && !STRUCTURAL_LINE.test(line) && !INDENTED_LINE.test(line);
}

export function normalizeParagraphBreaks(markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    const out: string[] = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
        out.push(line);
        const next = lines[i + 1];
        if (!inFence && next !== undefined && isProse(line) && isProse(next)) {
            out.push("");
        }
    }
    return out.join("\n");
}

const UPPERCASE_SEO_TERMS: Record<string, string> = {
    seo: "SEO",
    aeo: "AEO",
    ai: "AI",
    api: "API",
    gsc: "GSC",
    cta: "CTA",
    b2b: "B2B",
    b2c: "B2C",
    saas: "SaaS",
    serp: "SERP",
    url: "URL",
    urls: "URLs",
    html: "HTML",
    css: "CSS",
    faq: "FAQ",
    faqs: "FAQs",
    cms: "CMS",
    roi: "ROI",
    ui: "UI",
    ux: "UX",
    kpi: "KPI",
    kpis: "KPIs",
    smb: "SMB",
    smbs: "SMBs",
    ctr: "CTR",
    cpc: "CPC",
    cro: "CRO",
    lcp: "LCP",
    inp: "INP",
    cls: "CLS",
    eeat: "E-E-A-T",
    js: "JS",
    json: "JSON",
    pdf: "PDF",
    crm: "CRM",
};

/**
 * Normalizes keyword badge display while preserving standard SEO/tech acronyms
 * (e.g. `"Seo tool"` or `"seo tool"` -> `"SEO tool"`, `"ai api guide"` -> `"AI API guide"`).
 */
export function formatKeywordDisplay(rawKeyword: string | null | undefined): string {
    const trimmed = (rawKeyword ?? "").trim();
    if (!trimmed) return "";

    const formatted = trimmed.replace(/\b[a-zA-Z0-9-]+\b/g, (word, offset) => {
        const lower = word.toLowerCase();
        if (lower === "e-e-a-t") return "E-E-A-T";
        const mapped = UPPERCASE_SEO_TERMS[lower];
        if (mapped) return mapped;
        if (offset === 0) {
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }
        return word;
    });
    return formatted;
}

/**
 * Generates a deterministic anchor ID for headings shared between server HTML assembly
 * and client preview scrolling.
 */
export function slugifyHeading(text: string): string {
    return (
        text
            .replace(/<[^>]*>/g, "")
            .replace(/&[a-z#0-9]+;/gi, " ")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "section"
    );
}

/**
 * Ensures every `<h2>` in HTML carries a unique `id` attribute (preserving any valid
 * existing `id`) and returns the ordered heading list for TOC generation.
 */
export function ensureHeadingIdsInHtml(rawHtml: string): {
    html: string;
    headings: Array<{ id: string; text: string }>;
} {
    const usedIds = new Map<string, number>();
    const headings: Array<{ id: string; text: string }> = [];

    const html = rawHtml.replace(/<h2(?:\s+([^>]*))?>([\s\S]+?)<\/h2>/gi, (_m, attrs: string | undefined, inner: string) => {
        const existingIdMatch = attrs?.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        const rawBase = existingIdMatch?.[1] || existingIdMatch?.[2] || slugifyHeading(inner);
        const base = slugifyHeading(rawBase);
        const seen = usedIds.get(base) ?? 0;
        usedIds.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen + 1}`;
        headings.push({ id, text: inner });

        const cleanAttrs = (attrs ?? "").replace(/\s*\bid\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").trim();
        return cleanAttrs ? `<h2 id="${id}" ${cleanAttrs}>${inner}</h2>` : `<h2 id="${id}">${inner}</h2>`;
    });

    return { html, headings };
}

export function markdownToHtml(markdown: string): string {
    return marked.parse(normalizeParagraphBreaks(markdown), { async: false }) as string;
}

export function inlineMarkdownToHtml(text: string): string {
    return marked.parseInline(text, { async: false }) as string;
}

