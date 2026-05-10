import { logger } from "@/lib/logger";
import { AI_MODELS } from "@/lib/constants/ai-models";


export type Framework =
    | "nextjs-app"      
    | "nextjs-pages"   
    | "nuxt"            
    | "sveltekit"    
    | "astro"           
    | "wordpress"       
    | "react-vite"      
    | "plain-html"      
    | "unknown";        

export type NextjsVersion = "app" | "pages" | "unknown";

export interface FrameworkResult {
    framework: Framework;
    version?: string;         
    monorepoRoot?: string;     
    detectionSource: "github" | "local" | "fallback";
}

export interface SiteContent {
    title: string;
    description: string;
    headings: string[];
    paragraphs: string[];
    keywords: string[];
    domain: string;
}

export interface FixValidationResult {
    valid: boolean;
    reason?: "placeholder" | "json-ld-invalid" | "title-too-long" | "desc-too-long" | "prompt-injection" | "invalid-metadata-field" | "ok";
    details?: string;
}

export interface GeminiResult {
    text: string;
    model: string;
    durationMs: number;
}

export type IssueId = string;

// Framework detection and site content scan results are cached to avoid
// redundant GitHub API / fetch calls within a single request lifecycle.
// TTL ensures stale data is never served across separate audit sessions.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> { value: T; expiresAt: number; }

const frameworkCache = new Map<string, CacheEntry<FrameworkResult>>();
const siteContentCache = new Map<string, CacheEntry<SiteContent>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { map.delete(key); return undefined; }
    return entry.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
    map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}


/**
 * Detects the framework from a GitHub repo. Caches the result per repoKey.
 * Handles monorepos by scanning for package.json in /apps/* subdirectories.
 * Never throws — returns { framework: "unknown" } on any failure.
 */
