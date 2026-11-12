/**
 * Guards for full-article editorial rewrites that run AFTER claim repair.
 *
 * A post-pipeline rewrite has no access to the research packet, so it must not
 * be allowed to change what the article claims — only how it reads. A rewrite
 * is rejected when it removes source links or sections, or introduces numbers
 * that were not present in the evidence-checked draft.
 */

const EXTERNAL_LINK = /<a\s[^>]*href=["'](https?:\/\/[^"']+)["']/gi;
const H2 = /<h2[\s>]/gi;
// Numbers with optional decimals/units, e.g. 42, 3.5%, $1,200, 10x, 2024.
const NUMERIC_TOKEN = /(?:\$|€|£)?\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|bn\b)?/gi;

function externalLinks(html: string): Set<string> {
    const urls = new Set<string>();
    for (const m of html.matchAll(EXTERNAL_LINK)) urls.add(m[1].replace(/\/$/, "").toLowerCase());
    return urls;
}

function textOnly(html: string): string {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ");
}

function numericTokens(html: string): Set<string> {
    const tokens = new Set<string>();
    for (const m of textOnly(html).matchAll(NUMERIC_TOKEN)) {
        const t = m[0].replace(/[\s,]/g, "").toLowerCase();
        if (t.replace(/\D/g, "").length > 0) tokens.add(t);
    }
    return tokens;
}

export interface RewriteGuardResult {
    accepted: boolean;
    reasons: string[];
}

export function guardEditorialRewrite(original: string, edited: string): RewriteGuardResult {
    const reasons: string[] = [];

    if (!edited || edited.length < original.length * 0.6) {
        reasons.push("Rewrite is substantially shorter than the evidence-checked draft.");
    }

    const originalLinks = externalLinks(original);
    const editedLinks = externalLinks(edited);
    const droppedLinks = [...originalLinks].filter(url => !editedLinks.has(url));
    if (droppedLinks.length > 0) {
        reasons.push(`Rewrite removed ${droppedLinks.length} source link(s).`);
    }
    const addedLinks = [...editedLinks].filter(url => !originalLinks.has(url));
    if (addedLinks.length > 0) {
        reasons.push(`Rewrite introduced ${addedLinks.length} unverified external link(s).`);
    }

    const originalH2 = (original.match(H2) ?? []).length;
    const editedH2 = (edited.match(H2) ?? []).length;
    if (editedH2 < originalH2) {
        reasons.push(`Rewrite dropped sections (${originalH2} → ${editedH2} H2 headings).`);
    }

    const originalNumbers = numericTokens(original);
    const newNumbers = [...numericTokens(edited)].filter(t => !originalNumbers.has(t));
    if (newNumbers.length > 0) {
        reasons.push(`Rewrite introduced numbers not present in the evidence-checked draft: ${newNumbers.slice(0, 5).join(", ")}.`);
    }

    return { accepted: reasons.length === 0, reasons };
}

