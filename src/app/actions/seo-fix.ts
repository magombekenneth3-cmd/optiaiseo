"use server";
import { logger } from "@/lib/logger";

import { Project, SyntaxKind } from "ts-morph";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSafeUrl } from "@/lib/security/safe-url";
import { applyAstFixPlan } from "@/lib/ast/executor";
import type { AstFixPlan, PreparedAstChange } from "@/lib/ast/types";
import { createAutoFixPR, getRepositoryFile } from "@/lib/github";
import { createHash } from "crypto";
import {
    detectFramework,
    scanSiteContent,
    validateFixOutput,
    sanitizeMetadataContent,
    stripMarkdownFences,
    resolveFilePath,
    resolveLanguage,
    logFix,
    sanitizeObject,
    logFallback,
    delay,
    type Framework,
    type SiteContent,
    type FrameworkResult,
} from "@/lib/seo/ai";
import { buildPrompt, type PromptContext } from "@/lib/seo/prompts";
import { getFallbackGuide, type FallbackGuide } from "@/lib/seo/fallbacks";


export interface SeoIssue {
    id: string;
    label: string;
    detail?: string;
    recommendation?: string;
    filePath?: string;
}

export interface GeneratedFix {
    issueId: string;
    fix: string;
    language: string;
    filePath: string;
    framework: Framework;
    usedFallback: boolean;
    fallbackGuide?: FallbackGuide;
}

export type FixResult =
    | { success: true; data: GeneratedFix }
    | { success: false; error: string; fallbackGuide?: FallbackGuide };

export type BatchResult = {
    fixes: Record<string, GeneratedFix>;
    framework: Framework;
    errors: Record<string, string>;
};


const MAX_FIXES_PER_RUN = 10;
const MAX_VALIDATION_RETRIES = 2;
const BATCH_SIZE = 3;
const INTER_CALL_DELAY_MS = 2000;


async function resolveSession(
    domain: string,
    repoUrl?: string
): Promise<{
    content: SiteContent;
    frameworkResult: FrameworkResult;
    framework: Framework;
}> {
    const [content, frameworkResult] = await Promise.all([
        scanSiteContent(domain),
        repoUrl ? detectFramework(repoUrl) : Promise.resolve({ framework: "unknown" as Framework, detectionSource: "fallback" as const }),
    ]);
    return { content, frameworkResult, framework: frameworkResult.framework };
}


import { callGemini as geminiCall } from "@/lib/gemini/client";

async function callGemini(prompt: string, opts: { maxTokens?: number; temperature?: number } = {}) {
    const t0 = Date.now();
    try {
        // FIX #6: Add timeout to Gemini calls — the API can hang under load.
        const text = await Promise.race([
            geminiCall(prompt, { maxOutputTokens: opts.maxTokens, temperature: opts.temperature }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Gemini timeout")), 30_000)
            ),
        ]);
        return { text, model: "gemini-3.8-flash", durationMs: Date.now() - t0 };
    } catch {
        return null;
    }
}


