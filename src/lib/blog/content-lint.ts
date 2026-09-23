export interface ContentLintResult {
    passed: boolean;
    blockingIssues: string[];
    warnings: string[];
}

function normalized(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function textContent(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

export function runContentLint(content: string): ContentLintResult {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];
    const text = textContent(content);

    if (/\[EDITOR:|\[Section generation failed|\b(?:TODO|TBD|FIXME|lorem ipsum)\b|\{\{[^}]+\}\}/i.test(content)) {
        blockingIssues.push("Unresolved generation placeholder detected.");
    }

    const h1s = [...content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => textContent(match[1]));
    const h2s = [...content.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(match => textContent(match[1]));
    if (h1s.length !== 1) blockingIssues.push(`Article must contain exactly one H1; found ${h1s.length}.`);
    if (h2s.length < 3) warnings.push(`Article contains only ${h2s.length} H2 sections.`);

    const seen = new Set<string>();
    for (const heading of h2s) {
        const key = normalized(heading);
        if (!key) blockingIssues.push("Empty H2 heading detected.");
        else if (seen.has(key)) blockingIssues.push(`Duplicate H2 heading detected: "${heading}".`);
        seen.add(key);
    }

    const openLinks = [...content.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>/gi)].map(match => match[2].trim());
    for (const href of openLinks) {
        if (!href || href.startsWith("javascript:") || href.startsWith("data:")) {
            blockingIssues.push("Invalid or executable link target detected.");
            continue;
        }
        if (/^https?:\/\//i.test(href)) {
            try {
                const url = new URL(href);
                if (!url.hostname) blockingIssues.push(`Malformed external link: ${href}`);
            } catch {
                blockingIssues.push(`Malformed external link: ${href}`);
            }
        }
    }

    const tables = [...content.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0]);
    for (const table of tables) {
        if (!/<tr\b/i.test(table)) blockingIssues.push("Table markup contains no rows.");
        if (/<th\b/i.test(table) && !/<thead\b/i.test(table)) warnings.push("Table header cells exist without a THEAD wrapper.");
    }

    const tags = [...content.matchAll(/<([a-z0-9]+)\b[^>]*>/gi)].map(match => match[1].toLowerCase());
    for (const tag of new Set(tags)) {
        const opens = (content.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
        const closes = (content.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
        if (["br","hr","img","input","meta","link"].includes(tag)) continue;
        if (opens !== closes) blockingIssues.push(`Unbalanced HTML tag detected: <${tag}>.`);
    }

    const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => textContent(match[1])).filter(value => value.length >= 25);
    for (const paragraph of paragraphs.slice(-8)) {
        if (!/[.!?:"')\]…]$/.test(paragraph)) {
            warnings.push(`Paragraph appears unfinished: "${paragraph.slice(0, 100)}…"`);
        }
    }

    if (text.length < 300) blockingIssues.push(`Article contains only ${text.split(/\s+/).filter(Boolean).length} words after markup removal.`);

    return {
        passed: blockingIssues.length === 0,
        blockingIssues: [...new Set(blockingIssues)].slice(0, 30),
        warnings: [...new Set(warnings)].slice(0, 30),
    };
}
