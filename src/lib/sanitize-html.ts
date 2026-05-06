// SECURITY: "script" is intentionally excluded.
// JSON-LD injection is handled exclusively via sanitizeSchemaMarkup(),
// which hard-codes the <script type="application/ld+json"> wrapper.
// Never add "script" here — the two-pass regex below is not a sufficient defence.
const ALLOWED_TAGS = new Set([
    "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption",
    "cite", "code", "col", "colgroup", "data", "dd", "del", "details",
    "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img",
    "ins", "kbd", "li", "main", "mark", "nav", "ol",
    "p", "picture", "pre", "q", "s", "section", "small",
    "source", "span", "strong", "sub", "summary", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "time", "tr",
    "u", "ul", "var", "video", "wbr",
]);

const SAFE_CSS_PROPERTIES = /^(color|background-color|font-size|font-weight|font-style|font-family|text-align|text-decoration|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|border|border-radius|width|height|max-width|max-height|display|flex|flex-direction|align-items|justify-content|gap|line-height|letter-spacing|list-style|opacity|overflow|white-space|word-break|vertical-align)\s*:/i;

const ALLOWED_ATTRS = new Set([
    "alt", "aria-checked", "aria-describedby", "aria-disabled", "aria-expanded",
    "aria-hidden", "aria-label", "aria-labelledby", "aria-live", "aria-required",
    "aria-selected", "border", "cellpadding", "cellspacing",
    "class", "colspan", "controls", "coords", "datetime",
    "decoding", "download", "headers", "height",
    "hidden", "href", "id", "kind", "label", "lang",
    "loading", "loop", "max", "maxlength", "media", "min",
    "muted", "name", "open", "poster", "preload",
    "rel", "reversed", "role", "rowspan", "scope",
    "shape", "size", "sizes", "span", "src", "srcset", "start",
    "tabindex", "target", "title", "type",
    "usemap", "value", "width", "wrap",
]);

const DANGEROUS_PROTOCOLS = /^(javascript|vbscript|data(?!:image\/(png|jpg|jpeg|gif|webp|svg\+xml);base64))/i;

function stripDangerousUrl(value: string): string {
    const trimmed = value.trim().replace(/[\x00-\x1f\x7f]/g, "");
    if (DANGEROUS_PROTOCOLS.test(trimmed)) return "";
    return value;
}

function stripDangerousStyle(value: string): string {
    const declarations = value.split(";").map((d) => d.trim()).filter(Boolean);
    const safe = declarations.filter((d) => SAFE_CSS_PROPERTIES.test(d));
    return safe.join("; ");
}

export function sanitizeHtml(input: string | null | undefined): string {
    if (!input) return "";

    let result = input.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");

    result = result.replace(/<(\/?)(\w+)([^>]*)>/gi, (match, closing, tagName, attrs) => {
        const tag = tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tag)) return "";

        if (closing) return `</${tag}>`;


        const safeAttrs = attrs.replace(
            /(\w[\w-]*)(\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/gi,
            (attrMatch: string, attrName: string, _eq: string, dq: string, sq: string, uq: string) => {
                const name = attrName.toLowerCase();
                const value = dq ?? sq ?? uq ?? "";

                if (/^on/i.test(name)) return "";
                if (name === "srcdoc") return "";
                if (!ALLOWED_ATTRS.has(name) && !name.startsWith("data-")) return "";

                if (name === "href" || name === "src" || name === "action" || name === "formaction") {
                    const clean = stripDangerousUrl(value);
                    if (!clean) return "";
                    return `${name}="${clean}"`;
                }

                if (name === "style") {
                    const clean = stripDangerousStyle(value);
                    if (!clean) return "";
                    return `style="${clean}"`;
                }

                return attrMatch;
            }
        );

        return `<${tag}${safeAttrs}>`;
    });

    result = result
        .replace(/<script(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, "")
        .replace(/<embed[^>]*/gi, "");

    result = stripPipelineMarkers(result);

    return result;
}

function stripPipelineMarkers(html: string): string {
    return html
        .replace(/<span[^>]*>\s*\[Verify\]\s*<\/span>/gi, "")
        .replace(/\[ADD SOURCE\]/gi, "")
        .replace(/\[Author note:[^\]]*\]/gi, "")
        .replace(/\[Verify\]/gi, "");
}


export function sanitizeSchemaMarkup(input: string | null | undefined): string {
    if (!input) return "";
    const jsonLdBlocks: string[] = [];
    const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(input)) !== null) {
        try {
            JSON.parse(match[1].trim());
            jsonLdBlocks.push(`<script type="application/ld+json">${match[1]}</script>`);
        } catch {
            // skip malformed JSON-LD
        }
    }
    return jsonLdBlocks.join("\n");
}