"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createAutoFixPR } from "@/lib/github";
import {
    sanitizeMetadataContent,
    sanitizeObject,
} from "@/lib/seo/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

import {
    resolveFrameworkContext,
    buildFrameworkPromptHints,
    type FrameworkContext,
} from "@/lib/audit-fix/context-inference";
import {
    getStaticFallback,
    shouldUseStaticGuide,
    type ManualFixGuide,
} from "@/lib/audit-fix/static-guides";
import {
    callGeminiForFix,
    parseFixJson,
    validateFix,
    scoreFix,
    buildFixPrompt,
    buildRequirementsPrompt,
    CONFIDENCE_THRESHOLD,
    type SeoIssue,
    type ContextField,
    type GeneratedFix,
} from "@/lib/audit-fix/prompt-builder";


// Input schemas

const uuidSchema = z.string().min(1).max(50);

// Types

// Types not in sub-modules

// Re-export sub-module types so callsites that import from here still work
export type { ContextField, ManualFixGuide, SeoIssue } from "@/lib/audit-fix/prompt-builder";

export type FixResult =
    | { success: true; mode: "pr"; prUrl: string }
    | {
        success: true;
        mode: "review";
        filePath: string;
        content: string;
        language: string;
        issueLabel: string;
    }
    | { success: true; mode: "manual"; guide: ManualFixGuide }
    | { success: false; error: string };

// Local helpers unique to the action layer

type IssueRoute = "static" | "ai";

function routeIssue(issue: SeoIssue): IssueRoute {
    return shouldUseStaticGuide(issue) ? "static" : "ai";
}

function getCalendarMonthWindow(): { monthKey: string } {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return { monthKey };
}

function getMonthResetDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

async function getOwnedSite(siteId: string, userId: string) {
    return prisma.site.findFirst({
        where: { id: siteId, userId },
        select: {
            id: true,
            domain: true,
            githubRepoUrl: true,
            userId: true,
            coreServices: true,
            techStack: true,
        },
    });
}

// Action 1: Detect required context fields

export async function getFixRequirements(
    domain: string,
    issue: SeoIssue,
): Promise<{ success: boolean; fields: ContextField[]; error?: string }> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, fields: [], error: "Unauthorized" };

        const { monthKey } = getCalendarMonthWindow();
        const fixCheck = await checkRateLimit(`fix-req:${session.user.id}:${monthKey}`, 100, getMonthResetDate());
        if (!fixCheck.allowed) {
            return { success: false, fields: [], error: "Monthly AI fix quota reached. Resets next month." };
        }

        if (routeIssue(issue) === "static") {
            return { success: true, fields: [] };
        }

        if (!process.env.GEMINI_API_KEY) return { success: true, fields: [] };

        const prompt = `You are an SEO specialist for a Next.js web application at ${domain}.
You generate fixes that can ONLY touch these files:
- public/robots.txt
- public/sitemap.xml
- app/layout.tsx (metadata section only: title, description, openGraph, twitter, keywords, verification, schema JSON-LD)
- next.config.js (SEO headers/redirects only)

Analyze this SEO audit issue and determine if generating a fix requires specific information only the website owner knows — such as their business name, physical address, phone number, social media profile URLs, target keywords, or Google verification token.

Issue:
${JSON.stringify(sanitizeObject(issue), null, 2)}
Domain: ${domain}

If user-specific information IS needed, return a JSON array of required fields. Each field must have: "key" (camelCase identifier), "label" (friendly UI label), "placeholder" (example value), "why" (one sentence explaining why), "required" (boolean).

If the fix is fully generic and needs no user input (e.g. adding Open Graph boilerplate), return an empty array [].

CRITICAL OUTPUT RULES:
- Return ONLY a valid JSON array
- No prose, no markdown, no backticks
- If unsure, return []`;

        const text = await callGeminiForFix(prompt, 15_000);
        if (!text) return { success: true, fields: [] };

        const fields = parseFixJson<ContextField[]>(text);
        if (!Array.isArray(fields)) return { success: true, fields: [] };

        return { success: true, fields };
    } catch (e: unknown) {
        logger.error("[AutoFix] getFixRequirements error", {
            error: (e as Error)?.message ?? String(e),
        });
        return { success: true, fields: [] }; // Fail open — don't block the user
    }
}

// Action 2: Generate the fix