async function generateSingleFix(
    issue: SeoIssue,
    domain: string,
    content: SiteContent,
    framework: Framework,
    monorepoRoot?: string,
    userContext?: Record<string, string>
): Promise<GeneratedFix | null> {
    const filePath = resolveFilePath(issue.id, framework, monorepoRoot);
    const language = resolveLanguage(issue.id, framework);

    // WordPress: never generate code — return a manual guide indicator
    if (framework === "wordpress") {
        logFallback(issue.id, "not_implemented");
        return {
            issueId: issue.id,
            fix: "",
            language: "text",
            filePath,
            framework,
            usedFallback: true,
            fallbackGuide: getFallbackGuide(issue.id, issue.label, framework),
        };
    }

    // FIX #9: Truncate user-controlled strings before they enter the prompt to
    // limit prompt injection surface from page content or userContext values.
    const safeLabel = sanitizeObject(issue.label)?.slice(0, 200);
    const safeDetail = sanitizeObject(issue.detail)?.slice(0, 500);
    const safeRecommendation = sanitizeObject(issue.recommendation)?.slice(0, 500);
    const safeUserContext = userContext
        ? Object.fromEntries(
            Object.entries(userContext).map(([k, v]) => [k, String(v).slice(0, 300)])
        )
        : undefined;

    const ctx: PromptContext = {
        issueId: issue.id,
        issueLabel: safeLabel,
        issueDetail: safeDetail,
        issueRecommendation: safeRecommendation,
        domain,
        content,
        framework,
        filePath,
        userContext: safeUserContext,
    };

    const prompt = buildPrompt(ctx);
    const t0 = Date.now();

    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
        const result = await callGemini(prompt);
        if (!result) {
            logFallback(issue.id, "quota");
            return null;
        }

        const rawFix = stripMarkdownFences(result.text);
        const validation = validateFixOutput(rawFix, { id: issue.id, label: issue.label });

        if (validation.valid) {
            logFix({
                issueId: issue.id,
                framework,
                model: result.model,
                durationMs: Date.now() - t0,
                status: "success",
            });
            return { issueId: issue.id, fix: rawFix, language, filePath, framework, usedFallback: false };
        }

        logger.warn(
            `[seo-fix] Validation failed (attempt ${attempt + 1}/${MAX_VALIDATION_RETRIES + 1}) for ${issue.id}: ${validation.reason} — ${validation.details}`
        );
        logFallback(issue.id, "validation_failed");

        if (attempt < MAX_VALIDATION_RETRIES) {
            await delay(1500);
        }
    }

    return null;
}


export async function generateSeoFix(
    issue: SeoIssue,
    domain: string,
    repoUrl?: string,
    userContext?: Record<string, string>
): Promise<FixResult> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };
    if (!domain) return { success: false, error: "No domain provided." };

    // SSRF guard: canonical isSafeUrl from @/lib/security/safe-url
    if (!isSafeUrl(`https://${domain.replace(/^https?:\/\//, "")}`).ok) {
        return { success: false, error: "Invalid domain." };
    }
    if (repoUrl && !isSafeUrl(repoUrl).ok) {
        return { success: false, error: "Invalid repository URL." };
    }

    // FIX #1: Per-user rate limit for single-fix calls.
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const rl = await checkRateLimit(`seo-fix:${session.user.email}`, 20, 3600);
    if (!rl.allowed) {
        const waitMins = Math.ceil((rl.resetAt.getTime() - Date.now()) / 60000);
        return { success: false, error: `Rate limit reached. Try again in ${waitMins} minute(s).` };
    }

    if (!process.env.GEMINI_API_KEY) {
        const fallbackGuide = getFallbackGuide(issue.id, issue.label, "unknown");
        return {
            success: false,
            error: "Gemini API quota reached. Showing a manual fix guide instead.",
            fallbackGuide,
        };
    }

    try {
        const { content, frameworkResult, framework } = await resolveSession(domain, repoUrl);
        const fix = await generateSingleFix(
            issue, domain, content, framework,
            frameworkResult.monorepoRoot, userContext
        );

        if (fix) return { success: true, data: fix };

        const fallbackGuide = getFallbackGuide(issue.id, issue.label, framework);
        return {
            success: false,
            error: "Gemini API quota reached. Showing a manual fix guide instead.",
            fallbackGuide,
        };
    } catch (err: unknown) {
        logger.error("[seo-fix] generateSeoFix error:", { error: (err as Error)?.message || String(err) });
        const fallbackGuide = getFallbackGuide(issue.id, issue.label, "unknown");
        return {
            success: false,
            error: "Fix generation failed. Please try again or use the manual guide.",
            fallbackGuide,
        };
    }
}

