import type { FAQItem } from "./contracts";

export interface FaqEntry {
    question: string;
    answer: string;
}

export interface FaqContent {
    entries: FaqEntry[];
    html: string;
    jsonLd: Record<string, unknown> | null;
    jsonLdScript: string;
}

export function normalizeFaqs(raw: { question: string; answer: string }[]): FaqEntry[] {
    return raw
        .filter(f => f.question && f.answer && f.question.trim().length >= 8 && f.answer.trim().length >= 2)
        .map(f => ({ question: f.question.trim(), answer: f.answer.trim() }));
}

export function faqItemsToEntries(items: FAQItem[]): FaqEntry[] {
    return normalizeFaqs(items);
}

export function buildFaqHtml(faqs: FaqEntry[]): string {
    if (faqs.length === 0) return "";
    const items = faqs.map(faq => `
  <div style="margin-bottom:1rem;border:1px solid #f1f5f9;border-radius:12px;">
    <h3 style="padding:1rem;font-size:1rem;font-weight:700;background:#f8fafc;border-radius:12px;margin:0;">${escapeHtml(faq.question)}</h3>
    <p style="padding:0.75rem 1rem 1rem;color:#475569;line-height:1.6;margin:0;">${escapeHtml(faq.answer)}</p>
  </div>`).join("");

    return `
<section style="margin-top:3rem;border-top:2px solid #e5e7eb;padding-top:2rem;">
  <h2 id="frequently-asked-questions" style="font-size:1.5rem;font-weight:800;color:#1e293b;margin-bottom:1.5rem;">Frequently Asked Questions</h2>
  ${items}
</section>`;
}

export function buildFaqJsonLd(faqs: FaqEntry[]): Record<string, unknown> | null {
    if (faqs.length === 0) return null;
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map(faq => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer,
            },
        })),
    };
}

export function buildFaqJsonLdScript(faqs: FaqEntry[]): string {
    const schema = buildFaqJsonLd(faqs);
    if (!schema) return "";
    const json = JSON.stringify(schema)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");
    return `<script type="application/ld+json">${json}</script>`;
}

export function buildFaqContent(items: FAQItem[]): FaqContent {
    const entries = faqItemsToEntries(items);
    return {
        entries,
        html: buildFaqHtml(entries),
        jsonLd: buildFaqJsonLd(entries),
        jsonLdScript: buildFaqJsonLdScript(entries),
    };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}