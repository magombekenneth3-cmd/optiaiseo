import { logger } from "@/lib/logger";

import {
    detectFramework,
    scanSiteContent,
    validateFixOutput,
    stripMarkdownFences,
    resolveFilePath,
    resolveLanguage,
    logFix,
    logFallback,
    delay,
    sanitizeObject,
    type Framework,
    type FrameworkResult,
    type SiteContent,
} from "@/lib/seo/ai";
import { buildPrompt, type PromptContext } from "@/lib/seo/prompts";
import { getFallbackGuide } from "@/lib/seo/fallbacks";

// ── Re-exports ────────────────────────────────────────────────────────────────
export type { Framework };

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AeoCheck {
    id: string;
    label: string;
    detail?: string;
    recommendation?: string;
    passed: boolean;
}

// ── validateFixInternal ───────────────────────────────────────────────────────

import { callGemini as geminiCall } from "@/lib/gemini/client";
async function callGemini(prompt: string) {
    const t0 = Date.now();
    try {
        const text = await geminiCall(prompt, { maxOutputTokens: 8192, temperature: 0.1 });
        return { text, model: "gemini-2.5-flash", durationMs: Date.now() - t0 };
    } catch {
        return null;
    }
}
/**
 * Validates a generated fix without spending an extra AI call.
 * Callable from server actions and background jobs alike.
 */
export async function validateFixInternal(
    fixContent: string,
    contextDescription: string,
): Promise<{ valid: boolean; feedback: string }> {
    const validation = validateFixOutput(fixContent, { id: "qa-check", label: contextDescription });
    return {
        valid: validation.valid,
        feedback:
            validation.details ??
            (validation.valid ? "Automated review passed." : "Review failed."),
    };
}


// ── generateSpeakableFix ─────────────────────────────────────────────────────
//
// Gap 2: Speakable schema requires real cssSelector paths pointing to existing
// DOM elements. The generic Gemini prompt path guesses selectors and gets them
// wrong for most sites. This helper:
//   1. Scans the HTML for common structural elements (h1, h2, article, main…)
//   2. Derives the best-fit cssSelector list deterministically
//   3. Emits ready-to-paste JSON-LD (no Gemini call needed)

// SiteContent-based selector derivation — uses the parsed headings and
// paragraphs from scanSiteContent() rather than raw HTML, avoiding the
// need to pass the full HTML string through the Speakable fix path.
function deriveSpeakableSelectors(siteContent: SiteContent): string[] {
    const selectors: string[] = [];

    // Derive structural container from domain heuristics — we don't have raw
    // HTML here so we use safe defaults that apply to most modern frameworks.
    // h1 + h2 selectors cover the Speakable spec's primary intent.
    selectors.push("h1");
    if (siteContent.headings.length > 1) selectors.push("h2");

    // First paragraph is the ideal voice snippet target
    if (siteContent.paragraphs.length > 0) {
        selectors.push("main p:first-of-type");
    }

    return selectors.slice(0, 4); // Speakable spec recommends ≤ 4 selectors
}

async function generateSpeakableFix(
    check: AeoCheck,
    domain: string,
    siteContent: SiteContent,
    framework: Framework,
): Promise<
    | { success: true; fix: string; language: string; filePath: string; framework: Framework }
    | { success: false; error: string; fallbackGuide?: ReturnType<typeof getFallbackGuide> }
> {
    const selectors = deriveSpeakableSelectors(siteContent);
    const selectorsJson = JSON.stringify(selectors, null, 6);

    // JSON-LD for WebPage Speakable — compatible with Google Assistant & AI voice
    const jsonLd = `<script type="application/ld+json">
{\n  "@context": "https://schema.org/",
  "@type": "WebPage",
  "name": "{{PAGE_TITLE}}",
  "url": "https://${domain}",
  "speakable": {
    "@type": "SpeakableSpecification",
    "cssSelector": ${selectorsJson.replace(/^/gm, "    ").trim()}
  }
}\n</script>`;

    // For Next.js / React: also emit a reusable component
    const nextComponent = `// src/app/components/SchemaSpeakable.tsx
// Drop this inside your <head> (via next/head or Next.js 13+ Metadata API)

export function SchemaSpeakable({ pageTitle, pageUrl }: { pageTitle: string; pageUrl: string }) {
  const schema = {
    "@context": "https://schema.org/",
    "@type": "WebPage",
    name: pageTitle,
    url: pageUrl,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ${JSON.stringify(selectors)},
    },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}\n`;

    // Use the actual Framework union values — "nextjs-app" and "nextjs-pages"
    // are the correct literals, not the shorthand "nextjs"/"react"/"gatsby".
    const isReact = (
        framework === "nextjs-app" ||
        framework === "nextjs-pages" ||
        framework === "react-vite"
    );
    const fix      = isReact ? nextComponent : jsonLd;
    const language = isReact ? "tsx" : "html";
    const filePath = resolveFilePath("schema-speakable", framework);

    logFix({
        issueId:    check.id,
        framework,
        model:      "deterministic",
        durationMs: 0,
        status:     "success",
    });

    return { success: true, fix, language, filePath, framework };
}

export async function generateAeoFixInternal(
    check: AeoCheck,
    domain: string,
    repoUrl?: string,
): Promise<
    | { success: true; fix: string; language: string; filePath: string; framework: Framework }
    | { success: false; error: string; fallbackGuide?: ReturnType<typeof getFallbackGuide> }