export async function triggerAutoFix(
    siteId: string,
    domain: string,
    issue: SeoIssue,
    extraContext?: Record<string, string>,
): Promise<FixResult> {
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const { monthKey } = getCalendarMonthWindow();
        const fixCheck = await checkRateLimit(`autofix:${session.user.id}:${monthKey}`, 50, getMonthResetDate());
        if (!fixCheck.allowed) {
            return { success: false, error: "Monthly AI fix quota reached. Resets next month." };
        }

        // Ownership enforced in query — removed redundant post-fetch userId check
        const site = await getOwnedSite(siteId, session.user.id);
        if (!site) return { success: false, error: "Site not found" };

        if (!process.env.GEMINI_API_KEY) {
            return { success: false, error: "GEMINI_API_KEY is not configured" };
        }

        // --- Route: static issues skip AI entirely ---
        if (routeIssue(issue) === "static") {
            const fallback = getStaticFallback(issue);
            if (fallback) return { success: true, mode: "manual", guide: fallback };
            // Fall through to AI if no static guide found
        }

        const frameworkCtx = await resolveFrameworkContext(site);
        const frameworkHints = buildFrameworkPromptHints(frameworkCtx);
        const issueId = [issue.checkId, issue.id, issue.title]
            .filter(Boolean)
            .join(" ");

        const contextSection =
            extraContext && Object.keys(extraContext).length > 0
                ? `\n\nAdditional context provided by the site owner:\n${Object.entries(
                    extraContext,
                )
                    .map(([k, v]) => `- ${k}: ${v}`)
                    .join("\n")}`
                : "";

        const siteServicesSection = site.coreServices
            ? `\n\nSite's core services/purpose: ${site.coreServices}`
            : "";

        const allowedFilesSection =
            frameworkCtx.allowedFiles.length > 0
                ? frameworkCtx.allowedFiles.map((f) => `- ${f}`).join("\n")
                : "(none — provide step-by-step instructions only, no file output)";

        const githubConnected = !!site.githubRepoUrl;

        // Shared prompt sections
        const sharedConstraints = `## STRICTLY FORBIDDEN
- ${frameworkCtx.forbidden}
- UI components, page content, or layout structure changes
- CSS or styling files
- API routes, database, or auth files
- New npm packages not already in the project
- Any change that causes a syntax error, build failure, or breaks application logic

## SPECIAL NOTES
${frameworkCtx.notes}${siteServicesSection}${contextSection}

## ISSUE TO FIX
${JSON.stringify(sanitizeObject(issue), null, 2)}`;

        if (githubConnected) {
            // --- GitHub / review mode ---
            const prompt = `${frameworkHints}

You are an SEO specialist for a ${frameworkCtx.name} web application at ${domain}.
Fix the SEO issue below. Follow every rule without exception.

## ALLOWED FILES (output EXACTLY one)
${allowedFilesSection}

${sharedConstraints}

## WHAT YOU CAN FIX
- Missing/weak meta title (MUST be under 60 characters) or description (MUST be under 160 characters)
- Missing Open Graph tags (og:title, og:description, og:image, og:url)
- Missing Twitter Card tags
- Missing robots.txt / sitemap.xml
- Missing JSON-LD schema markup (as <script> JSX tag only, NEVER inside metadata export)
- Missing canonical URLs / hreflang tags
- Missing GSC / analytics verification meta tags

## CRITICAL OUTPUT RULES
- "path" MUST exactly match one of the allowed file paths above
- "content" MUST be complete, valid, immediately-deployable code — not a partial snippet
- Do NOT include explanations, prose, or markdown
- If you cannot generate a valid fix, return: { "path": "", "content": "" }

Return ONLY a valid JSON object with exactly two keys: "path" and "content".`;

            const text = await callGeminiForFix(prompt);
            if (!text) {
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error:
                        "The AI could not generate a fix right now (API quota limit). Please wait a minute and try again.",
                };
            }

            const parsed = parseFixJson<{ path: string; content: string }>(text);
            if (!parsed?.path || !parsed?.content) {
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error: "AI returned an invalid response format. Please try again.",
                };
            }

            const validationError = validateFix(
                parsed.path,
                parsed.content,
                frameworkCtx,
            );
            if (validationError) {
                logger.warn("[AutoFix] Validation rejected AI output", {
                    validationError,
                    path: parsed.path,
                });
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return { success: false, error: validationError };
            }

            const confidence = scoreFix(parsed.content, issueId);
            if (confidence < CONFIDENCE_THRESHOLD) {
                logger.warn("[AutoFix] Low-confidence AI output rejected", {
                    confidence,
                    issueId,
                });
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error:
                        "AI generated a low-confidence fix. Please try again or use the manual guide.",
                };
            }

            const description =
                issue.title ?? issue.description ?? `Fix: ${issue.category ?? "SEO"}`;
            const safeContent = sanitizeMetadataContent(parsed.content);
            const language = parsed.path.endsWith(".ts") || parsed.path.endsWith(".tsx")
                ? "tsx"
                : parsed.path.endsWith(".js") || parsed.path.endsWith(".jsx")
                    ? "jsx"
                    : parsed.path.endsWith(".xml")
                        ? "xml"
                        : parsed.path.endsWith(".txt")
                            ? "text"
                            : "code";

            return {
                success: true,
                mode: "review",
                filePath: parsed.path,
                content: safeContent,
                language,
                issueLabel: description,
            };
        } else {
            // --- Manual mode ---
            const prompt = `${frameworkHints}

You are an SEO specialist for a ${frameworkCtx.name} web application at ${domain}.
Generate a clear, safe, manual fix guide for the SEO issue below.

## ALLOWED FILES (reference only these)
${allowedFilesSection}

${sharedConstraints}

## CRITICAL OUTPUT RULES
- "steps" must contain 3–6 plain-text action steps, each one sentence
- "codeSnippet" must be complete, copy-pasteable code — no partial stubs
- Title tags in codeSnippet MUST be under 60 characters; meta descriptions under 160 characters
- Only reference files from the ALLOWED FILES list
- Do NOT include explanations or markdown outside the JSON
- If you cannot generate a valid fix, return: { "steps": ["Please refer to the documentation for manual configuration."] }

Return ONLY a valid JSON object with keys: "steps", "codeSnippet" (optional), "filePath" (optional), "language" (optional), "docsUrl" (optional).`;

            const text = await callGeminiForFix(prompt);
            if (!text) {
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error:
                        "The AI could not generate fix instructions right now (API quota limit). Please wait a minute and try again.",
                };
            }

            const guide = parseFixJson<ManualFixGuide>(text);
            if (
                !guide?.steps ||
                !Array.isArray(guide.steps) ||
                guide.steps.length === 0
            ) {
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error: "AI returned an invalid response. Please try again.",
                };
            }

            // Catch degenerate snippets — steps are still useful, just drop the snippet
            if (
                guide.codeSnippet &&
                scoreFix(guide.codeSnippet, issueId) < CONFIDENCE_THRESHOLD
            ) {
                logger.warn("[AutoFix] Low-confidence manual snippet dropped", {
                    issueId,
                });
                delete guide.codeSnippet;
            }

            return { success: true, mode: "manual", guide };
        }
    } catch (e: unknown) {
        logger.error("[AutoFix] triggerAutoFix error", {
            error: (e as Error)?.message ?? String(e),
        });
        // Don't leak internal error detail to the client
        return { success: false, error: "An unexpected error occurred." };
    }
}

