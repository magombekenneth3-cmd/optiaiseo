import "dotenv/config";

import {
    defineAgent,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    voice,
} from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import { Track } from "livekit-client";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "./src/lib/prisma";
import { runSiteAudit } from "./src/lib/audit";
import { runOnPageAudit } from "./src/lib/onpage";
import { runAeoAudit } from "./src/lib/aeo";
import { auditMultiModelMentions } from "./src/lib/aeo/multi-model";
import { fetchCompetitorIntelligence } from "./src/lib/competitors";
import {
    fetchGSCKeywords,
    categoriseKeywords,
    buildRankingSummary,
    findOpportunities,
    normaliseSiteUrl,
} from "./src/lib/gsc";
import { getUserGscToken } from "./src/lib/gsc/token";
import { runFullSeoResearch } from "./src/lib/keywords/seoResearch";
import { scoreContent } from "./src/lib/content-scoring";
import { generateTrendingPost, generateEvergreenPost } from "./src/lib/blog";
import {
    detectGsovDrop,
    generateHealingPlan,
    executeHealing,
} from "./src/lib/self-healing/engine";
import { generateAeoFixInternal } from "./src/lib/aeo/fix-engine";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "./src/lib/constants/ai-models";
import { analyzeWebsiteVisuals } from "./src/lib/vision";

// ─── Environment validation ───────────────────────────────────────────────────
// Fail fast at boot — never let a missing key cause a silent mid-session crash.
const REQUIRED_ENV = [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "GEMINI_API_KEY",
    "DATABASE_URL",
] as const;

function validateEnv(): void {
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(`[Aria] Missing required env vars: ${missing.join(", ")}`);
    }
}

validateEnv();


import pino from "pino";
const log = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: "aria-agent" },
});


process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception');
});




// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseDomain = (input: string) =>
    input.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];

const ensureHttps = (url: string) =>
    url.startsWith("http") ? url : `https://${url}`;

async function getUserSite(userId: string, domainHint?: string) {
    const where = domainHint
        ? { userId, domain: { contains: parseDomain(domainHint) } }
        : { userId };
    return prisma.site.findFirst({ where });
}

// Small helper for retry backoff
function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Per-job scoped publisher ─────────────────────────────────────────────────
// FIX: Previously a module-level mutable global (_publishData) caused
// cross-session data contamination. Now it is scoped per JobContext.
function createEmitter(ctx: JobContext) {
    return function emit(data: object): void {
        try {
            const buf = Buffer.from(JSON.stringify(data));
            ctx.room.localParticipant?.publishData(buf, { reliable: true });
        } catch {
            /* non-critical — don't let UI events kill the voice session */
        }
    };
}

// ─── Per-session tool rate limiters (Part 7) ─────────────────────────────────
// Limits expensive Aria tool calls per session to control API costs.
// Each limiter is a sliding-window bucket keyed by sessionId.
// Falls back to a no-op when UPSTASH_REDIS_REST_URL is not configured.

function buildSessionRedis(): InstanceType<typeof Redis> | null {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
}

const _sessionRedis = buildSessionRedis();

/** No-op that always allows — used when Redis is not configured */
const SESSION_ALLOW_ALL = {
    limit: async (_id: string) => ({
        success: true as const,
        limit: 9999,
        remaining: 9999,
        reset: 0,
        pending: Promise.resolve(),
    }),
} as unknown as Ratelimit;

function makeSessionLimiter(
    action: string,
    requests: number,
    window: Parameters<typeof Ratelimit.slidingWindow>[1]
): Ratelimit {
    if (!_sessionRedis) return SESSION_ALLOW_ALL;
    return new Ratelimit({
        redis: _sessionRedis,
        limiter: Ratelimit.slidingWindow(requests, window),
        prefix: `rl:session-tool:${action}`,
    });
}

/** Per-session sliding-window limits for expensive tool calls */
const sessionToolLimiters = {
    siteAudit:       makeSessionLimiter("site-audit",    5,  "1 h"),
    aeoAudit:        makeSessionLimiter("aeo-audit",     2,  "1 h"),
    competitorCheck: makeSessionLimiter("competitor-chk", 5, "1 h"),
    competitorIntel: makeSessionLimiter("competitor-intel", 5, "1 h"),
    webSearch:       makeSessionLimiter("web-search",    10, "1 h"),
    playwrightShot:  makeSessionLimiter("playwright",     5, "1 h"),
    blogGenerate:    makeSessionLimiter("blog-gen",       3, "1 h"),
    githubPr:        makeSessionLimiter("github-pr",      2, "1 h"),
} as const;

type SessionToolKey = keyof typeof sessionToolLimiters;

/**
 * Guard expensive tool execute() calls with a per-session rate limit.
 * Returns the tool's result on success, or an error object that Aria
 * will speak back to the user naturally.
 */
async function guardTool<T>(
    toolKey: SessionToolKey,
    sessionId: string,
    fn: () => Promise<T>
): Promise<T | { error: string }> {
    const limiter = sessionToolLimiters[toolKey];
    const { success } = await limiter.limit(sessionId);
    if (!success) {
        const humanName = toolKey.replace(/([A-Z])/g, " $1").toLowerCase().trim();
        return {
            error: `I've reached my limit for ${humanName} in this session. Please start a new session to continue.`,
        };
    }
    return fn();
}

// ─── GitHub PR helper ─────────────────────────────────────────────────────────
// Rate-limited per userId to prevent GitHub secondary-rate-limit 403s when
// a user says "fix everything" and triggers rapid sequential calls.
const prCooldowns = new Map<string, number>();
const PR_COOLDOWN_MS = 30_000;

async function pushPrForUser(params: {
    userId: string;
    repoUrl: string;
    filePath: string;
    content: string;
    commitMessage: string;
    siteId: string;
}): Promise<{ success: true; url: string } | { success: false; error: string }> {
    // Rate-limit guard
    const lastPr = prCooldowns.get(params.userId) ?? 0;
    if (Date.now() - lastPr < PR_COOLDOWN_MS) {
        return {
            success: false,
            error: "Please wait 30 seconds between pull request requests to avoid GitHub rate limits.",
        };
    }
    prCooldowns.set(params.userId, Date.now());

    const account = await prisma.account.findFirst({
        where: { userId: params.userId, provider: "github" },
        select: { access_token: true },
    });
    if (!account?.access_token) {
        return {
            success: false,
            error: "GitHub not connected. Tell the user to connect GitHub in Settings.",
        };
    }

    const match = params.repoUrl.match(/github\.com\/([^/]+)\/([^/.\s?#]+)/);
    if (!match) return { success: false, error: `Invalid repo URL: ${params.repoUrl}` };
    const [, owner, repo] = match;

    const h: HeadersInit = {
        Authorization: `Bearer ${account.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    };

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: h });
        if (!repoRes.ok) return { success: false, error: "Cannot access repo." };
        const defaultBranch: string = (await repoRes.json()).default_branch ?? "main";

        const refRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
            { headers: h }
        );
        if (!refRes.ok) return { success: false, error: "Could not get branch ref." };
        const baseSha: string = (await refRes.json()).object.sha;

        const branchName = `fix/aria-autofix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
            method: "POST",
            headers: h,
            body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
        });
        if (!branchRes.ok) return { success: false, error: "Failed to create branch." };

        const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${params.filePath}`;
        const existingRes = await fetch(`${fileUrl}?ref=${branchName}`, { headers: h });
        const existingSha = existingRes.ok ? (await existingRes.json()).sha : undefined;

        const encoded = Buffer.from(params.content).toString("base64");
        const commitBody: Record<string, unknown> = {
            message: `fix(seo): ${params.commitMessage}`,
            content: encoded,
            branch: branchName,
        };
        if (existingSha) commitBody.sha = existingSha;

        const putRes = await fetch(fileUrl, {
            method: "PUT",
            headers: h,
            body: JSON.stringify(commitBody),
        });
        if (!putRes.ok) return { success: false, error: `Commit failed: ${putRes.status}` };

        const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: "POST",
            headers: h,
            body: JSON.stringify({
                title: `fix(seo): ${params.commitMessage}`,
                body: `## 🤖 AISEO Auto-Fix\n\n**File:** \`${params.filePath}\`\n**Change:** ${params.commitMessage}\n\n_Generated by Aria Voice Agent._`,
                head: branchName,
                base: defaultBranch,
                draft: false,
            }),
        });

        if (!prRes.ok)
            return { success: true, url: `https://github.com/${owner}/${repo}/compare/${branchName}` };
        return { success: true, url: (await prRes.json()).html_url };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// ─── Prefetch user context ────────────────────────────────────────────────────
