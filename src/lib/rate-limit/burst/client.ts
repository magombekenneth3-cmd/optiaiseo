/**
 * Named burst rate-limiter instances backed by Upstash Redis.
 *
 * All limiters are module-level singletons (created once at startup, reused
 * across every request) so there is no per-request allocation cost.
 *
 * Usage:
 *   import { rateLimit, getClientIp } from "@/lib/rate-limit";
 *   const limited = await rateLimit("blogGenerate", userId);
 *   if (limited) return limited;
 *
 * Or use limiters directly for advanced keying:
 *   const { success } = await limiters.auditRun.limit(`${userId}:${siteId}`);
 */
import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest } from "next/server";
import { redis, ALLOW_ALL } from "./_redis";

function makeLimiter(requests: number, window: string, prefix: string): Ratelimit {
    if (!redis) return ALLOW_ALL;
    return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
            requests,
            window as Parameters<typeof Ratelimit.slidingWindow>[1],
        ),
        prefix,
        analytics: true,
    });
}

// ─── Named limiters ───────────────────────────────────────────────────────────
// Key                | Identifier    | Limit | Window | Purpose
// -------------------|---------------|-------|--------|---------------------------
// auth               IP              10      15 m     Sign-in / sign-up brute-force
// passwordReset      IP+email        3       1 h      Account enumeration guard
// api                userId          120     1 m      General authenticated API calls
// blogGenerate       userId          5       1 m      Expensive Gemini generation
// blogRepurpose      blogId          1       24 h     Multi-format repurpose (1/blog/day)
// aeoCheck           userId          3       1 m      Multi-LLM AEO checks
// voiceSession       userId          5       1 h      LiveKit token issuance
// auditRun           userId+siteId   3       5 m      Live-site crawl (dual key at call site)
// competitorFetch    userId          10      1 h      Serper / DataForSEO calls
// competitorAnalyse  userId          10      1 h      Async page analysis via Inngest
// githubPr           userId          5       1 h      GitHub API PR creation
// indexingSubmit     siteId          20      1 d      Google Indexing API quota
// webhook            IP              50      1 m      Stripe / LiveKit callbacks
// citationGap        siteId          1       6 h      Perplexity / Gemini citation gap
// creditsConsume     userId          20      1 m      Credit deduction guard
// stripeCheckout     userId          5       1 m      Checkout session creation
// freeUnlock         IP              10      1 m      Free audit email-unlock (anti-harvest)
// auditProgress      IP              60      1 m      Free audit SSE polling (~1 req/s × tabs)
// redditOpportunities IP             20      1 m      Google CSE / Reddit API quota guard
// shareCreate        userId          5       1 h      Audit share-token creation
// shareView          IP              30      1 m      Public share page (token enumeration guard)
// trackedRankCheck   userId          5       1 h      DataForSEO SERP call
// pdfReport          userId          3       1 h      Puppeteer PDF generation
// cannibalizationScan userId         5       1 h      GSC pull + keyword compute
// wpPlugin           userId          60      1 h      WordPress plugin API

export const limiters = {
    auth:                makeLimiter(10,  "15 m", "rl:auth"),
    passwordReset:       makeLimiter(3,   "1 h",  "rl:password-reset"),
    api:                 makeLimiter(120, "1 m",  "rl:api"),
    blogGenerate:        makeLimiter(5,   "1 m",  "rl:blog-generate"),
    blogRepurpose:       makeLimiter(1,   "24 h", "rl:blog-repurpose"),
    aeoCheck:            makeLimiter(3,   "1 m",  "rl:aeo-check"),
    voiceSession:        makeLimiter(5,   "1 h",  "rl:voice-session"),
    auditRun:            makeLimiter(3,   "5 m",  "rl:audit-run"),
    competitorFetch:     makeLimiter(10,  "1 h",  "rl:competitor-fetch"),
    competitorAnalyse:   makeLimiter(10,  "1 h",  "rl:competitor-analyse"),
    githubPr:            makeLimiter(5,   "1 h",  "rl:github-pr"),
    indexingSubmit:      makeLimiter(20,  "1 d",  "rl:indexing-submit"),
    webhook:             makeLimiter(50,  "1 m",  "rl:webhook"),
    citationGap:         makeLimiter(1,   "6 h",  "rl:citation-gap"),
    creditsConsume:      makeLimiter(20,  "1 m",  "rl:credits-consume"),
    stripeCheckout:      makeLimiter(5,   "1 m",  "rl:stripe-checkout"),
    freeUnlock:          makeLimiter(10,  "1 m",  "rl:free-unlock"),
    auditProgress:       makeLimiter(60,  "1 m",  "rl:audit-progress"),
    redditOpportunities: makeLimiter(20,  "1 m",  "rl:reddit-opportunities"),
    shareCreate:         makeLimiter(5,   "1 h",  "rl:share-create"),
    shareView:           makeLimiter(30,  "1 m",  "rl:share-view"),
    trackedRankCheck:    makeLimiter(5,   "1 h",  "rl:tracked-rank-check"),
    pdfReport:           makeLimiter(3,   "1 h",  "rl:pdf-report"),
    cannibalizationScan: makeLimiter(5,   "1 h",  "rl:cannibalization-scan"),
    wpPlugin:            makeLimiter(60,  "1 h",  "rl:wp-plugin"),
} as const;

export type LimiterKey = keyof typeof limiters;

/**
 * Check a named limiter against an identifier (userId, IP, composite key, etc.).
 * Returns a 429 Response with Retry-After headers, or null when within limits.
 *
 * @example
 *   const limited = await rateLimit("blogGenerate", userId);
 *   if (limited) return limited;
 */
export async function rateLimit(
    limiterName: LimiterKey,
    identifier: string,
): Promise<Response | null> {
    const { success, limit, remaining, reset } = await limiters[limiterName].limit(identifier);

    if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return new Response(
            JSON.stringify({ error: "Too many requests", retryAfter, limiter: limiterName }),
            {
                status: 429,
                headers: {
                    "Content-Type":          "application/json",
                    "X-RateLimit-Limit":     String(limit),
                    "X-RateLimit-Remaining": String(remaining),
                    "X-RateLimit-Reset":     String(reset),
                    "Retry-After":           String(retryAfter),
                },
            },
        );
    }

    return null;
}

/**
 * Extract the real client IP from a NextRequest.
 * Handles Vercel x-forwarded-for and Cloud Run x-real-ip.
 * Falls back to loopback — never returns undefined.
 */
export function getClientIp(req: NextRequest): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        req.headers.get("x-real-ip") ??
        "127.0.0.1"
    );
}