export async function detectFramework(
    repoUrl: string,
    githubToken?: string
): Promise<FrameworkResult> {
    const cacheKey = repoUrl.toLowerCase().trim();
    const cached = cacheGet(frameworkCache, cacheKey);
    if (cached) return cached;

    const fallback: FrameworkResult = {
        framework: "unknown",
        detectionSource: "fallback",
    };

    const token = githubToken ?? process.env.GITHUB_TOKEN;
    if (!token || !repoUrl) {
        cacheSet(frameworkCache, cacheKey, fallback);
        return fallback;
    }

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.\s?#]+)/);
    if (!match) {
        cacheSet(frameworkCache, cacheKey, fallback);
        return fallback;
    }

    const [, owner, repo] = match;
    const headers: HeadersInit = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };

    try {
        // Fetch full file tree once
        const treeRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
            { headers, signal: AbortSignal.timeout(10000) }
        );

        if (!treeRes.ok) {
            cacheSet(frameworkCache, cacheKey, fallback);
            return fallback;
        }

        const treeData = await treeRes.json();
        const allPaths: string[] = (treeData.tree ?? []).map(
            (f: { path: string }) => f.path
        );

        const hasFile = (name: string, inDir?: string): boolean =>
            allPaths.some((f) => {
                const matches = f === name || f.endsWith(`/${name}`);
                return inDir ? matches && f.startsWith(inDir) : matches;
            });

        const hasDir = (dir: string): boolean =>
            allPaths.some((f) => f.startsWith(`${dir}/`));

        // Detect monorepo root (apps/web, packages/frontend, etc.)
        const monorooDirs = ["apps/web", "apps/frontend", "packages/web", "frontend", "web"];
        let monorepoRoot: string | undefined;
        for (const candidate of monorooDirs) {
            if (hasDir(candidate)) {
                monorepoRoot = candidate;
                break;
            }
        }

        // Fetch package.json — try monorepo root first
        const pkgPaths = [
            monorepoRoot ? `${monorepoRoot}/package.json` : null,
            "package.json",
        ].filter(Boolean) as string[];

        let pkgContent: string | null = null;
        for (const pkgPath of pkgPaths) {
            const pkgRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/contents/${pkgPath}`,
                { headers, signal: AbortSignal.timeout(8000) }
            );
            if (pkgRes.ok) {
                const d = await pkgRes.json();
                pkgContent = Buffer.from(d.content, "base64").toString("utf-8");
                break;
            }
        }

        let result: FrameworkResult = { framework: "unknown", detectionSource: "github", monorepoRoot };

        if (pkgContent) {
            let pkg: Record<string, unknown> = {};
            try { pkg = JSON.parse(pkgContent); } catch { /* invalid JSON */ }

            const deps: Record<string, string> = {
                ...((pkg.dependencies as Record<string, string>) ?? {}),
                ...((pkg.devDependencies as Record<string, string>) ?? {}),
            };

            const nextVersion: string | undefined = deps["next"];

            if (nextVersion) {
                // Detect App Router by layout.tsx presence
                const appDirBase = monorepoRoot ? `${monorepoRoot}/app` : "app";
                const srcAppDirBase = monorepoRoot ? `${monorepoRoot}/src/app` : "src/app";
                const isAppRouter =
                    hasDir(appDirBase) &&
                    (hasFile("layout.tsx", appDirBase) || hasFile("layout.ts", appDirBase) || hasFile("layout.jsx", appDirBase)) ||
                    hasDir(srcAppDirBase) &&
                    (hasFile("layout.tsx", srcAppDirBase) || hasFile("layout.ts", srcAppDirBase));

                result = {
                    framework: isAppRouter ? "nextjs-app" : "nextjs-pages",
                    version: nextVersion,
                    detectionSource: "github",
                    monorepoRoot,
                };
            } else if (deps["nuxt"] || deps["nuxt3"] || deps["@nuxt/core"] || deps["@nuxt/kit"]) {
                result = { framework: "nuxt", version: deps["nuxt"] ?? deps["nuxt3"], detectionSource: "github", monorepoRoot };
            } else if (deps["@sveltejs/kit"]) {
                result = { framework: "sveltekit", version: deps["@sveltejs/kit"], detectionSource: "github", monorepoRoot };
            } else if (deps["astro"]) {
                result = { framework: "astro", version: deps["astro"], detectionSource: "github", monorepoRoot };
            } else if (deps["react"] || deps["@vitejs/plugin-react"] || deps["@vitejs/plugin-react-swc"]) {
                result = { framework: "react-vite", detectionSource: "github", monorepoRoot };
            }
        }

        // WordPress detection via directory structure (no package.json)
        if (result.framework === "unknown") {
            if (hasFile("functions.php") || hasDir("wp-content") || hasDir("wp-includes")) {
                result = { framework: "wordpress", detectionSource: "github" };
            } else if (hasFile("index.html") && !pkgContent) {
                result = { framework: "plain-html", detectionSource: "github" };
            }
        }

        cacheSet(frameworkCache, cacheKey, result);
        return result;
     
     
    } catch (err: unknown) {
        logger.warn("[Framework Detection] Unexpected error:", { error: (err as Error)?.message || String(err) });
        cacheSet(frameworkCache, cacheKey, fallback);
        return fallback;
    }
}


const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/i,
    /you\s+are\s+now\s+(?:a|an)/i,
    /disregard\s+(?:all\s+)?(?:previous|prior)/i,
    /act\s+as\s+(?:a|an)\s+(?:different|new)/i,
];

/**
 * Sanitizes a string before injecting into a prompt.
 * Removes HTML tags, truncates to maxLen, and strips prompt injection attempts.
 */
export function sanitize(input: string, maxLen = 500): string {
    let s = input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, maxLen);

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
        s = s.replace(pattern, "[FILTERED]");
    }

    return s;
}

/**
 * Recursively sanitizes string values in an object to prevent prompt injection.
 */
export function sanitizeObject<T>(obj: T, maxLen = 1000): T {
    if (typeof obj === "string") return sanitize(obj, maxLen) as unknown as T;
    if (Array.isArray(obj)) return obj.map((item) => sanitizeObject(item, maxLen)) as unknown as T;
     
    if (obj !== null && typeof obj === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = sanitizeObject(value, maxLen);
        }
        return result;
    }
    return obj;
}

import { BRAND } from "@/lib/constants/brand";

/**
 * Fetches and scans the public homepage of a domain for SEO signals.
 * Caches per domain. Never throws — returns minimal fallback on failure.
 */
export async function scanSiteContent(domain: string): Promise<SiteContent> {
    const cacheKey = domain.toLowerCase().trim();
    const cached = cacheGet(siteContentCache, cacheKey);
    if (cached) return cached;

    const brand = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];

    try {
        let url = domain.trim();
        if (!url.startsWith("http")) url = `https://${url}`;

        const res = await fetch(url, {
            headers: {
                "User-Agent": `Mozilla/5.0 (compatible; ${BRAND.BOT_NAME}/${BRAND.VERSION}; +${BRAND.URL}/bot)`,
                Accept: "text/html",
                "Cache-Control": "no-cache, no-store",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(12000),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = sanitize(titleMatch?.[1]?.trim() ?? brand, 120);

        const descMatch =
            html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const description = sanitize(descMatch?.[1]?.trim() ?? "", 300);

        const headingMatches = [...html.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi)];
        const headings = headingMatches
            .map((m) => sanitize(m[1], 150))
            .filter((h) => h.length > 3)
            .slice(0, 15);

        const paraMatches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gi)];
        const paragraphs = paraMatches
            .map((m) => sanitize(m[1], 300))
            .filter((p) => p.length > 30)
            .slice(0, 10);

        const kwMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
        const keywords = (kwMatch?.[1]?.split(",") ?? [])
            .map((k: string) => sanitize(k.trim(), 50))
            .slice(0, 10);

        const result: SiteContent = { title, description, headings, paragraphs, keywords, domain };
        cacheSet(siteContentCache, cacheKey, result);
        return result;
    } catch {
        const result: SiteContent = {
            title: brand,
            description: `${brand} - professional service`,
            headings: [],
            paragraphs: [],
            keywords: [],
            domain,
        };
        cacheSet(siteContentCache, cacheKey, result);
        return result;
    }
}


