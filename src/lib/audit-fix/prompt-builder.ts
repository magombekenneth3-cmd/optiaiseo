/**
 * prompt-builder.ts — Phase 1.4
 *
 * Extracted from auditFix.ts (lines 71–202, 698–730).
 * Owns all Gemini prompt construction and JSON parsing for fix generation.
 */

import { callGemini as geminiCall } from "@/lib/gemini/client";
import type { FrameworkContext } from "./context-inference";

// Types

export interface ManualFixGuide {
    steps: string[];
    codeSnippet?: string;
    filePath?: string;
    language?: string;
    docsUrl?: string;
}

export interface SeoIssue {
    checkId?: string;
    id?: string;
    title?: string;
    description?: string;
    category?: string;
    [key: string]: unknown;
}

export interface ContextField {
    key: string;
    label: string;
    placeholder: string;
    why: string;
    required: boolean;
}

export interface GeneratedFix {
    filePath: string;
    content: string;
    language: string;
    issueLabel: string;
    reasoning?: string;
}

// Gemini wrapper

export async function callGeminiForFix(
    prompt: string,
    timeoutMs = 35_000,
): Promise<string | null> {
    try {
        return await geminiCall(prompt, {
            maxOutputTokens: 8192,
            temperature: 0.1,
            timeoutMs,
        });
    } catch {
        return null;
    }
}

// JSON parsing

export function parseFixJson<T>(text: string): T | null {
    try {
        const clean = text
            .replace(/^```(?:json)?\s*/im, "")
            .replace(/```\s*$/im, "")
            .trim();
        return JSON.parse(clean) as T;
    } catch {
        return null;
    }
}

// Validation

/** Returns an error string if the fix is unsafe/invalid, null if OK. */
export function validateFix(
    path: string,
    content: string,
    frameworkCtx: FrameworkContext,
): string | null {
    if (
        frameworkCtx.allowedFiles.length > 0 &&
        !frameworkCtx.allowedFiles.some((f) => {
            const allowedPath = f.split(" ")[0];
            return path.includes(allowedPath) || allowedPath.includes(path);
        })
    ) {
        return `AI generated an invalid file path: "${path}". Not in the allowed list for ${frameworkCtx.name}.`;
    }

    const forbiddenPatterns: Array<[RegExp, string]> = [
        [/\buseState\s*\(/, "useState hook"],
        [/\buseEffect\s*\(/, "useEffect hook"],
        [/\buseContext\s*\(/, "useContext hook"],
        [/\bimport\s+.*\s+from\s+['"]react['"]/, "React import"],
        [/\bclassName\s*=/, "className attribute (UI component)"],
    ];

    for (const [pattern, label] of forbiddenPatterns) {
        if (pattern.test(content)) {
            return `AI generated forbidden pattern (${label}). Fix rejected to prevent breaking your application.`;
        }
    }

    if (/metadata\s*=\s*\{[^}]*\bjsonLd\b/i.test(content)) {
        return "AI placed jsonLd inside the metadata export, which breaks the Next.js build. Fix rejected.";
    }

    if (content.trim().length < 40) {
        return "AI returned content that is too short to be a valid fix.";
    }

    return null;
}

// Confidence scoring

export function scoreFix(content: string, issueId: string): number {
    let score = 0;
    if (content.length > 200) score += 1;
    if (content.length > 800) score += 1;
    if (/title/i.test(content)) score += 1;
    if (/description/i.test(content)) score += 1;

    const id = issueId.toLowerCase();
    if (id.includes("open-graph") && /openGraph/i.test(content)) score += 1;
    if (id.includes("twitter") && /twitter/i.test(content)) score += 1;
    if (id.includes("schema") && /application\/ld\+json/i.test(content)) score += 1;
    if (id.includes("robots") && /user-agent/i.test(content)) score += 1;
    if (id.includes("sitemap") && /<url>|MetadataRoute/i.test(content)) score += 1;
    if (id.includes("canonical") && /canonical/i.test(content)) score += 1;

    return score;
}

export const CONFIDENCE_THRESHOLD = 2;

// Prompt builder

/**
 * Builds the Gemini prompt for generating a code fix.
 */
export function buildFixPrompt(
    issue: SeoIssue,
    domain: string,
    frameworkCtx: FrameworkContext,
    frameworkHints: string,
    extraContext: Record<string, string> = {},
): string {
    const issueId = issue.checkId ?? issue.id ?? "unknown";
    const issueTitle = issue.title ?? issueId;
    const issueDesc = issue.description ?? "";

    const extraCtxStr = Object.entries(extraContext)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");

    return `You are an SEO engineering assistant generating production-ready code fixes.

${frameworkHints}

Website: ${domain}
Issue ID: ${issueId}
Issue Title: ${issueTitle}
Issue Description: ${issueDesc}
${extraCtxStr ? `\nAdditional context:\n${extraCtxStr}` : ""}

Framework rules:
- Allowed files: ${frameworkCtx.allowedFiles.join(", ") || "standard web files"}
- Forbidden: ${frameworkCtx.forbidden}
- Notes: ${frameworkCtx.notes}

Generate a complete, working fix for this SEO issue.
Return ONLY valid JSON with this exact shape:
{
  "filePath": "<relative path to the file to create/modify>",
  "content": "<complete file content or code block>",
  "language": "<typescript|javascript|html|text|xml>",
  "issueLabel": "<short human-readable label for this fix>",
  "reasoning": "<1-2 sentences explaining what the fix does>"
}

Do not wrap in markdown. Return raw JSON only.`;
}

/**
 * Builds the Gemini prompt for detecting required context fields.
 */
export function buildRequirementsPrompt(
    domain: string,
    issue: SeoIssue,
): string {
    const issueId = issue.checkId ?? issue.id ?? "unknown";
    return `You are an SEO specialist for a Next.js web application at ${domain}.

For the following SEO issue, determine what additional context is needed to generate an accurate fix.

Issue ID: ${issueId}
Issue Title: ${issue.title ?? issueId}
Issue Description: ${issue.description ?? ""}

Return ONLY a JSON array (empty array if no context needed) of required fields:
[
  {
    "key": "fieldKey",
    "label": "Human-readable label",
    "placeholder": "Example value",
    "why": "Why this field helps generate a better fix",
    "required": true
  }
]`;
}