export async function generateAllSeoFixes(
    issues: SeoIssue[],
    domain: string,
    repoUrl?: string,
    userContext?: Record<string, string>
): Promise<{ success: true } & BatchResult | { success: false; error: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };
    if (!domain) return { success: false, error: "No domain provided." };

    // SSRF guard.
    if (!isSafeUrl(`https://${domain.replace(/^https?:\/\//, "")}`).ok) {
        return { success: false, error: "Invalid domain." };
    }
    if (repoUrl && !isSafeUrl(repoUrl).ok) {
        return { success: false, error: "Invalid repository URL." };
    }

    // FIX #1: Hard cap — prevent runaway AI spend on large issue lists.
    if (issues.length > MAX_FIXES_PER_RUN) {
        return {
            success: false,
            error: `Too many issues in one run (max ${MAX_FIXES_PER_RUN}). Please select fewer issues and run again.`,
        };
    }

    // FIX #1: Per-user rate limit for batch calls — tighter than single-fix.
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const rl = await checkRateLimit(`seo-fix-batch:${session.user.email}`, 5, 3600);
    if (!rl.allowed) {
        const waitMins = Math.ceil((rl.resetAt.getTime() - Date.now()) / 60000);
        return { success: false, error: `Rate limit reached. Try again in ${waitMins} minute(s).` };
    }

    if (!process.env.GEMINI_API_KEY) {
        return { success: false, error: "Gemini API key not configured." };
    }

    try {
        const { content, frameworkResult, framework } = await resolveSession(domain, repoUrl);

        const fixes: Record<string, GeneratedFix> = {};
        const errors: Record<string, string> = {};

        for (let i = 0; i < issues.length; i += BATCH_SIZE) {
            const batch = issues.slice(i, i + BATCH_SIZE);

            const batchResults = await Promise.allSettled(
                batch.map((issue) =>
                    generateSingleFix(issue, domain, content, framework, frameworkResult.monorepoRoot, userContext)
                )
            );

            for (let j = 0; j < batch.length; j++) {
                const issue = batch[j];
                const result = batchResults[j];

                if (result.status === "fulfilled" && result.value) {
                    fixes[issue.id] = result.value;
                } else {
                    const fallbackGuide = getFallbackGuide(issue.id, issue.label, framework);
                    fixes[issue.id] = {
                        issueId: issue.id,
                        fix: "",
                        language: "text",
                        filePath: resolveFilePath(issue.id, framework, frameworkResult.monorepoRoot),
                        framework,
                        usedFallback: true,
                        fallbackGuide,
                    };
                    errors[issue.id] = result.status === "rejected"
                        ? "Fix generation failed"
                        : "Validation failed after retries";
                }
            }

            if (i + BATCH_SIZE < issues.length) {
                await delay(INTER_CALL_DELAY_MS);
            }
        }

        return { success: true, fixes, framework, errors };
    } catch (err: unknown) {
        logger.error("[seo-fix] generateAllSeoFixes error:", { error: (err as Error)?.message || String(err) });
        return { success: false, error: "Batch fix generation failed." };
    }
}


export interface PushParams {
    repoUrl: string;
    filePath: string;
    content: string;
    issueId: string;
    issueLabel: string;
    siteUrl: string;
    docsUrl?: string;
    astPlan?: AstFixPlan;
}

export type PushResult =
    | { success: true; prUrl: string; branchName: string }
    | { success: false; error: string };