// FIX: Added 8-second timeout + fallback greeting so a slow DB call never
// causes the 30-second participant wait timeout to fire.
async function prefetchUserContext(
    userId: string,
    emit: (data: object) => void,
    timeoutMs = 8_000
): Promise<{
    sites: { id: string; domain: string; coreServices: string | null }[];
    primaryAudit: { domain: string; score: number; topIssue: string; isFromCache: boolean; auditAge: string } | null;
    greeting: string;
}> {
    const fallback = {
        sites: [],
        primaryAudit: null,
        greeting: "Hey, I'm Aria. Give me just a moment to load your sites.",
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Prefetch timeout")), timeoutMs)
    );

    try {
        return await Promise.race([prefetchImpl(userId, emit), timeoutPromise]);
    } catch (e: any) {
        log.warn({ userId, err: e.message }, "Prefetch failed — using fallback greeting");
        return fallback;
    }
}

async function prefetchImpl(
    userId: string,
    emit: (data: object) => void
): Promise<{
    sites: { id: string; domain: string; coreServices: string | null }[];
    primaryAudit: { domain: string; score: number; topIssue: string; isFromCache: boolean; auditAge: string } | null;
    greeting: string;
}> {
    const sites = await prisma.site.findMany({
        where: { userId },
        select: { id: true, domain: true, coreServices: true },
        orderBy: { createdAt: "asc" },
    });

    if (sites.length === 0) {
        return {
            sites: [],
            primaryAudit: null,
            greeting:
                "Hey, I'm Aria. It looks like you don't have any sites registered yet. What URL would you like me to audit for you?",
        };
    }

    if (sites.length > 1) {
        const domainList = sites.map((s: { id: string; domain: string; coreServices: string | null }) => s.domain).join(" and ");
        return {
            sites,
            primaryAudit: null,
            greeting: `Hi, I'm Aria. I see you have ${sites.length} sites connected: ${domainList}. Which one would you like to work on, and what should we do?`,
        };
    }

    const primary = sites[0];
    emit({ event: "set_domain", domain: primary.domain });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentAudit = await prisma.audit.findFirst({
        where: { siteId: primary.id, runTimestamp: { gte: sevenDaysAgo } },
        orderBy: { runTimestamp: "desc" },
    });

    let primaryAudit: {
        domain: string;
        score: number;
        topIssue: string;
        isFromCache: boolean;
        auditAge: string;
    } | null = null;

    if (recentAudit) {
        const scores = (recentAudit.categoryScores as any) ?? {};
        const issues = recentAudit.issueList as any[];
        const topIssue = Array.isArray(issues)
            ? issues.filter(
                (i: any) => i.severity === "error" || i.priority === "High"
            )?.[0]
            : null;
        const overallScore = scores?.seo ?? scores?.overall ?? 0;
        const hoursAgo = Math.round(
            (Date.now() - recentAudit.runTimestamp.getTime()) / 3600000
        );
        const auditAge = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.round(hoursAgo / 24)}d ago`;

        primaryAudit = {
            domain: primary.domain,
            score: overallScore,
            topIssue: topIssue
                ? `${topIssue.title ?? topIssue.itemId}: ${topIssue.description ?? topIssue.finding}`
                : "No critical issues found",
            isFromCache: true,
            auditAge,
        };

        emit({
            event: "set_chart",
            chart: {
                type: "keyword_bar",
                title: `SEO Score — ${primary.domain}`,
                data: [
                    { keyword: "SEO", count: scores?.seo ?? 0 },
                    { keyword: "Performance", count: scores?.performance ?? 0 },
                    { keyword: "Accessibility", count: scores?.accessibility ?? 0 },
                    { keyword: "Overall", count: overallScore },
                ],
            },
        });
        emit({
            event: "tool_log",
            message: `> Loaded saved audit (${auditAge}) — ${primary.domain} scored ${overallScore}/100`,
        });
        log.info(
            { domain: primary.domain, score: overallScore, auditAge },
            "Using cached audit"
        );
    } else {
        emit({
            event: "tool_start",
            tool: `Ready to scan ${primary.domain}`,
        });
        
        // We do NOT run a synchronous audit here because the 30s scan will reliably 
        // trigger the 8s prefetch timeout, causing the agent to incorrectly fallback 
        // to the "No sites added yet" greeting.
        primaryAudit = null;
    }

    // ── Win 1 Step 4: Compute top priority issue for Aria's opening greeting ──
    // Uses the same formula as the audit detail page (impact×0.5 + ease×0.3 + conf×0.2).
    // Falls back silently when no audit or no critical issues exist.
    let priorityGreetingSuffix = "";
    if (primaryAudit?.isFromCache) {
        try {
            const auditForPriority = await prisma.audit.findFirst({
                where:   { siteId: primary.id },
                orderBy: { runTimestamp: "desc" },
                select:  { issueList: true },
            });
            const rawList = auditForPriority?.issueList ?? [];
            const issueArr: any[] = Array.isArray(rawList)
                ? rawList
                : Array.isArray((rawList as any)?.recommendations)
                    ? (rawList as any).recommendations
                    : Array.isArray((rawList as any)?.issues)
                        ? (rawList as any).issues
                        : [];

            const scoreFn = (raw: any): number => {
                const sev  = String(raw.severity ?? raw.type ?? "info").toLowerCase();
                const cat  = String(raw.category ?? "general").toLowerCase();
                const hard = ["technical", "security", "performance", "core-web-vitals"].some(c => cat.includes(c));
                const impact = sev === "error" ? 9 : sev === "warning" ? 6 : 3;
                const ease   = hard ? 3 : 6;
                const conf   = sev === "error" ? 0.95 : sev === "warning" ? 0.8 : 0.6;
                return Math.round((impact / 10 * 0.5 + (1 - ease / 10) * 0.3 + conf * 0.2) * 100);
            };

            const ranked = issueArr
                .filter((i: any) => {
                    const sev = String(i.severity ?? i.type ?? "").toLowerCase();
                    return sev === "error" || sev === "warning";
                })
                .map((i: any) => ({
                    title: String(i.title ?? i.itemId ?? "Untitled issue"),
                    rec:   String(i.fixSuggestion ?? i.recommendation ?? i.detail ?? i.finding ?? "").slice(0, 120),
                    score: scoreFn(i),
                }))
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, 3);

            if (ranked.length > 0) {
                const top = ranked[0];
                priorityGreetingSuffix = ` Your top priority this week is: ${top.title}.${top.rec ? ` ${top.rec}` : ""}`;
                if (ranked.length > 1) {
                    priorityGreetingSuffix += ` After that, tackle ${ranked[1].title}.`;
                }
            }
        } catch (e: any) {
            log.warn({ err: e.message }, "[Aria] Priority greeting prefetch failed — using standard greeting");
        }
    }

    let greeting: string;
    if (primaryAudit?.isFromCache) {
        greeting = `Hi, I'm Aria. Your site ${primary.domain} is selected. The last audit score was ${primaryAudit.score} out of 100.${priorityGreetingSuffix} What else would you like to work on today?`;
    } else if (primaryAudit) {
        greeting = `Hi, I'm Aria. I've just audited ${primary.domain} and it scored ${primaryAudit.score} out of 100. What would you like to focus on now?`;
    } else {
        greeting = `Hi, I'm Aria. I see your site ${primary.domain} is attached to your account. I can run a full SEO scan, or we can look at your AI search visibility. What would you like to do?`;
    }

    return { sites, primaryAudit, greeting };
}

