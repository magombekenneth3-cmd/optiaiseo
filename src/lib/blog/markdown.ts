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

export function markdownToHtml(markdown: string): string {
    return marked.parse(normalizeParagraphBreaks(markdown), { async: false }) as string;
}

export function inlineMarkdownToHtml(text: string): string {
    return marked.parseInline(text, { async: false }) as string;
}