const PLACEHOLDER_PATTERNS = [
    /yourdomain(\.com)?/i,
    /example\.com/i,
    /your[\s_-]?business[\s_-]?name/i,
    /your[\s_-]?name/i,
    /your[\s_-]?city/i,
    /000[-.]?000[-.]?\d{4}/,
    /yoursite(\.com)?/i,
    /\[SITE_NAME\]/i,
    /\[CANONICAL_URL\]/i,
    /\[YOUR_/i,
    // Verification code placeholders (RULE 4)
    /YOUR_GOOGLE[_\s]*(?:SEARCH[_\s]*CONSOLE[_\s]*)?VERIFICATION[_\s]*CODE/i,
    /YOUR_GOOGLE[_\s]*VERIFICATION/i,
    // Inline placeholder comments (RULE 4)
    /\/\/\s*Placeholder[:：]/i,
    /\/\/\s*Replace\s+with\s+(?:actual|real|your)/i,
    // Wrong brand injection guard
    /neurolearn/i,
];

/**
 * Strips all markdown code fences from AI output.
 */
export function stripMarkdownFences(raw: string): string {
    return raw
        .replace(/^```[\w-]*\s*/gm, "")
        .replace(/^```\s*$/gm, "")
        .trim();
}

/**
 * Validates AI-generated fix output against quality rules.
 * Returns { valid: true } if the output passes all checks.
 */
export function validateFixOutput(
    content: string,
    issue: { id: string; label: string }
): FixValidationResult {
    // 1. Check for placeholder values
    for (const p of PLACEHOLDER_PATTERNS) {
        if (p.test(content)) {
            logger.warn(`[Validation] Placeholder detected in fix for ${issue.id}. Pattern: ${p}`);
            return {
                valid: false,
                reason: "placeholder",
                details: `Placeholder value detected matching pattern: ${p.toString()}`,
            };
        }
    }

    // 2. Validate JSON-LD if present
    const ldJsonMatches = [...content.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const match of ldJsonMatches) {
        try {
            JSON.parse(match[1]);
        } catch {
            logger.warn(`[Validation] Invalid JSON-LD in fix for ${issue.id}:`, { snippet: match[1].slice(0, 200) });
            return {
                valid: false,
                reason: "json-ld-invalid",
                details: "Generated JSON-LD failed to parse as valid JSON.",
            };
        }
    }

    // 3. Check title tag length if present
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1].trim().length > 60) {
        logger.warn(`[Validation] Title too long in fix for ${issue.id}: "${titleMatch[1].trim()}"`);
        return {
            valid: false,
            reason: "title-too-long",
            details: `Title tag is ${titleMatch[1].trim().length} characters, must be under 60.`,
        };
    }

    // 4. Check meta description length if present
    const descMatch = content.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (descMatch) {
        const descLen = descMatch[1].trim().length;
        if (descLen > 160) {
            logger.warn(`[Validation] Meta description too long in fix for ${issue.id}: ${descLen} chars`);
            return {
                valid: false,
                reason: "desc-too-long",
                details: `Meta description is ${descLen} chars; must be between 120–160.`,
            };
        }
    }

    // 5. Detect invalid Next.js Metadata API fields like `jsonLd:` or `script:` inside a metadata export
    // These cause TypeScript build failures: "Object literal may only specify known properties"
    const hasInvalidMetadataField =
        content.includes("export const metadata") &&
        (/[\s,\n]jsonLd\s*:/m.test(content) || /[\s,\n]script\s*:/m.test(content));
    if (hasInvalidMetadataField) {
        logger.warn(`[Validation] Invalid Next.js metadata field (jsonLd/script) detected in fix for ${issue.id}.`);
        return {
            valid: false,
            reason: "invalid-metadata-field",
            details: "Generated code uses 'jsonLd' or 'script' inside the Next.js metadata export, which is invalid and will cause a TypeScript build failure.",
        };
    }

    return { valid: true, reason: "ok" };
}


