"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { createAutoFixPR, getRepositoryFile } from "@/lib/github";
import { createHash } from "crypto";
import { applyUnifiedDiff } from "@/lib/audit-fix/unified-diff";
import {
    sanitizeMetadataContent,
    sanitizeObject,
    validateFixOutput,
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
        proposalId: string;
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
            const account = await prisma.account.findFirst({
                where: { userId: session.user.id, provider: "github" }, select: { access_token: true },
            });
            if (!account?.access_token) return { success: false, error: "GitHub account not connected." };
            const targetText = await callGeminiForFix(`Return only JSON {"path":"..."}. Select exactly one allowed file for this SEO issue. Allowed files:\n${allowedFilesSection}\nIssue:\n${JSON.stringify(sanitizeObject(issue))}`, 15_000);
            const target = targetText ? parseFixJson<{ path: string }>(targetText) : null;
            if (!target?.path || validateFix(target.path, "valid placeholder content for path validation", frameworkCtx)) {
                return { success: false, error: "Could not safely determine a permitted target file for this fix." };
            }
            const baseline = await getRepositoryFile(site.githubRepoUrl!, target.path, account.access_token);
            if (!baseline.exists || !baseline.sha || baseline.content === undefined || baseline.content.length > 100_000) {
                return { success: false, error: "Automated patches require an existing target file smaller than 100KB. Use the manual guide for this change." };
            }
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
- The target path is exactly: ${target.path}
- Return a minimal unified diff against the pinned source below. Never return a complete file.
- Do NOT include explanations, prose, or markdown
- If you cannot generate a valid fix, return: { "patch": "" }

## PINNED SOURCE (${target.path})
${baseline.content}

Return ONLY a valid JSON object with exactly one key: "patch".`;

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

            const parsed = parseFixJson<{ patch: string }>(text);
            if (!parsed?.patch) {
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return {
                    success: false,
                    error: "AI returned an invalid response format. Please try again.",
                };
            }

            let resolvedContent: string;
            try { resolvedContent = applyUnifiedDiff(baseline.content, parsed.patch); }
            catch { return { success: false, error: "AI returned a malformed or stale patch. Please regenerate the fix." }; }
            const validationError = validateFix(target.path, resolvedContent, frameworkCtx);
            if (validationError) {
                logger.warn("[AutoFix] Validation rejected AI output", {
                    validationError,
                    path: target.path,
                });
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return { success: false, error: validationError };
            }

            // S-5: Catch placeholder values, broken JSON-LD, overlong meta tags,
            // and invalid Next.js metadata fields that validateFix() doesn't check.
            const contentQA = validateFixOutput(resolvedContent, { id: issueId, label: issue.title ?? issueId });
            if (!contentQA.valid) {
                logger.warn("[AutoFix] Content QA rejected AI output", {
                    reason: contentQA.reason,
                    details: contentQA.details,
                    path: target.path,
                });
                const fallback = getStaticFallback(issue);
                if (fallback) return { success: true, mode: "manual", guide: fallback };
                return { success: false, error: contentQA.details ?? "Fix failed quality validation." };
            }

            const confidence = scoreFix(resolvedContent, issueId);
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
            const safeContent = sanitizeMetadataContent(resolvedContent);
            const language = target.path.endsWith(".ts") || target.path.endsWith(".tsx")
                ? "tsx"
                : target.path.endsWith(".js") || target.path.endsWith(".jsx")
                    ? "jsx"
                    : target.path.endsWith(".xml")
                        ? "xml"
                        : target.path.endsWith(".txt")
                            ? "text"
                            : "code";

            const contentHash = createHash("sha256").update(safeContent).digest("hex");
            const proposal = await (prisma as any).seoFixProposal.create({
                data: {
                    siteId: site.id, userId: session.user.id, filePath: target.path,
                    content: safeContent, contentHash, baseSha: baseline.sha ?? null,
                    issueLabel: description, expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                },
            });
            return {
                success: true,
                mode: "review",
                filePath: target.path,
                content: safeContent,
                language,
                issueLabel: description,
                proposalId: proposal.id,
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
    proposalId: string,
): Promise<{ success: true; prUrl: string } | { success: false; error: string }> {
    // --- Input validation ---
    if (!uuidSchema.safeParse(siteId).success) {
        return { success: false, error: "Invalid site ID." };
    }
    if (!uuidSchema.safeParse(proposalId).success) return { success: false, error: "Invalid fix proposal." };

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

    const proposal = await (prisma as any).seoFixProposal.findFirst({
        where: { id: proposalId, siteId, userId: session.user.id, status: "PENDING_REVIEW", expiresAt: { gt: new Date() } },
    });
    if (!proposal) {
        const stale = await (prisma as any).seoFixProposal.findFirst({
            where: { id: proposalId, siteId, userId: session.user.id },
            select: { status: true, expiresAt: true },
        });
        if (stale?.status === "PENDING_REVIEW" && stale.expiresAt <= new Date()) {
            await (prisma as any).seoFixProposal.update({ where: { id: proposalId }, data: { status: "EXPIRED" } });
        }
        return { success: false, error: stale?.status === "EXPIRED" || (stale?.expiresAt && stale.expiresAt <= new Date())
            ? "This fix proposal expired after 30 minutes. Regenerate it to review the latest repository version."
            : "This fix proposal is missing or has already been dispatched." };
    }
    const expectedHash = createHash("sha256").update(proposal.content).digest("hex");
    if (expectedHash !== proposal.contentHash) return { success: false, error: "Fix proposal integrity check failed. Regenerate the fix." };

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

    const prResult = await createAutoFixPR(
        site.githubRepoUrl,
        [{ path: proposal.filePath, content: proposal.content, description: proposal.issueLabel }],
        site.domain,
        account.access_token,
        session.user.email ?? undefined,
        proposal.id,
        site.id,
        proposal.baseSha,
    );

    if (!prResult.success) {
        return { success: false, error: prResult.error ?? "GitHub PR creation failed." };
    }
    await (prisma as any).seoFixProposal.update({
        where: { id: proposal.id }, data: { status: "DISPATCHED", dispatchedAt: new Date(), prUrl: prResult.prUrl },
    });
    return { success: true, prUrl: prResult.prUrl! };
}