// Action 3: Push approved fix as a GitHub PR

export async function pushAuditFixPR(
    siteId: string,
    filePath: string,
    content: string,
    issueLabel: string,
): Promise<{ success: true; prUrl: string } | { success: false; error: string }> {
    // --- Input validation ---
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }
    if (!filePath || filePath.includes("..")) {
        return { success: false, error: "Invalid file path." };
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: "Unauthorized" };

    // Ownership enforced in query
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
        select: { id: true, domain: true, githubRepoUrl: true },
    });
    if (!site) return { success: false, error: "Site not found" };
    if (!site.githubRepoUrl) {
        return { success: false, error: "No GitHub repo connected." };
    }

    const account = await prisma.account.findFirst({
        where: { userId: session.user.id, provider: "github" },
        select: { access_token: true },
    });
    if (!account?.access_token) {
        return {
            success: false,
            error:
                "GitHub account not connected. Please sign in with GitHub to allow PR creation.",
        };
    }

    const safeContent = sanitizeMetadataContent(content);
    const prResult = await createAutoFixPR(
        site.githubRepoUrl,
        [{ path: filePath, content: safeContent, description: issueLabel }],
        site.domain,
        account.access_token,
        session.user.email ?? undefined,
    );

    if (!prResult.success) {
        return { success: false, error: prResult.error ?? "GitHub PR creation failed." };
    }
    return { success: true, prUrl: prResult.prUrl! };
}