/**
 * Strips invalid `jsonLd:` and `script:` properties from a Next.js metadata
 * export and moves any embedded JSON-LD schema to a proper `<script>` JSX tag.
 *
 * This is the last line of defence before any AI-generated content is committed
 * to GitHub. Even if validation passed (e.g. the pattern was in a different form),
 * this ensures no broken metadata blocks are pushed to PRs.
 *
 * @param content - The full file content (or just the metadata block)
 * @returns Sanitized content safe to commit
 */
export function sanitizeMetadataContent(content: string): string {
    // Only attempt to sanitize if this looks like a Next.js layout/page file
    if (!content.includes("export const metadata")) return content;

    // Pattern to detect jsonLd block inside a metadata object literal.
    // Greedy on the object value to handle deeply nested schema objects.
    const jsonLdInMetadataRegex = /,?\s*jsonLd\s*:\s*(\{[\s\S]*?\}(?:\s*,|\s*(?=\n\};)))/m;
    const scriptInMetadataRegex = /,?\s*script\s*:\s*\[[\s\S]*?\](?:\s*,|\s*(?=\n\};))/m;

    let sanitized = content;
    let extractedJsonLd: string | null = null;

    // Extract and remove `jsonLd: { ... }` from metadata
    const jsonLdMatch = sanitized.match(jsonLdInMetadataRegex);
    if (jsonLdMatch) {
        try {
            // Attempt to preserve the schema value for re-injection as a proper script tag
            const schemaStr = jsonLdMatch[1].trim().replace(/,$/, "");
            // Validate it's parseable before embedding
            JSON.parse(schemaStr.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
            extractedJsonLd = schemaStr;
        } catch {
            // Schema value is not valid JSON — don't re-inject, just remove
            logger.warn("[sanitizeMetadataContent] Could not parse extracted jsonLd schema — stripping without re-injection.");
        }
        sanitized = sanitized.replace(jsonLdInMetadataRegex, "");
    }

    // Remove `script: [...]` from metadata (cannot be safely re-injected without context)
    if (scriptInMetadataRegex.test(sanitized)) {
        sanitized = sanitized.replace(scriptInMetadataRegex, "");
        logger.warn("[sanitizeMetadataContent] Stripped invalid 'script' property from metadata export.");
    }

    // Clean up any trailing comma before the closing `}` of the metadata block
    sanitized = sanitized.replace(/,\s*\n(\s*\};)/m, "\n$1");

    // If we extracted a JSON-LD schema, append a proper script tag after the default export
    if (extractedJsonLd) {
        const scriptTag = `\n\n// JSON-LD schema (moved from metadata export — not a valid Metadata field)\nconst _jsonLdSchema = ${extractedJsonLd};`;
        const componentInsertMarker = /(<html\b[^>]*>)/;
        if (componentInsertMarker.test(sanitized)) {
            sanitized = sanitized.replace(
                componentInsertMarker,
                `$1\n        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(_jsonLdSchema) }} />`
            );
            sanitized = sanitized.replace(
                "export const metadata",
                scriptTag + "\n\nexport const metadata"
            );
        } else {
            // Just strip — we can't safely inject without the JSX structure
            logger.warn("[sanitizeMetadataContent] Could not locate JSX <html> tag for re-injection. JSON-LD schema stripped.");
        }
    }

    return sanitized;
}