export async function pushSeoFixToGitHub(params: PushParams): Promise<PushResult> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Unauthorized" };

    if (!isSafeUrl(params.repoUrl).ok) {
        return { success: false, error: "Invalid repository URL." };
    }

    const account = await prisma.account.findFirst({
        where: { userId: session.user.id, provider: "github" },
        select: { access_token: true },
    });
    const token = account?.access_token;
    if (!token) {
        return {
            success: false,
            error: "GitHub account not connected. Please sign in with GitHub to allow PR creation.",
        };
    }

    try {
        const targetFile = await getRepositoryFile(params.repoUrl, params.filePath, token);
        const existingContent = targetFile.exists && targetFile.content ? targetFile.content : "";

        let prepared: PreparedAstChange;
        if (params.astPlan) {
            prepared = applyAstFixPlan(existingContent, params.astPlan);
        } else {
            const plan: AstFixPlan = {
                version: 1,
                findingFingerprint: createHash("sha256").update(params.issueId).digest("hex").slice(0, 16),
                filePath: params.filePath,
                baseBlobSha: targetFile.sha,
                language: params.filePath.endsWith(".html") ? "html" : "tsx",
                operations: [
                    {
                        kind: "setObjectProperty",
                        target: "metadata",
                        property: "title",
                        value: params.content,
                    },
                ],
                rationale: params.issueLabel,
                risk: "MEDIUM",
                verification: [],
            };
            prepared = applyAstFixPlan(existingContent, plan);
        }

        const prRes = await createAutoFixPR(
            params.repoUrl,
            [
                {
                    path: params.filePath,
                    content: prepared.serializedContent,
                    description: params.issueLabel,
                    astPreparedChange: prepared,
                },
            ],
            params.siteUrl,
            token,
            session.user.email ?? undefined,
        );

        if (!prRes.success) return { success: false, error: prRes.error ?? "PR creation failed" };
        return { success: true, prUrl: prRes.prUrl!, branchName: prRes.branchName ?? "main" };
    } catch (err: unknown) {
        logger.error("[seo-fix] pushSeoFixToGitHub error:", { error: (err as Error)?.message || String(err) });
        return { success: false, error: `AST remediation failed: ${(err as Error)?.message ?? "An error occurred"}` };
    }
}

function buildPrBody(params: {
    issueId: string;
    issueLabel: string;
    filePath: string;
    siteUrl: string;
    docsUrl?: string;
}): string {
    return `## 🔍 SEO Issue Detected

**Issue:** ${params.issueLabel} (\`${params.issueId}\`)
**Site:** ${params.siteUrl}

## 📝 What Changed

**File modified:** \`${params.filePath}\`

This pull request was automatically generated by OptiAISEO. The fix addresses the SEO issue listed above by updating the target file with the recommended implementation.

## ✅ What to Check Before Merging

- [ ] Review the generated code for correctness
- [ ] Verify the fix addresses the issue in the context of this specific site
- [ ] Run any available automated tests
- [ ] Check the rendered output in a preview/staging environment

${params.docsUrl ? `## 📚 Documentation\n\n[Google Search Central: ${params.issueLabel}](${params.docsUrl})` : ""}

---
*Generated by [OptiAISEO](https://optiaiseo.online) • Branch: auto-generated*`;
}


function isPartialMetadataBlock(content: string): boolean {
    const trimmed = content.trimStart();
    return !trimmed.startsWith("import") && trimmed.includes("export const metadata");
}

function mergeLayoutMetadataBlock(existingContent: string, newMetadataBlock: string): string {
    const cleanBlock = newMetadataBlock
        .replace(/^```[\w-]*\s*/gm, "")
        .replace(/^```\s*$/gm, "")
        .trim();

    try {
        const project = new Project({ useInMemoryFileSystem: true });
        const existingFile = project.createSourceFile("layout.tsx", existingContent);
        const existingMetadata = existingFile.getVariableDeclaration("metadata");

        if (existingMetadata) {
            const stmt = existingMetadata.getFirstAncestorByKind(SyntaxKind.VariableStatement);
            if (stmt) {
                stmt.replaceWithText(cleanBlock);
                return existingFile.getFullText();
            }
        }

        const declarations = existingFile.getImportDeclarations();
        if (declarations.length > 0) {
            const lastImportEnd = declarations[declarations.length - 1].getEnd();
            existingFile.insertText(lastImportEnd, "\n\n" + cleanBlock + "\n");
            return existingFile.getFullText();
        }

        existingFile.insertText(0, cleanBlock + "\n\n");
        return existingFile.getFullText();
    } catch (e: unknown) {
        logger.error("[seo-fix] AST parsing failed in mergeLayoutMetadataBlock", {
            error: (e as Error)?.message || String(e),
        });
        throw new Error(`AST_PARSE_FAILED: Could not parse ${"layout.tsx"} AST safely. Manual fix required.`);
    }
}

async function fetchGitHubFileContent(
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
    headers: HeadersInit
): Promise<string | null> {
    try {
        const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
            { headers, signal: AbortSignal.timeout(10_000) }
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.content) return null;
        return Buffer.from(data.content, "base64").toString("utf-8");
    } catch {
        return null;
    }
}