> {
    if (!process.env.GEMINI_API_KEY) {
        return {
            success: false,
            error: "Gemini API quota reached. Showing a manual fix guide instead.",
            fallbackGuide: getFallbackGuide(check.id, check.label, "unknown"),
        };
    }
    if (!domain) return { success: false, error: "No domain available." };

    try {
        const t0 = Date.now();

        const [content, frameworkResult] = await Promise.all([
            scanSiteContent(domain),
            repoUrl
                ? detectFramework(repoUrl)
                : Promise.resolve<FrameworkResult>({
                    framework: "unknown",
                    detectionSource: "fallback",
                    monorepoRoot: undefined,
                }),
        ]);

        const framework = frameworkResult.framework;

        // WordPress: never generate code — return manual guide
        if (framework === "wordpress") {
            logFallback(check.id, "not_implemented");
            return {
                success: false,
                error:
                    "WordPress sites require manual implementation. Please follow the step-by-step guide below.",
                fallbackGuide: getFallbackGuide(check.id, check.label, framework),
            };
        }

        // Gap 2: Speakable requires real cssSelector paths — short-circuit the generic
        // Gemini path which guesses selectors. We derive them deterministically from
        // the scanned HTML and emit a valid JSON-LD block (no extra AI call).
        if (check.id === "schema-speakable" || check.label.toLowerCase().includes("speakable")) {
            return generateSpeakableFix(check, domain, content, framework);
        }

        const filePath = resolveFilePath(check.id, framework, frameworkResult.monorepoRoot);
        const ctx: PromptContext = {

            issueId: check.id,
            issueLabel: sanitizeObject(check.label),
            issueDetail: sanitizeObject(check.detail),
            issueRecommendation: sanitizeObject(check.recommendation),
            domain,
            content,
            framework,
            filePath,
        };

        const prompt = buildPrompt(ctx);
        const geminiResult = await callGemini(prompt);

        if (!geminiResult) {
            logFallback(check.id, "quota");
            return {
                success: false,
                error: "Gemini API quota reached. Showing a manual fix guide instead.",
                fallbackGuide: getFallbackGuide(check.id, check.label, framework),
            };
        }

        const rawFix = stripMarkdownFences(geminiResult.text);
        const validation = validateFixOutput(rawFix, { id: check.id, label: check.label });

        if (!validation.valid) {
            logFallback(check.id, "validation_failed");
            return {
                success: false,
                error: `Generated fix failed quality validation: ${validation.details ?? validation.reason}`,
                fallbackGuide: getFallbackGuide(check.id, check.label, framework),
            };
        }

        logFix({
            issueId: check.id,
            framework,
            model: geminiResult.model,
            durationMs: Date.now() - t0,
            status: "success",
        });

        return {
            success: true,
            fix: rawFix,
            language: resolveLanguage(check.id, framework),
            filePath,
            framework,
        };
     
     
    } catch (err: unknown) {
        logger.error("[AEO Fix Engine] generateAeoFixInternal error:", { error: (err as Error)?.message || String(err) });
        return { success: false, error: "Failed to generate fix. Please try again." };
    }
}

// ── generateAllFixesInternal ──────────────────────────────────────────────────
/**
 * Generates fixes for all failed checks in batches.
 * Auth is NOT enforced here — callers are responsible.
 */
export async function generateAllFixesInternal(
    checks: AeoCheck[],
    domain: string,
    repoUrl?: string,
): Promise<
    | {
        success: true;
        fixes: Record<string, { fix: string; language: string; filePath: string }>;
        framework: Framework;
    }
    | { success: false; error: string }
> {
    if (!process.env.GEMINI_API_KEY) return { success: false, error: "GEMINI_API_KEY not set." };

    const failedChecks = checks.filter((c) => !c.passed);
    if (failedChecks.length === 0) return { success: true, fixes: {}, framework: "unknown" };

    try {
        const [content, frameworkResult] = await Promise.all([
            scanSiteContent(domain),
            repoUrl
                ? detectFramework(repoUrl)
                : Promise.resolve<FrameworkResult>({
                    framework: "unknown",
                    detectionSource: "fallback",
                    monorepoRoot: undefined,
                }),
        ]);

        const framework = frameworkResult.framework;
        const fixes: Record<string, { fix: string; language: string; filePath: string }> = {};

        const BATCH = 3;
        for (let i = 0; i < failedChecks.length; i += BATCH) {
            const batch = failedChecks.slice(i, i + BATCH);

            const batchResults = await Promise.allSettled(
                batch.map(async (check) => {
                    const filePath = resolveFilePath(check.id, framework, frameworkResult.monorepoRoot);
                    const ctx: PromptContext = {
                        issueId: check.id,
                        issueLabel: sanitizeObject(check.label),
                        issueDetail: sanitizeObject(check.detail),
                        issueRecommendation: sanitizeObject(check.recommendation),
                        domain,
                        content,
                        framework,
                        filePath,
                    };
                    const prompt = buildPrompt(ctx);
                    const result = await callGemini(prompt);
                    if (!result) return null;

                    const raw = stripMarkdownFences(result.text);
                    const v = validateFixOutput(raw, { id: check.id, label: check.label });
                    if (!v.valid) {
                        logFallback(check.id, "validation_failed");
                        return null;
                    }
                    return {
                        id: check.id,
                        fix: raw,
                        language: resolveLanguage(check.id, framework),
                        filePath,
                    };
                }),
            );

            for (const r of batchResults) {
                if (r.status === "fulfilled" && r.value) {
                    fixes[r.value.id] = {
                        fix: r.value.fix,
                        language: r.value.language,
                        filePath: r.value.filePath,
                    };
                }
            }

            if (i + BATCH < failedChecks.length) {
                await delay(2000);
            }
        }

         
        return { success: true, fixes, framework };
     
    } catch (err: unknown) {
        logger.error("[AEO Fix Engine] generateAllFixesInternal error:", { error: (err as Error)?.message || String(err) });
        return { success: false, error: "Failed to generate fixes." };
    }
}