export function logFix(params: {
    issueId: string;
    framework: Framework;
    model: string;
    durationMs: number;
    status: "success" | "fallback" | "error";
}) {
    // Structured log — never logs tokens, API keys, or user PII
    logger.debug(
        `[Fix] ${params.issueId} | ${params.framework} | ${params.model} | ${params.durationMs}ms | ${params.status}`
    );
}

export function logFallback(issueId: string, reason: "quota" | "parse_error" | "validation_failed" | "not_implemented") {
    logger.warn(`[Fallback] ${issueId} | reason: ${reason}`);
}


/** Maps every issue ID to the correct file path for a given framework. */
export function resolveFilePath(issueId: string, fw: Framework, monorepoRoot?: string): string {
    const prefix = monorepoRoot ? `${monorepoRoot}/` : "";

    const map: Record<Framework, Record<string, string>> = {
        "nextjs-app": {
            "title-tag": `${prefix}src/app/layout.tsx`,
            "meta-description": `${prefix}src/app/layout.tsx`,
            "canonical-tag": `${prefix}src/app/layout.tsx`,
            "og-tags": `${prefix}src/app/layout.tsx`,
            "twitter-cards": `${prefix}src/app/layout.tsx`,
            "xml-sitemap": `${prefix}src/app/sitemap.ts`,
            "robots-txt": `${prefix}src/app/robots.ts`,
            "render-blocking-scripts": `${prefix}src/app/layout.tsx`,
            "hreflang": `${prefix}src/app/layout.tsx`,
            // Schema fixes go to standalone components — NEVER rewrite layout.tsx
            "schema-organization": `${prefix}src/app/components/SchemaOrganization.tsx`,
            "schema-website": `${prefix}src/app/components/SchemaWebsite.tsx`,
            "schema-faq": `${prefix}src/app/components/SchemaFAQ.tsx`,
            "schema-howto": `${prefix}src/app/components/SchemaHowTo.tsx`,
            "schema-article": `${prefix}src/app/components/SchemaArticle.tsx`,
            "schema-breadcrumb": `${prefix}src/app/components/SchemaBreadcrumb.tsx`,
            "schema-local-business": `${prefix}src/app/components/SchemaLocalBusiness.tsx`,
            "schema-product": `${prefix}src/app/components/SchemaProduct.tsx`,
            "schema-review": `${prefix}src/app/components/SchemaReview.tsx`,
            "schema-speakable": `${prefix}src/app/components/SchemaSpeakable.tsx`,
            "eeat_about": `${prefix}src/app/about/page.tsx`,
            "eeat_contact": `${prefix}src/app/contact/page.tsx`,
            "eeat_privacy": `${prefix}src/app/privacy/page.tsx`,
            "tech_canonical": `${prefix}src/app/layout.tsx`,
            "tech_sitemap": `${prefix}src/app/sitemap.ts`,
            // AEO checks
            "schema_faq": `${prefix}src/app/components/SchemaFAQ.tsx`,
            "schema_howto": `${prefix}src/app/components/SchemaHowTo.tsx`,
            "schema_article": `${prefix}src/app/components/SchemaArticle.tsx`,
            "schema_speakable": `${prefix}src/app/components/SchemaSpeakable.tsx`,
            "schema_organization": `${prefix}src/app/components/SchemaOrganization.tsx`,
            "content_faq_section": `${prefix}src/app/components/FaqSection.tsx`,
            "content_definitions": `${prefix}src/app/components/Definitions.tsx`,
            "content_toc": `${prefix}src/app/components/TableOfContents.tsx`,
            "content_entity_density": `${prefix}src/app/components/EntityDescription.tsx`,
            "content_statistics": `${prefix}src/app/components/Statistics.tsx`,
            "content_micro_answers": `${prefix}src/app/components/MicroAnswers.tsx`,
        },
        "nextjs-pages": {
            "title-tag": `${prefix}pages/_document.tsx`,
            "meta-description": `${prefix}pages/_document.tsx`,
            "canonical-tag": `${prefix}pages/_document.tsx`,
            "og-tags": `${prefix}pages/_app.tsx`,
            "twitter-cards": `${prefix}pages/_app.tsx`,
            "xml-sitemap": `${prefix}pages/sitemap.xml.tsx`,
            "robots-txt": `${prefix}public/robots.txt`,
            "schema-organization": `${prefix}components/SchemaOrganization.tsx`,
            "schema-faq": `${prefix}components/SchemaFAQ.tsx`,
            "schema_faq": `${prefix}components/SchemaFAQ.tsx`,
            "schema_organization": `${prefix}components/SchemaOrganization.tsx`,
            "eeat_about": `${prefix}pages/about.tsx`,
            "eeat_contact": `${prefix}pages/contact.tsx`,
            "eeat_privacy": `${prefix}pages/privacy.tsx`,
            "tech_canonical": `${prefix}pages/_document.tsx`,
            "tech_sitemap": `${prefix}pages/sitemap.xml.tsx`,
        },
        "nuxt": {
            "title-tag": `${prefix}nuxt.config.ts`,
            "meta-description": `${prefix}nuxt.config.ts`,
            "canonical-tag": `${prefix}nuxt.config.ts`,
            "og-tags": `${prefix}nuxt.config.ts`,
            "xml-sitemap": `${prefix}server/routes/sitemap.xml.ts`,
            "robots-txt": `${prefix}public/robots.txt`,
            "schema-faq": `${prefix}components/SchemaFAQ.vue`,
            "schema_faq": `${prefix}components/SchemaFAQ.vue`,
            "schema_organization": `${prefix}components/SchemaOrganization.vue`,
            "eeat_about": `${prefix}pages/about.vue`,
            "eeat_contact": `${prefix}pages/contact.vue`,
            "eeat_privacy": `${prefix}pages/privacy.vue`,
            "tech_canonical": `${prefix}nuxt.config.ts`,
            "tech_sitemap": `${prefix}server/routes/sitemap.xml.ts`,
        },
        "sveltekit": {
            "title-tag": `${prefix}src/app.html`,
            "meta-description": `${prefix}src/routes/+layout.svelte`,
            "canonical-tag": `${prefix}src/routes/+layout.svelte`,
            "og-tags": `${prefix}src/routes/+layout.svelte`,
            "xml-sitemap": `${prefix}src/routes/sitemap.xml/+server.ts`,
            "robots-txt": `${prefix}static/robots.txt`,
            "schema-faq": `${prefix}src/lib/components/SchemaFAQ.svelte`,
            "schema_faq": `${prefix}src/lib/components/SchemaFAQ.svelte`,
            "schema_organization": `${prefix}src/lib/components/SchemaOrganization.svelte`,
            "eeat_about": `${prefix}src/routes/about/+page.svelte`,
            "eeat_contact": `${prefix}src/routes/contact/+page.svelte`,
            "eeat_privacy": `${prefix}src/routes/privacy/+page.svelte`,
            "tech_canonical": `${prefix}src/routes/+layout.svelte`,
            "tech_sitemap": `${prefix}src/routes/sitemap.xml/+server.ts`,
        },
        "astro": {
            "title-tag": `${prefix}src/layouts/BaseLayout.astro`,
            "meta-description": `${prefix}src/layouts/BaseLayout.astro`,
            "canonical-tag": `${prefix}src/layouts/BaseLayout.astro`,
            "og-tags": `${prefix}src/layouts/BaseLayout.astro`,
            "xml-sitemap": `${prefix}public/sitemap.xml`,
            "robots-txt": `${prefix}public/robots.txt`,
            "schema-faq": `${prefix}src/components/SchemaFAQ.astro`,
            "schema_faq": `${prefix}src/components/SchemaFAQ.astro`,
            "schema_organization": `${prefix}src/components/SchemaOrganization.astro`,
            "eeat_about": `${prefix}src/pages/about.astro`,
            "eeat_contact": `${prefix}src/pages/contact.astro`,
            "eeat_privacy": `${prefix}src/pages/privacy.astro`,
            "tech_canonical": `${prefix}src/layouts/BaseLayout.astro`,
            "tech_sitemap": `${prefix}public/sitemap.xml`,
        },
        "wordpress": {
            // WordPress never generates code — all paths are for manual reference only
            "title-tag": "functions.php (Yoast or RankMath plugin recommended)",
            "meta-description": "functions.php or SEO plugin",
            "canonical-tag": "functions.php or SEO plugin",
            "schema-faq": "functions.php",
            "schema_faq": "functions.php",
            "schema_organization": "functions.php",
            "xml-sitemap": "plugin: Yoast SEO or Google XML Sitemaps",
            "robots-txt": "Settings > Reading > Visibility",
            "eeat_about": "page-about.php",
            "eeat_contact": "page-contact.php",
            "eeat_privacy": "page-privacy.php",
            "tech_canonical": "functions.php",
            "tech_sitemap": "plugin: Yoast SEO",
        },
        "react-vite": {
            "title-tag": `${prefix}index.html`,
            "meta-description": `${prefix}index.html`,
            "canonical-tag": `${prefix}index.html`,
            "og-tags": `${prefix}index.html`,
            "xml-sitemap": `${prefix}public/sitemap.xml`,
            "robots-txt": `${prefix}public/robots.txt`,
            "render-blocking-scripts": `${prefix}index.html`,
            "schema-faq": `${prefix}src/components/SchemaFAQ.tsx`,
            "schema_faq": `${prefix}src/components/SchemaFAQ.tsx`,
            "schema_organization": `${prefix}src/components/SchemaOrganization.tsx`,
            "eeat_about": `${prefix}src/pages/About.tsx`,
            "eeat_contact": `${prefix}src/pages/Contact.tsx`,
            "eeat_privacy": `${prefix}src/pages/Privacy.tsx`,
            "tech_canonical": `${prefix}index.html`,
            "tech_sitemap": `${prefix}public/sitemap.xml`,
        },
        "plain-html": {
            "title-tag": "index.html",
            "meta-description": "index.html",
            "canonical-tag": "index.html",
            "og-tags": "index.html",
            "xml-sitemap": "sitemap.xml",
            "robots-txt": "robots.txt",
            "schema-faq": "index.html",
            "schema_faq": "index.html",
            "schema_organization": "index.html",
            "eeat_about": "about.html",
            "eeat_contact": "contact.html",
            "eeat_privacy": "privacy.html",
            "tech_canonical": "index.html",
            "tech_sitemap": "sitemap.xml",
        },
        "unknown": {},
    };

    return map[fw]?.[issueId] ?? `public/${issueId.replace(/_/g, "-")}.html`;
}

/**
 * Determines the syntax-highlight language for an issue + framework.
 */
export function resolveLanguage(issueId: string, fw: Framework): string {
    if (issueId === "xml-sitemap" || issueId === "tech_sitemap") return "xml";
    if (issueId === "robots-txt" || issueId === "robots.txt") return "text";
    if (fw === "nuxt" || fw === "sveltekit") {
        if (issueId.startsWith("schema_") || issueId.startsWith("eeat_")) return "vue";
    }
    if (fw === "sveltekit") return "svelte";
    if (fw === "astro") return "astro";
    if (fw === "wordpress") return "php";
    if (fw === "plain-html") return "html";
    if (fw === "react-vite" || fw === "nextjs-app" || fw === "nextjs-pages") return "tsx";
    return "html";
}


export function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Clears all session caches (call at the start of a fresh request session). */
export function clearSessionCaches() {
    frameworkCache.clear();
    siteContentCache.clear();
}