export function getRequiredUserContextFields(
    issueId: string
): Array<{ key: string; label: string; placeholder: string; required: boolean }> {
    const local = [
        { key: "businessName", label: "Business Name", placeholder: "Acme Corp", required: true },
        { key: "address", label: "Full Address", placeholder: "123 Main St, New York, NY 10001", required: true },
        { key: "phone", label: "Phone Number", placeholder: "+1 (555) 000-0000", required: true },
        { key: "googleMapsUrl", label: "Google Maps URL", placeholder: "https://maps.google.com/?q=...", required: false },
    ];

    const schema = [
        { key: "socialTwitter", label: "Twitter/X Profile URL", placeholder: "https://twitter.com/yourbrand", required: false },
        { key: "socialLinkedin", label: "LinkedIn URL", placeholder: "https://linkedin.com/company/yourbrand", required: false },
        { key: "foundingYear", label: "Year Founded", placeholder: "2020", required: false },
        { key: "businessType", label: "Business Type", placeholder: "SaaS / eCommerce / Agency", required: false },
    ];

    const analytics = [
        { key: "gaMeasurementId", label: "GA4 Measurement ID", placeholder: "G-XXXXXXXXXX", required: false },
        { key: "gtmContainerId", label: "GTM Container ID", placeholder: "GTM-XXXXXXX", required: false },
    ];

    const canonical = [
        { key: "canonicalUrl", label: "Canonical Base URL", placeholder: "https://yourdomain.com", required: true },
        { key: "searchUrlPattern", label: "Search URL Pattern (optional)", placeholder: "https://yourdomain.com/search?q={query}", required: false },
    ];

    const content = [
        { key: "targetKeywords", label: "Target Keywords", placeholder: "seo tool, rank tracker, site audit", required: false },
        { key: "coreServices", label: "Core Services / Products", placeholder: "SEO audits, blog generation, keyword tracking", required: false },
        { key: "audienceDescription", label: "Target Audience", placeholder: "SaaS founders, marketing teams", required: false },
    ];

    const local_ids = ["nap-consistency", "local-schema", "map-embed", "google-business-profile", "local-directories", "schema-local-business"];
    const schema_ids = ["schema-organization", "schema-website", "schema_organization", "knowledge-panel-entity", "social-profile-links"];
    const analytics_ids = ["render-blocking-scripts", "core-web-vitals", "gtm-double-fire", "ga4-tracking"];
    const canonical_ids = ["canonical-tag", "xml-sitemap", "robots-txt", "tech_canonical", "tech_sitemap", "schema-website"];
    const content_ids = ["title-tag", "meta-description", "og-tags", "twitter-cards", "heading-hierarchy", "entity-density", "content_entity_density", "micro-answers", "content_micro_answers", "definitions-section"];

    if (local_ids.includes(issueId)) return local;
    if (schema_ids.includes(issueId)) return schema;
    if (analytics_ids.includes(issueId)) return analytics;
    if (canonical_ids.includes(issueId)) return canonical;
    if (content_ids.includes(issueId)) return content;

    return [];
}