// ─── Input sanitisation ──────────────────────────────────────────────────────
// All string parameters that arrive from LLM tool calls originate in user
// speech (transcribed text). A bad actor can craft a sentence that injects
// prompt content or path traversal sequences into downstream API calls.
//
// sanitiseInput strips angle-bracket / quote characters used for HTML/JSON
// injection and truncates to a safe length. It is NOT a full-coverage XSS
// filter — it is a first-line guard for the voice agent's external API calls.
function sanitiseInput(raw: string, maxLen = 512): string {
    return raw
        .replace(/[<>"'`\\]/g, "")      // strip injection-prone chars
        .replace(/\.{2,}[\/\\]/g, "")   // strip path traversal (../../)
        .trim()
        .slice(0, maxLen);
}

// URL-specific guard: only allow printable ASCII, reject javascript:/data: schemes
function sanitiseUrl(raw: string): string {
    const cleaned = sanitiseInput(raw, 2048);
    if (/^(javascript|data|vbscript):/i.test(cleaned)) {
        log.warn({ raw }, "[Aria] Rejected suspicious URL scheme from tool call");
        return "";
    }
    return cleaned;
}

// ─── Tool factory ─────────────────────────────────────────────────────────────
// Takes a scoped emit function and returns all tools bound to that session.
// This eliminates the module-level global and prevents cross-session leaks.
function buildTools(emit: (data: object) => void, userId?: string, roomName?: string) {
    // Unique session identifier for per-session tool rate limiting.
    // Room names are already globally unique (format: voice-<userId>), so they
    // make a perfect sessionId without any additional state.
    const sessionId = roomName ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;


    const runSiteAuditTool = llm.tool({
        description:
            "Runs a full technical SEO audit on a website. Returns overall score, category scores, and top critical issues. ALWAYS call this when user asks to audit, scan, or check their site.",
        parameters: z.object({
            url: z.string().describe("Domain or URL to audit, e.g. example.com"),
        }),
        execute: async ({ url }) => {
            return guardTool("siteAudit", sessionId, async () => {
            const domain = parseDomain(sanitiseUrl(url));
            log.info({ tool: "runSiteAudit", domain }, "Tool invoked");
            emit({ event: "set_domain", domain });
            emit({ event: "tool_start", tool: `Auditing ${domain}...` });

            let site0 = await prisma.site.findFirst({ where: { domain: { contains: domain } } });

            // If no site exists for this domain and we have a userId, attempt to create
            // a minimal site entry so audits and on-page reports are persisted to the
            // user's dashboard automatically when they provide a URL.
            if (!site0 && userId) {
                try {
                    const { isValidPublicDomain } = await import('./src/lib/security');
                    if (isValidPublicDomain(domain)) {
                        const normalized = domain;
                        try {
                            const created = await prisma.site.create({
                                data: { userId, domain: normalized, operatingMode: 'REPORT_ONLY' },
                            });
                            site0 = created;
                            emit({ event: 'site_added', domain: normalized, siteId: created.id });
                            log.info({ userId, domain: normalized }, 'Auto-created site for user from provided URL');
                        } catch (e: any) {
                            if (e?.code === 'P2002') {
                                // Race: another process created it concurrently — re-query
                                site0 = await prisma.site.findFirst({ where: { domain: { contains: domain } } });
                            } else {
                                log.warn({ err: e?.message, domain, userId }, 'Failed to auto-create site');
                            }
                        }
                    } else {
                        log.warn({ domain, userId }, 'Provided domain is not a valid public domain — skipping auto-create');
                    }
                } catch (e: any) {
                    log.warn({ err: e?.message, domain, userId }, 'Auto-create site path failed');
                }
            }
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const cachedAudit = site0
                ? await prisma.audit.findFirst({
                    where: { siteId: site0.id, runTimestamp: { gte: oneDayAgo } },
                    orderBy: { runTimestamp: "desc" },
                })
                : null;

            if (cachedAudit) {
                const scores = (cachedAudit.categoryScores as any) ?? {};
                const issues = cachedAudit.issueList as any[];
                const errorIssues = Array.isArray(issues)
                    ? issues.filter((i: any) => i.severity === "error" || i.priority === "High")
                    : [];
                const topIssues = errorIssues
                    .slice(0, 5)
                    .map((i: any) => `${i.title ?? i.itemId}: ${i.description ?? i.finding}`)
                    .join("; ");
                const overallScore = scores?.seo ?? scores?.overall ?? 0;
                const minsAgo = Math.round(
                    (Date.now() - cachedAudit.runTimestamp.getTime()) / 60000
                );
                emit({ event: "tool_log", message: `> Using audit from ${minsAgo}min ago — score ${overallScore}/100` });
                return JSON.stringify({
                    domain,
                    overallScore,
                    fromCache: true,
                    cachedMinsAgo: minsAgo,
                    seoScore: scores?.seo ?? 0,
                    performanceScore: scores?.performance ?? 0,
                    topCriticalIssues: topIssues || "None found",
                    status: `Showing audit from ${minsAgo} minutes ago. Say: "I have a recent audit from ${minsAgo} minutes ago — score is ${overallScore} out of 100." Then ask: "Want me to run a fresh audit, or shall I walk through the existing issues?"`,
                });
            }
            try {
                const result = await runSiteAudit(domain);
                const errorIssues = result.issues?.filter((i: any) => i.severity === "error") ?? [];
                const warnIssues = result.issues?.filter((i: any) => i.severity === "warning") ?? [];
                const topIssues = errorIssues
                    .slice(0, 5)
                    .map((i: any) => `${i.title}: ${i.description}`)
                    .join("; ");

                const site = site0 ?? (await prisma.site.findFirst({ where: { domain: { contains: domain } } }));
                if (site) {
                    await prisma.audit.create({
                        data: {
                            siteId: site.id,
                            categoryScores: result.categoryScores as any,
                            issueList: (result.rawReport ?? result.issues) as any,
                            fixStatus: "COMPLETED",
                            lcp: result.lcp ?? null,
                            cls: result.cls ?? null,
                            inp: result.inp ?? null,
                        },
                    });
                    log.info({ tool: "runSiteAudit", domain }, "Audit persisted to DB");
                }

                emit({
                    event: "tool_log",
                    message: `> Audit saved — score ${result.score}/100  SEO:${result.categoryScores?.seo ?? 0}  Perf:${result.categoryScores?.performance ?? 0}`,
                });
                emit({
                    event: "set_chart",
                    chart: {
                        type: "keyword_bar",
                        title: `SEO Score Breakdown — ${domain}`,
                        data: [
                            { keyword: "SEO", count: result.categoryScores?.seo ?? 0 },
                            { keyword: "Performance", count: result.categoryScores?.performance ?? 0 },
                            { keyword: "Accessibility", count: result.categoryScores?.accessibility ?? 0 },
                            { keyword: "Overall", count: result.score ?? 0 },
                        ],
                    },
                });

                const spokenIssues = errorIssues
                    .slice(0, 3)
                    .map((i: any) => `Issue: ${i.title}. Fix: ${i.fixSuggestion || i.description}`);
                const scoreLabel =
                    result.score >= 80 ? "strong" : result.score >= 60 ? "average" : "below average";

                return JSON.stringify({
                    domain,
                    overallScore: result.score,
                    scoreLabel,
                    seoScore: result.categoryScores?.seo ?? 0,
                    performanceScore: result.categoryScores?.performance ?? 0,
                    accessibilityScore: result.categoryScores?.accessibility ?? 0,
                    criticalIssueCount: errorIssues.length,
                    warningCount: warnIssues.length,
                    topCriticalIssues: topIssues || "None found",
                    spokenIssueResponses: spokenIssues,
                    savedToDashboard: !!site,
                    status: `Audit saved to dashboard. Score is ${result.score} out of 100 — that is ${scoreLabel}. Speak the score first, then deliver each issue as: "Issue X: [title]. To fix it: [fixSuggestion]." After each issue, pause and ask "Want me to auto-fix that one?" before moving to the next.`,
                });
            } catch (e: any) {
                log.error({ tool: "runSiteAudit", domain, err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Audit failed: ${e.message}` });
            }
            }); // end guardTool
        },
    });

    const runOnPageAuditTool = llm.tool({
        description:
            "Deep on-page SEO analysis of a specific URL: title, meta, H1/H2s, word count, images, links, issues.",
        parameters: z.object({
            url: z.string().describe("Full URL of the page"),
        }),
        execute: async ({ url }) => {
            const fullUrl = ensureHttps(sanitiseUrl(url));
            log.info({ tool: "runOnPageAudit", url: fullUrl }, "Tool invoked");
            emit({ event: "tool_start", tool: `Deep on-page analysis: ${fullUrl}` });
            try {
                const result = await runOnPageAudit(fullUrl);
                const criticalIssues = result.issues.filter((i: any) => i.severity === "critical");

                const domain = parseDomain(fullUrl);
                let site = await prisma.site.findFirst({ where: { domain: { contains: domain } } });
                if (!site && userId) {
                    try {
                        const { isValidPublicDomain } = await import('./src/lib/security');
                        if (isValidPublicDomain(domain)) {
                            try {
                                site = await prisma.site.create({ data: { userId, domain, operatingMode: 'REPORT_ONLY' } });
                                emit({ event: 'site_added', domain, siteId: site.id });
                                log.info({ userId, domain }, 'Auto-created site for on-page URL');
                            } catch (e: any) {
                                if (e?.code === 'P2002') {
                                    site = await prisma.site.findFirst({ where: { domain: { contains: domain } } });
                                } else {
                                    log.warn({ err: e?.message, domain, userId }, 'Failed to auto-create site for on-page URL');
                                }
                            }
                        }
                    } catch (e: any) {
                        log.warn({ err: e?.message, domain, userId }, 'Auto-create on-page path failed');
                    }
                }
                if (site) {
                    await prisma.onPageReport.create({
                        data: { siteId: site.id, url: fullUrl, issues: result.issues as any, score: result.score },
                    });
                    log.info({ tool: "runOnPageAudit", url: fullUrl }, "OnPageReport persisted");
                }

                emit({ event: "tool_log", message: `> On-page report saved — score ${result.score}/100 — ${criticalIssues.length} critical issues` });
                emit({ event: "set_chart", chart: { type: "readability_gauge", gradeLevel: result.score / 10, label: `On-Page Score` } });

                const spokenIssues = criticalIssues
                    .slice(0, 3)
                    .map((i: any) => `Problem: ${i.message}. Fix: ${i.fix || "Refer to SEO best practices."}`);

                return JSON.stringify({
                    url: result.url,
                    score: result.score,
                    title: result.title,
                    metaDescription: result.metaDescription,
                    h1: result.h1,
                    wordCount: result.stats.wordCount,
                    criticalIssueCount: criticalIssues.length,
                    spokenIssueResponses: spokenIssues,
                    passedChecks: result.passed.slice(0, 3),
                    savedToDashboard: !!site,
                    status: `On-page report saved. Speak the score, then go through each issue as: "Problem: [message]. To fix it: [fix]." After each one ask "Shall I create a pull request to fix that?"`,
                });
            } catch (e: any) {
                log.error({ tool: "runOnPageAudit", url: fullUrl, err: e.message }, "Tool failed");
                return JSON.stringify({ error: `On-page audit failed: ${e.message}` });
            }
        },
    });

    const runFullAeoAuditTool = llm.tool({
        description:
            "Complete Answer Engine Optimization audit. Checks schema, E-E-A-T, content quality, and whether the brand is mentioned by Gemini, ChatGPT, and Claude.",
        parameters: z.object({
            domain: z.string().describe("Domain to audit"),
            coreServices: z.string().optional().describe("What the business does"),
        }),
        execute: async ({ domain, coreServices }) => {
            return guardTool("aeoAudit", sessionId, async () => {
            const cleanDomain = parseDomain(sanitiseUrl(domain));
            log.info({ tool: "runFullAeoAudit", domain: cleanDomain }, "Tool invoked");
            emit({ event: "tool_start", tool: `Running AEO Audit on ${cleanDomain}...` });
            try {
                const result = await runAeoAudit(cleanDomain, coreServices);
                const failedHigh = result.checks.filter((c: any) => !c.passed && c.impact === "high");
                const failedMed = result.checks.filter((c: any) => !c.passed && c.impact === "medium");

                const site = await prisma.site.findFirst({ where: { domain: { contains: cleanDomain } } });
                if (site) {
                    await prisma.aeoReport.create({
                        data: {
                            siteId: site.id,
                            score: result.score,
                            grade: result.grade,
                            citationScore: result.citationScore ?? 0,
                            citationLikelihood: result.citationLikelihood ?? 0,
                            generativeShareOfVoice: result.generativeShareOfVoice ?? 0,
                            schemaTypes: result.schemaTypes ?? [],
                            checks: result.checks as any,
                            topRecommendations: failedHigh.slice(0, 5).map((c: any) => c.recommendation),
                            multiEngineScore: (result.multiModelResults as any) ?? null,
                            status: "COMPLETED",
                        },
                    });
                    log.info({ tool: "runFullAeoAudit", domain: cleanDomain }, "AeoReport persisted");
                }

                const modelSummary =
                    result.multiModelResults
                        ?.map((m: any) => `${m.model}: ${m.mentioned ? "mentions you" : "does not mention you"}`)
                        .join(", ") ?? "No model data available";

                const spokenFixes = failedHigh
                    .slice(0, 3)
                    .map((c: any) => `Issue: ${c.label}. Fix: ${c.recommendation}`);

                return JSON.stringify({
                    domain: cleanDomain,
                    score: result.score,
                    grade: result.grade,
                    highImpactFailCount: failedHigh.length,
                    medImpactFailCount: failedMed.length,
                    modelVisibility: modelSummary,
                    spokenFixResponses: spokenFixes,
                    savedToDashboard: !!site,
                    status: `AEO report saved. Start with: "Your AEO grade is ${result.grade}, score ${result.score} out of 100." Then say the model visibility: "${modelSummary}." Then deliver each fix as: "Fix needed: [label]. Here is what to do: [recommendation]." After all fixes ask "Want me to implement any of these automatically?"`,
                });
            } catch (e: any) {
                log.error({ tool: "runFullAeoAudit", domain: cleanDomain, err: e.message }, "Tool failed");
                return JSON.stringify({ error: `AEO audit failed: ${e.message}` });
            }
            }); // end guardTool
        },
    });

    const checkCompetitorTool = llm.tool({
        description:
            "Compares user's domain vs a competitor's Generative Share of Voice across AI models.",
        parameters: z.object({
            myDomain: z.string(),
            competitorDomain: z.string(),
        }),
        execute: async ({ myDomain, competitorDomain }) => {
            return guardTool("competitorCheck", sessionId, async () => {
            const my = parseDomain(myDomain);
            const comp = parseDomain(competitorDomain);
            log.info({ tool: "checkCompetitor", my, comp }, "Tool invoked");
            emit({ event: "tool_start", tool: `Comparing AI visibility: ${my} vs ${comp}` });
            try {
                const [myAeo, compAeo] = await Promise.all([
                    auditMultiModelMentions(my),
                    auditMultiModelMentions(comp),
                ]);
                const winner =
                    myAeo.overallScore > compAeo.overallScore
                        ? my
                        : myAeo.overallScore < compAeo.overallScore
                            ? comp
                            : "Tie";
                emit({ event: "tool_log", message: `> ${my}: ${myAeo.overallScore}pts  ${comp}: ${compAeo.overallScore}pts  Winner: ${winner}` });
                emit({
                    event: "set_chart",
                    chart: {
                        type: "competitor_bar",
                        title: `AI Share of Voice: ${my} vs ${comp}`,
                        data: [
                            { site: my, words: myAeo.overallScore },
                            { site: comp, words: compAeo.overallScore },
                        ],
                    },
                });

                const mySite = await prisma.site.findFirst({ where: { domain: { contains: my } } });
                if (mySite) {
                    await prisma.aiShareOfVoice.createMany({
                        data: ((myAeo as any).keywords ?? ["brand visibility"])
                            .slice(0, 10)
                            .map((kw: string) => ({
                                siteId: mySite.id,
                                keyword: kw,
                                modelName: "multi-model",
                                brandMentioned: myAeo.overallScore > compAeo.overallScore,
                                competitorsMentioned: [comp],
                            })),
                        skipDuplicates: true,
                    });
                }

                const gap = Math.abs(myAeo.overallScore - compAeo.overallScore);
                const gapLabel =
                    gap <= 5 ? "neck and neck" : gap <= 20 ? "a moderate gap" : "a significant gap";

                return JSON.stringify({
                    myDomain: my, myScore: myAeo.overallScore,
                    competitorDomain: comp, competitorScore: compAeo.overallScore,
                    winner, gap, gapLabel, savedToDashboard: !!mySite,
                    status: `Say: "${winner} is winning AI search visibility with a score of ${Math.max(myAeo.overallScore, compAeo.overallScore)}. There is ${gapLabel} of ${gap} points." Then give 2 specific actions to close the gap.`,
                });
            } catch (e: any) {
                log.error({ tool: "checkCompetitor", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Competitor check failed: ${e.message}` });
            }
            }); // end guardTool
        },
    });

    const fetchCompetitorIntelTool = llm.tool({
        description:
            "Deep competitor intelligence: monthly traffic estimate, domain authority tier, content pillars, growth trend, keyword gaps.",
        parameters: z.object({
            myDomain: z.string(),
            competitorDomain: z.string(),
        }),
        execute: async ({ myDomain, competitorDomain }) => {
            return guardTool("competitorIntel", sessionId, async () => {
            const my = parseDomain(myDomain);
            const comp = parseDomain(competitorDomain);
            log.info({ tool: "fetchCompetitorIntel", my, comp }, "Tool invoked");
            emit({ event: "tool_start", tool: `Fetching competitor intelligence for ${comp}` });
            try {
                const result = await fetchCompetitorIntelligence(comp, my);
                const { profile, gaps } = result;
                const topGaps = gaps
                    .slice(0, 8)
                    .map((g) => `"${g.keyword}" (~${g.searchVolume.toLocaleString()} searches/mo)`);
                emit({ event: "tool_log", message: `> ${comp} — ${profile.trafficTier} traffic tier, ${gaps.length} keyword gaps found` });
                emit({
                    event: "set_chart",
                    chart: {
                        type: "competitor_bar",
                        title: `Estimated Monthly Traffic — ${comp}`,
                        data: gaps.slice(0, 6).map((g) => ({ site: g.keyword, words: g.searchVolume })),
                    },
                });

                const mySite = await prisma.site.findFirst({ where: { domain: { contains: my } } });
                if (mySite) {
                    const competitorRecord = await prisma.competitor.upsert({
                        where: { siteId_domain: { siteId: mySite.id, domain: comp } },
                        create: {
                            siteId: mySite.id,
                            domain: comp,
                            metadata: JSON.parse(JSON.stringify({ profile, fetchedAt: new Date().toISOString() })),
                        },
                        update: {
                            metadata: JSON.parse(JSON.stringify({ profile, fetchedAt: new Date().toISOString() })),
                        },
                    });
                    if (gaps.length > 0) {
                        await prisma.competitorKeyword.createMany({
                            data: gaps.slice(0, 20).map((g: any) => ({
                                competitorId: competitorRecord.id,
                                keyword: g.keyword,
                                searchVolume: g.searchVolume ?? null,
                                difficulty: g.difficulty ?? null,
                                position: g.position ?? null,
                            })),
                            skipDuplicates: true,
                        });
                    }
                    log.info({ tool: "fetchCompetitorIntel", comp, gapCount: gaps.length }, "Competitor saved");
                }

                return JSON.stringify({
                    competitor: comp,
                    estimatedMonthlyVisits: profile.estimatedMonthlyVisits,
                    trafficTier: profile.trafficTier,
                    growthTrend: profile.growthTrend,
                    topContentPillars: profile.topContentPillars,
                    topKeywordGaps: topGaps,
                    savedToDashboard: !!mySite,
                    status: `Competitor data saved. Say: "${comp} gets an estimated ${profile.estimatedMonthlyVisits?.toLocaleString() ?? "unknown"} monthly visits." Then name the top keyword gap.`,
                });
            } catch (e: any) {
                log.error({ tool: "fetchCompetitorIntel", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Competitor intel failed: ${e.message}` });
            }
            }); // end guardTool
        },
    });

    const getKeywordRankingsTool = llm.tool({
        description:
            "Fetches live Google Search Console rankings: avg position, clicks, impressions, page-2 opportunities, keyword clusters.",
        parameters: z.object({
            userId: z.string(),
            domain: z.string().optional(),
        }),
        execute: async ({ userId, domain }) => {
            log.info({ tool: "getKeywordRankings", userId }, "Tool invoked");
            emit({ event: "tool_start", tool: "Fetching Google Search Console rankings..." });
            try {
                let accessToken: string;
                try {
                    accessToken = await getUserGscToken(userId);
                } catch (e: any) {
                    if (e.message === "GSC_NOT_CONNECTED") {
                        return JSON.stringify({ error: "GSC not connected", status: "Tell the user to connect Google Search Console from Settings." });
                    }
                    throw e;
                }

                const site = await getUserSite(userId, domain);
                if (!site) return JSON.stringify({ error: "No site found", status: "Tell the user to add their site from My Sites." });

                const siteUrl = normaliseSiteUrl(site.domain);
                const keywords = await fetchGSCKeywords(accessToken, siteUrl);
                const categorised = categoriseKeywords(keywords);
                const summary = buildRankingSummary(keywords);
                const opportunities = findOpportunities(keywords).slice(0, 5);

                emit({ event: "tool_log", message: `> ${summary.total} keywords — avg pos ${summary.avgPosition.toFixed(1)} — ${summary.page1Count} on page 1` });
                emit({
                    event: "set_chart",
                    chart: {
                        type: "keyword_bar",
                        title: `Keyword Rankings — ${site.domain}`,
                        data: opportunities.map((o) => ({ keyword: o.keyword, count: Math.round(100 - o.avgPosition) })),
                    },
                });

                if (keywords.length > 0) {
                    await prisma.rankSnapshot.createMany({
                        data: keywords.slice(0, 50).map((k: any) => ({
                            siteId: site.id,
                            keyword: k.keyword,
                            intent: k.intent ?? null,
                            position: Math.round(k.position ?? 0),
                            device: "desktop",
                        })),
                        skipDuplicates: true,
                    });
                    log.info({ tool: "getKeywordRankings", domain: site.domain, count: Math.min(keywords.length, 50) }, "RankSnapshots saved");
                }

                const spokenOpportunities = opportunities
                    .slice(0, 3)
                    .map((o) => `"${o.keyword}" is at position ${o.avgPosition.toFixed(0)} with ${o.impressions.toLocaleString()} impressions`);

                return JSON.stringify({
                    domain: site.domain,
                    totalKeywords: summary.total,
                    avgPosition: summary.avgPosition.toFixed(1),
                    totalClicks: summary.totalClicks.toLocaleString(),
                    totalImpressions: summary.totalImpressions.toLocaleString(),
                    page1Count: summary.page1Count,
                    criticalCount: summary.criticalCount,
                    spokenOpportunities,
                    strongKeywords: categorised.strong.slice(0, 3).map((k: any) => k.keyword),
                    page2Keywords: categorised.weak.slice(0, 3).map((k: any) => `${k.keyword} at position ${k.position.toFixed(0)}`),
                    savedSnapshots: Math.min(keywords.length, 50),
                    status: `Rankings saved. Say: "You rank for ${summary.total} keywords. Average position is ${summary.avgPosition.toFixed(1)}."`,
                });
            } catch (e: any) {
                log.error({ tool: "getKeywordRankings", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `GSC fetch failed: ${e.message}` });
            }
        },
    });

    const runSeoResearchTool = llm.tool({
        description:
            "7-phase SEO research: business analysis, competitor gaps, keyword master list, trends, 90-day content calendar.",
        parameters: z.object({
            userId: z.string(),
            domain: z.string().optional(),
        }),
        execute: async ({ userId, domain }) => {
            log.info({ tool: "runSeoResearch", userId }, "Tool invoked");
            emit({ event: "tool_start", tool: "Running comprehensive SEO research..." });
            try {
                const site = await getUserSite(userId, domain);
                if (!site) return JSON.stringify({ error: "No site found", status: "Tell user to add their site from My Sites." });

                const report = await runFullSeoResearch(site.id);
                const topKeywords = report.masterList?.slice(0, 8).map((k: any) => `"${k.keyword}" (${k.intent})`);
                const weekOneActions = report.contentCalendar
                    ?.filter((c: any) => c.bucket === "Week 1")
                    .slice(0, 3)
                    .map((c: any) => c.title);

                if (report.masterList?.length) {
                    const snapshots = report.masterList.slice(0, 20).map((k: any) => ({
                        siteId: site.id,
                        keyword: k.keyword,
                        intent: k.intent ?? null,
                        position: k.currentPosition ?? 0,
                        device: "desktop",
                    }));
                    await prisma.rankSnapshot.createMany({ data: snapshots, skipDuplicates: true });
                    log.info({ tool: "runSeoResearch", domain: site.domain }, "RankSnapshots saved");
                }

                return JSON.stringify({
                    domain: report.domain,
                    valueProposition: report.businessAnalysis?.valueProposition,
                    contentPillars: report.businessAnalysis?.pillars?.slice(0, 4),
                    topKeywords,
                    weekOneActions,
                    calendarCount: report.contentCalendar?.length,
                    savedKeywords: Math.min(report.masterList?.length ?? 0, 20),
                    status: `Research complete. Speak the value proposition in one sentence. Then say the top content pillar. Then say the first Week 1 action.`,
                });
            } catch (e: any) {
                log.error({ tool: "runSeoResearch", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `SEO research failed: ${e.message}` });
            }
        },
    });

    const scoreContentTool = llm.tool({
        description:
            "NLP analysis of content: quality score 0-100, entity extraction, keyword density, sentiment, readability.",
        parameters: z.object({
            content: z.string(),
            targetKeywords: z.array(z.string()).optional(),
        }),
        execute: async ({ content, targetKeywords }) => {
            log.info({ tool: "scoreContent", charLen: content.length }, "Tool invoked");
            emit({ event: "tool_start", tool: "Running NLP content scoring..." });
            try {
                const result = await scoreContent(content, targetKeywords ?? []);
                emit({ event: "tool_log", message: `> Content score ${result.score}/100 — readability ${result.readabilityScore.toFixed(1)}` });
                emit({ event: "set_chart", chart: { type: "readability_gauge", gradeLevel: result.readabilityScore, label: `Readability — Grade ${result.readabilityScore.toFixed(1)}` } });

                const scoreLabel = result.score >= 80 ? "strong" : result.score >= 60 ? "average" : "needs work";
                const spokenImprovements = result.topOpportunities
                    .slice(0, 3)
                    .map((o: any, i: number) => `Improvement ${i + 1}: ${o}`);

                return JSON.stringify({
                    score: result.score,
                    scoreLabel,
                    sentiment: result.sentiment,
                    readabilityScore: result.readabilityScore,
                    topEntities: result.entities.slice(0, 4).map((e: any) => `${e.name} (${e.type})`),
                    keywordDensity: result.keywordDensity,
                    spokenImprovements,
                    status: `Say: "Your content scores ${result.score} out of 100 — that is ${scoreLabel}." Then deliver improvements one at a time.`,
                });
            } catch (e: any) {
                log.error({ tool: "scoreContent", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Content scoring failed: ${e.message}` });
            }
        },
    });

    const generateBlogPostTool = llm.tool({
        description:
            "Generates a full AEO-optimised 2000-word blog post with FAQ schema, internal links, and hero image.",
        parameters: z.object({
            mode: z.enum(["trending", "evergreen"]),
            topic: z.string(),
            userId: z.string(),
            country: z.string().optional(),
        }),
        execute: async ({ mode, topic, userId, country }) => {
            log.info({ tool: "generateBlogPost", mode, topic }, "Tool invoked");
            emit({ event: "tool_start", tool: `Generating blog post about ${topic}...` });
            try {
                const site = await getUserSite(userId);
                let post;
                if (mode === "trending") {
                    post = await generateTrendingPost(topic, country ?? "Global", { name: site?.domain ?? "System" }, site?.domain, site?.id);
                } else {
                    post = await generateEvergreenPost(
                        topic,
                        [topic],
                        site ? ({ domain: site.domain, coreServices: site.coreServices ?? undefined } as any) : null,
                        (site as any)?.blogTone,
                        site?.id
                    );
                }
                const wordCount = post.content?.split(/\s+/).length ?? 0;
                const savedBlog = await prisma.blog.findFirst({
                    where: { slug: post.slug },
                    select: { id: true, status: true },
                    orderBy: { createdAt: "desc" },
                });

                return JSON.stringify({
                    title: post.title,
                    slug: post.slug,
                    blogId: savedBlog?.id ?? null,
                    wordCount,
                    hasValidationIssues: (post.validationErrors?.length ?? 0) > 0,
                    savedToDashboard: !!savedBlog,
                    status: `Blog saved to dashboard as a draft. Tell the user: "Your post '${post.title}' is ${wordCount} words and saved as a draft." Then ask: "Want me to publish it to Hashnode or Medium now, or would you like to review it first?"`,
                });
            } catch (e: any) {
                log.error({ tool: "generateBlogPost", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Blog generation failed: ${e.message}` });
            }
        },
    });

    const detectAndHealTool = llm.tool({
        description:
            "Checks if Generative Share of Voice dropped, then executes a healing plan.",
        parameters: z.object({
            userId: z.string(),
            domain: z.string().optional(),
        }),
        execute: async ({ userId, domain }) => {
            log.info({ tool: "detectAndHeal", userId }, "Tool invoked");
            emit({ event: "tool_start", tool: "Detecting AI visibility constraints..." });
            try {
                const site = await getUserSite(userId, domain);
                if (!site) return JSON.stringify({ error: "No site found", status: "Tell user to add their site." });

                const dropInfo = await detectGsovDrop(site.id);
                if (!dropInfo.dropped) {
                    return JSON.stringify({ domain: site.domain, currentGsov: dropInfo.currentGsov, status: `No GSOV drop detected. Current GSOV ${dropInfo.currentGsov}%. Tell the user AI visibility looks stable.` });
                }

                const plan = await generateHealingPlan(site.id, dropInfo.currentGsov, dropInfo.prevGsov);
                await executeHealing(site.id, plan);
                const dropPct = (((dropInfo.prevGsov - dropInfo.currentGsov) / dropInfo.prevGsov) * 100).toFixed(1);

                const spokenActions = plan
                    .slice(0, 3)
                    .map((a: any, i: number) => `Action ${i + 1}: ${a.description}`);

                return JSON.stringify({
                    domain: site.domain,
                    previousGsov: dropInfo.prevGsov,
                    currentGsov: dropInfo.currentGsov,
                    dropPercent: dropPct,
                    healingActionsCount: plan.length,
                    spokenActions,
                    status: `Say: "Your AI visibility dropped ${dropPct} percent. I've triggered ${plan.length} healing actions." Then read each action one at a time.`,
                });
            } catch (e: any) {
                log.error({ tool: "detectAndHeal", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Detect and heal failed: ${e.message}` });
            }
        },
    });

    const triggerAutoFixTool = llm.tool({
        description:
            "Generates a GitHub PR fix for a specific SEO issue. Requires GitHub repo connected in Settings.",
        parameters: z.object({
            userId: z.string(),
            domain: z.string(),
            issueType: z.string(),
            issueDetail: z.string().optional(),
        }),
        execute: async ({ userId, domain, issueType, issueDetail }) => {
            const cleanDomain = parseDomain(domain);
            log.info({ tool: "triggerAutoFix", domain: cleanDomain, issueType }, "Tool invoked");
            emit({ event: "tool_start", tool: `Generating code fix for ${issueType}...` });
            try {
                const site = await prisma.site.findFirst({
                    where: { userId, domain: { contains: cleanDomain } },
                    select: { id: true, domain: true, githubRepoUrl: true },
                });
                if (!site) return JSON.stringify({ status: "error", message: `No site matching "${cleanDomain}". Tell user to add it from My Sites.` });
                if (!site.githubRepoUrl) return JSON.stringify({ status: "no_github", message: "No GitHub repo connected. Tell user to connect one in Site Settings." });

                const check = {
                    id: issueType,
                    category: "technical" as const,
                    label: issueType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                    passed: false,
                    impact: "high" as const,
                    detail: issueDetail ?? `Voice agent flagged: ${issueType}`,
                    recommendation: issueDetail ?? `Fix ${issueType} on ${cleanDomain}`,
                };

                const fixResult = await generateAeoFixInternal(check, cleanDomain, site.githubRepoUrl);
                if (!fixResult.success) return JSON.stringify({ status: "fix_failed", message: `Fix engine error: ${fixResult.error}. Tell user to fix manually from Audit page.` });

                const prResult = await pushPrForUser({
                    userId,
                    repoUrl: site.githubRepoUrl,
                    filePath: fixResult.filePath,
                    content: fixResult.fix,
                    commitMessage: `fix(aeo): ${check.label} — auto-fix via Aria`,
                    siteId: site.id,
                });

                if (!prResult.success) return JSON.stringify({ status: "pr_failed", message: `PR failed: ${prResult.error}. Say: "The pull request failed. You may need to reconnect GitHub in Settings."` });
                return JSON.stringify({
                    status: "success",
                    label: check.label,
                    prUrl: prResult.url,
                    message: `Say: "Done. I've created a pull request to fix the ${check.label} issue. It is waiting for your review in GitHub." Then ask: "Want me to fix the next issue now?"`,
                });
            } catch (e: any) {
                log.error({ tool: "triggerAutoFix", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `AutoFix failed: ${e.message}` });
            }
        },
    });

    const analyzeScreenshotTool = llm.tool({
        description:
            "Analyzes uploaded screenshots (GSC graphs, analytics dashboards, AI Overview screenshots). Call IMMEDIATELY when user uploads any image.",
        parameters: z.object({
            imageBase64: z.string(),
            mimeType: z.string(),
            context: z.string().optional(),
        }),
        execute: async ({ imageBase64, mimeType, context }) => {
            log.info({ tool: "analyzeScreenshot", mimeType }, "Tool invoked");
            emit({ event: "tool_start", tool: "Analyzing screen capture with Vision AI..." });
            if (!process.env.GEMINI_API_KEY)
                return JSON.stringify({ error: "Vision unavailable: GEMINI_API_KEY not set." });
            try {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.models.generateContent({
                    model: AI_MODELS.GEMINI_FLASH,
                    contents: [
                        {
                            role: "user",
                            parts: [
                                { inlineData: { mimeType: mimeType || "image/png", data: imageBase64 } },
                                {
                                    text: `You are an expert SEO analyst. Analyze this screenshot.${context ? ` User context: "${context}"` : ""}\n\nCover: (1) what it shows (2) key trend/finding (3) likely cause (4) one actionable recommendation. Under 150 words — read aloud.`,
                                },
                            ],
                        },
                    ],
                });
                const analysis =
                    response.candidates?.[0]?.content?.parts?.[0]?.text ??
                    "Couldn't analyse that image clearly. Can you describe what you're seeing?";
                return JSON.stringify({ analysis, status: "Read the analysis verbatim, then ask if they want a full audit." });
            } catch (e: any) {
                log.error({ tool: "analyzeScreenshot", err: e.message }, "Tool failed");
                return JSON.stringify({ error: `Vision analysis failed: ${e.message}` });
            }
        },
    });

    const analyzeWebsiteDesignTool = llm.tool({
        description:
            "Takes a live screenshot of a website and uses Gemini Multimodal Vision to evaluate the UX, layout, and visual design out loud.",
        parameters: z.object({
            url: z.string()
        }),
        execute: async ({ url }) => {
            log.info({ tool: "analyzeWebsiteDesign", url }, "Tool invoked");
            emit({ event: "tool_start", tool: `Taking a screenshot of ${url} to analyze its UX design...` });
            emit({ event: "set_chart", chart: { type: "vision_critique", title: `Visual Analysis — ${url}` } });
            try {
                const analysis = await analyzeWebsiteVisuals(url);
                emit({ event: "tool_log", message: `> UX analysis complete for ${url}` });
                return JSON.stringify({
                    url,
                    visual_analysis: analysis,
                    status: `Read the visual analysis critique naturally to the user. Then ask: "Is there anything specific on this page you'd like advice on?"`
                });
            } catch (error: any) {
                log.error({ tool: "analyzeWebsiteDesign", err: error.message }, "Tool failed");
                return JSON.stringify({ error: `Vision analysis failed: ${error.message}` });
            }
        }
    });

    return {
        runSiteAudit: runSiteAuditTool,
        runOnPageAudit: runOnPageAuditTool,
        runFullAeoAudit: runFullAeoAuditTool,
        checkCompetitor: checkCompetitorTool,
        fetchCompetitorIntel: fetchCompetitorIntelTool,
        getKeywordRankings: getKeywordRankingsTool,
        runSeoResearch: runSeoResearchTool,
        scoreContent: scoreContentTool,
        generateBlogPost: generateBlogPostTool,
        detectAndHeal: detectAndHealTool,
        triggerAutoFix: triggerAutoFixTool,
        analyzeScreenshot: analyzeScreenshotTool,
        analyzeWebsiteDesign: analyzeWebsiteDesignTool,
    };
}

// ─── Aria system prompt ────────────────────────────────────────────────────────
function buildAriaInstructions(siteContext: string): string {
    const noSitesHint = /no sites registered/i.test(siteContext);
    const noSitesInstructions = noSitesHint
        ? `\nNO SITES REGISTERED: The user currently has no sites registered. Do NOT run any audits. First ask the user to provide the URL they want audited or offer to add it on their behalf. Wait for the user's response before calling any tools.\n`
        : `\nSITES LOADED: The user already has sites prefetched above. Engage them conversationally to find out what they want to do next. Do not run any audits unless explicitly asked.\n`;

    return `You are Aria, an expert AI SEO & AEO strategist, the voice-first intelligence of the AISEO platform. You are warm, precise, proactive, and speak like a trusted advisor — not a chatbot.

CURRENT USER SESSION CONTEXT (prefetched from the database — do NOT ask the user for this information):
${siteContext}

${noSitesInstructions}

━━━ MULTILINGUAL BEHAVIOUR ━━━
- Detect the user's language from their very first message and respond in that same language for the entire session.
- If the user speaks Spanish, reply fully in Spanish. French → French. Arabic → Arabic. Portuguese → Portuguese. And so on.
- Never mix languages within a single turn.
- Technical terms ("SEO score", "Core Web Vitals", "schema markup") may remain in English if no universally accepted translation exists — briefly explain the term the first time you use it.
- Numeric formats should follow the user's locale (e.g., periods vs commas for thousands separators).
- Do NOT announce that you are switching languages — just do it naturally.

━━━ ANTI-HALLUCINATION RULES (CRITICAL) ━━━
- ONLY cite numbers, scores, and facts returned by a tool call in the current session. Never invent metrics.
- If you do not have data for something, say so: "I don't have that data right now — want me to pull it up?" Then call the appropriate tool.
- NEVER speculate about a site's ranking, traffic, or score unless a tool just returned that data.
- If a tool returns an error, tell the user honestly: "I couldn't retrieve that right now" and suggest what to try next.
- Do NOT repeat cached numbers from previous user sessions; always reference the current session's tool results.

━━━ AUDIO-FIRST VOICE RULES ━━━
- HARD LIMIT: Never speak more than 2 sentences in a single turn without pausing for user response.
- Keep each sentence under 20 words. Long sentences cause audio buffer overflows.
- No bullet lists. No raw URLs read aloud. No lists of more than 3 items spoken in one go.
- After delivering a score or finding, stop and ask one focused question before continuing.
- NEVER CALL MORE THAN ONE TOOL AT A TIME. Wait for each tool to finish and return results before invoking another.
- Speak numbers as words when natural: "forty-two out of a hundred" rather than "42/100".
- Round decimals for voice: "position eleven" not "position 10.7".

━━━ TOOLS — call proactively when the user's intent is clear ━━━
- runSiteAudit: full technical SEO audit — score + critical issues
- runOnPageAudit: deep single-page analysis — title, meta, H1s, word count
- runFullAeoAudit: AI search visibility — Gemini/ChatGPT/Claude mentions, schema, E-E-A-T
- checkCompetitor: head-to-head Generative Share of Voice comparison
- fetchCompetitorIntel: competitor traffic, keyword gaps, content pillars
- getKeywordRankings: live Google Search Console rankings, page-2 opportunities
- runSeoResearch: 7-phase content strategy + keyword roadmap
- scoreContent: NLP quality scoring of pasted text
- generateBlogPost: write a 2000-word AEO-optimised post with FAQ schema
- detectAndHeal: detect AI visibility (GSOV) drop and trigger healing actions
- triggerAutoFix: stage a GitHub Pull Request to fix a specific SEO issue
- analyzeScreenshot: vision analysis of an uploaded screenshot (GSC graph, analytics)
- analyzeWebsiteDesign: Playwright live screenshot + Gemini Vision UX critique

━━━ TOOL CALLING PROTOCOL ━━━
- Before calling any tool, announce what you are about to do: e.g., "Let me pull that up now — one second."
- Tools needing userId: always pass the current participant's room identity.
- Be proactive: user says "my traffic dropped" → call getKeywordRankings, then (if confirmed by user) detectAndHeal — each one at a time.

━━━ SITE CONTEXT RULES ━━━
- You already know the user's sites from the prefetched context. NEVER ask for a domain you already have.
- If the user says "my site" and there is exactly one registered, use it automatically.
- If multiple sites and the user picks one by name or number, call runSiteAudit on that domain immediately.
- All audit results are automatically saved to the dashboard — always confirm: "I've saved this to your dashboard."

━━━ ISSUE DELIVERY (one at a time — never dump a list) ━━━
- Deliver ONE issue per turn: "Issue one: [title]. To fix it: [recommendation]."
- After each issue, pause and ask: "Want me to auto-fix that with a pull request, or shall I move to the next issue?"
- Wait for the user's response before continuing.
- "fix it" → call triggerAutoFix immediately.
- "next" → deliver the next issue.
- "fix everything" / "all" → queue fixes one at a time, confirming each before the next.

━━━ CACHED AUDIT AWARENESS ━━━
- If audit data in context has isFromCache: true, ask the user whether the top issue was addressed since the last audit before running a fresh scan.
- "yes it's fixed" → run a fresh runSiteAudit and compare scores.
- "not yet" → offer triggerAutoFix or a manual fix explanation.
- "run fresh audit" → call runSiteAudit immediately.

━━━ PERSONA & TONE ━━━
- You are Aria. Never say "as an AI" — you are Aria, a specialist strategist.
- Never redirect the user to documentation or manuals. You have all the knowledge; be the expert.
- End every response with exactly one clear, actionable next-step question.
- If a tool fails (missing GSC/GitHub connection), explain concisely what the user needs to do to fix it.`;
}

// ─── Agent entry ──────────────────────────────────────────────────────────────
export default defineAgent({
    entry: async (ctx: JobContext) => {
        await ctx.connect();

        // FIX: Scoped emitter per job context — no module-level global
        const emit = createEmitter(ctx);

        let participant = await Promise.race([
            ctx.waitForParticipant(),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Participant did not join within 30s")),
                    30_000
                )
            ),
        ]).catch((err) => {
            log.error({ err: err.message }, "Timed out waiting for participant");
            return null;
        });

        if (!participant) return;

        // Handle participant disconnect/reconnect so the agent session can
        // re-attach when the user rejoins instead of exiting immediately.
        ctx.room.on("participantDisconnected", (p) => {
            try {
                if (p.identity === participant?.identity) {
                    log.info({ participant: p.identity }, "Participant disconnected — will wait for reconnection");
                    // Do not close the session here; we have closeOnDisconnect=false.
                }
            } catch (e) {
                /* ignore */
            }
        });

        ctx.room.on("participantConnected", (p) => {
            try {
                if (p.identity === participant?.identity) {
                    log.info({ participant: p.identity }, "Participant reconnected — re-attaching participant handle");
                    participant = p;
                }
            } catch (e) {
                /* ignore */
            }
        });

        const pContext = participant;
        // Wait up to 3 seconds for the participant's microphone track to be published.
        log.info({ participantId: pContext.identity }, "Waiting for participant microphone track...");
        await new Promise<void>((resolve) => {
            const hasMic = () =>
                [...pContext.trackPublications.values()].some(
                    (pub: any) => pub.source === "SOURCE_MICROPHONE" || pub.kind === "audio" || pub.kind === "KIND_AUDIO"
                );
            if (hasMic()) {
                log.info({ participantId: pContext.identity }, "Mic track already published");
                return resolve();
            }
            const onTrack = () => {
                if (hasMic()) {
                    ctx.room.off("trackPublished", trackListener);
                    log.info({ participantId: pContext.identity }, "Mic track now published");
                    resolve();
                }
            };
            const trackListener = (pub: any, p: any) => {
                if (p?.identity === pContext.identity) onTrack();
            };
            ctx.room.on("trackPublished", trackListener);
            // 3-second safety valve
            setTimeout(() => {
                ctx.room.off("trackPublished", trackListener);
                log.warn({ participantId: pContext.identity }, "Mic track wait timed out — proceeding without mic confirmation");
                resolve();
            }, 3_000);
        });

        const userId = participant.identity;
        const roomName = ctx.room.name; // unique per session — used for Redis rate-limit keys
        log.info({ userId, roomName }, "Participant joined");

        // Prefetch with timeout — will not block past 8s
        log.info({ userId }, "Prefetching user context");
        const { sites, primaryAudit, greeting } = await prefetchUserContext(userId, emit);
        log.info({ userId, siteCount: sites.length }, "Prefetch complete");

        const siteContext =
            sites.length === 0
                ? "User has no sites registered yet."
                : [
                    `User's registered sites: ${sites.map((s) => s.domain).join(", ")}`,
                    `Primary site: ${sites[0].domain}`,
                    sites[0].coreServices ? `Core services: ${sites[0].coreServices}` : null,
                    primaryAudit
                        ? `Pre-loaded audit for ${primaryAudit.domain}: score ${primaryAudit.score}/100, top issue: ${primaryAudit.topIssue}`
                        : null,
                    sites.length > 1
                        ? `Other sites: ${sites.slice(1).map((s) => s.domain).join(", ")}`
                        : null,
                ]
                    .filter(Boolean)
                    .join("\n");

      
        // Win 9: Load strategy memories for the primary site
        let memorySection = "";
        const primarySiteId = sites.length > 0 ? sites[0].id : null;
        if (primarySiteId) {
            try {
                const { loadMemories, formatMemoriesForPrompt } = await import("./src/lib/strategy-memory");
                const memories = await loadMemories(userId, primarySiteId, 25);
                memorySection = formatMemoriesForPrompt(memories);
            } catch {
                // Non-fatal — proceed without memories
            }
        }

        const realtimeModel = new google.beta.realtime.RealtimeModel({
           
            model: process.env.GEMINI_REALTIME_MODEL ?? AI_MODELS.GEMINI_LIVE,
            apiKey: process.env.GEMINI_API_KEY,
            voice: (process.env.GEMINI_VOICE as any) ?? "Puck",
            
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
                automaticActivityDetection: {
                
                    disabled: false,
                
                    prefixPaddingMs: 200,
                    silenceDurationMs: 1800,
                },
            },
        });

      
        try {
            (realtimeModel as any)?.on?.('error', (err: any) => {
                log.warn({ err }, 'RealtimeModel emitted error');
            });
        } catch {}

       
        const agentSession = new voice.AgentSession({
            llm: realtimeModel,
            voiceOptions: {
                
                userAwayTimeout: 1000 * 60 * 60 * 24 * 365,

                // ── Barge-in tuning ────────────────────────────────────────
                allowInterruptions: true,

               
                minInterruptionDuration: 300,
                minInterruptionWords: 1,
            }
        });

        // Consume session-level errors as well
        try {
            (agentSession as any)?.on?.('error', (err: any) => {
                log.warn({ err }, 'AgentSession emitted error');
            });
        } catch {}

        const agent = new voice.Agent({
            // Win 9: Prepend memory section before main instructions
            instructions: (memorySection ? memorySection + "\n\n" : "") + buildAriaInstructions(siteContext),
            tools: buildTools(emit, userId, roomName),
        });

        // Retry agentSession.start() with exponential backoff to tolerate
        // transient network/remote errors from the Gemini realtime service.
        const maxStartAttempts = 3;
        let started = false;
        for (let attempt = 1; attempt <= maxStartAttempts; attempt++) {
            try {
                await agentSession.start({ agent, room: ctx.room, inputOptions: { closeOnDisconnect: false } });
                log.info({ userId, attempt }, "Aria session started");
                started = true;
                break;
            } catch (err: any) {
                const code = err?.context?.error?.statusCode || err?.body?.code || err?.statusCode;
                log.warn({ err, attempt, code }, `agentSession.start() failed on attempt ${attempt}`);
                if (code === 1006) {
                    // WebSocket 1006: abnormal close (no close frame) — transient network/TLS drop.
                    // Retrying is safe and usually resolves within 1-2 attempts.
                    log.warn({ code, attempt }, 'WebSocket 1006 (abnormal close) — transient. Will retry.');
                }
                if (code === 1008) {
                    log.error({ code }, 'Gemini Realtime returned 1008: Operation not implemented/supported/enabled. Check model permissions or API access for realtime.');
                    // don't keep retrying if operation not supported
                    break;
                }
                if (attempt < maxStartAttempts) {
                    const delay = 500 * Math.pow(2, attempt - 1);
                    log.info({ attempt, delay }, 'Retrying agentSession.start after backoff');
                    await sleep(delay);
                }
            }
        }

        if (started) {
            // generateReply is expected to open the first generation. Retry a
            // few times on transient generate timeouts.
            const maxGenAttempts = 3;
            for (let gAttempt = 1; gAttempt <= maxGenAttempts; gAttempt++) {
                try {
                    await agentSession.generateReply({
                        instructions: `Greet the user with exactly this message, word for word: "${greeting}"`,
                    });
                    break;
                } catch (err: any) {
                    const code = err?.context?.error?.statusCode || err?.body?.code || err?.statusCode;
                    log.warn({ err, gAttempt, code }, `generateReply failed on attempt ${gAttempt}`);
                    if (code === 1008) {
                        log.error({ code }, 'Gemini Realtime returned 1008 during generateReply: operation unsupported.');
                        break;
                    }
                    if (gAttempt < maxGenAttempts) {
                        const delay = 400 * Math.pow(2, gAttempt - 1);
                        log.info({ gAttempt, delay }, 'Retrying generateReply after backoff');
                        await sleep(delay);
                    } else {
                        log.error({ gAttempt }, 'generateReply exhausted retries');
                    }
                }
            }
            // After the initial greeting/generation, keep the session alive.
            // We use a Promise that resolves when the room disconnects, ensuring
            // the agent process doesn't prematurely exit while audits are running.
            try {
                emit({ event: 'awaiting_user_input', timeoutMs: 0 });
                log.info({ userId }, 'Agent ready; keeping process alive until room disconnects');
                
                await new Promise<void>((resolve) => {
                    ctx.room.once('disconnected', () => resolve());
                });
            } catch (e: any) {
                log.debug({ err: e?.message }, 'Agent wait loop interrupted');
            }
        } else {
            log.error({ userId }, 'AgentSession failed to start after retries; skipping initial generateReply');
        }

        // Listen for client-published data messages such as a spoken URL.
        const dataHandler = async (payload: Uint8Array, _participant?: any) => {
            try {
                const msg = JSON.parse(new TextDecoder().decode(payload));
                if (!msg || typeof msg !== 'object') return;

                if (msg.event === 'request_confirmation' && typeof msg.url === 'string') {
                    const given = msg.url.trim();
                    const urlStr = given.startsWith('http') ? given : `https://${given}`;
                    let parsed: URL | null = null;
                    try {
                        parsed = new URL(urlStr);
                    } catch (e) {
                        emit({ event: 'tool_log', message: `Invalid URL for confirmation: ${given}` });
                        return;
                    }
                    const domain = parseDomain(parsed.hostname || parsed.host || given);
                    // Ask the user verbally to confirm the detected URL before auditing
                    try {
                        await agentSession.generateReply({
                            instructions: `I detected the URL ${domain}. Would you like me to audit this site now? Please say 'yes' to proceed or 'no' to cancel.`,
                        });
                        emit({ event: 'tool_log', message: `Asked user to confirm audit for ${domain}` });
                    } catch (e: any) {
                        log.warn({ err: e?.message }, 'Failed to ask user for URL confirmation verbally');
                    }
                }
                
            } catch (e) {
                /* ignore malformed payloads */
            }
        };

        try {
            ctx.room.on('dataReceived', dataHandler);
        } catch {}

        
        const sessionTranscript: Array<{ role: "user" | "assistant"; text: string }> = [];
        try {
            (agentSession as any)?.on?.("transcription", (t: { role: string; text: string }) => {
                sessionTranscript.push({
                    role: t.role === "user" ? "user" : "assistant",
                    text: t.text ?? "",
                });
            });
        } catch {}

        ctx.room.once("disconnected", async () => {
            log.info({ userId }, "Room disconnected — releasing resources");
            try {
                // Win 9: Save session summary if enough turns
                if (primarySiteId && sessionTranscript.length >= 4) {
                    const { summariseSession, saveMemory } = await import("./src/lib/strategy-memory");
                    const summary = await summariseSession(sessionTranscript);
                    if (summary) {
                        await saveMemory(userId, primarySiteId, {
                            memoryType: "session_summary",
                            content: summary,
                        });
                        log.info({ userId }, "Session summary saved to StrategyMemory");
                    }
                }
            } catch {
                /* non-critical */
            }
            try {
                await prisma.$disconnect();
            } catch {
                /* non-critical */
            }
        });
    },
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
// Railway and Cloud Run send SIGTERM before force-killing a container.
// Without a handler the process exits mid-session; Prisma connection pool
// leaks, and the LiveKit room stays open until its own 30s timeout fires.
async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, "[Aria] Received shutdown signal — draining gracefully");
    try {
        // Give in-flight sessions up to 10s to finish their current step
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        await prisma.$disconnect();
        log.info("[Aria] Prisma disconnected — exiting cleanly");
    } catch (e: any) {
        log.error({ err: e?.message }, "[Aria] Error during shutdown");
    } finally {
        process.exit(0);
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ─── Worker ───────────────────────────────────────────────────────────────────
cli.runApp(
    new WorkerOptions({
        agent: __filename,
        numIdleProcesses: 1,
        initializeProcessTimeout: 120_000,
    })
);