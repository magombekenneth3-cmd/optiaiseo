import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis/cloudflare";

const isDev = process.env.NODE_ENV === "development";

const STATIC_SECURITY_HEADERS: Record<string, string> = {
    "X-Content-Type-Options":            "nosniff",
    "X-Frame-Options":                   "DENY",
    "X-XSS-Protection":                  "1; mode=block",
    "Referrer-Policy":                   "strict-origin-when-cross-origin",
    "Permissions-Policy":                "camera=(), microphone=(self), geolocation=(), payment=(self)",
    "Strict-Transport-Security":         "max-age=63072000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy":        "same-origin-allow-popups",
    "Cross-Origin-Embedder-Policy":      "unsafe-none",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-DNS-Prefetch-Control":            "on",
};

function buildCsp(nonce: string): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' data: blob: https://images.unsplash.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://cdn.hashnode.com",
        "font-src 'self' data:",
        "connect-src 'self' https://api.stripe.com https://*.livekit.cloud wss://*.livekit.cloud https://generativelanguage.googleapis.com https://api.anthropic.com https://api.openai.com https://inn.gs https://*.inngest.com https://*.upstash.io https://api.resend.com https://api.serper.dev https://serpapi.com",
        "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
    ].join("; ");
}

function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
    for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
        response.headers.set(key, value);
    }
    response.headers.set("Content-Security-Policy", buildCsp(nonce));
    response.headers.set("x-nonce", nonce);
    return response;
}

function forwardRefCookie(source: NextResponse, dest: NextResponse): void {
    const refValue = source.cookies.get("aiseo_ref")?.value;
    if (refValue) {
        dest.cookies.set("aiseo_ref", refValue, {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 90,
        });
    }
}

let redis: Redis | null = null;
let limiterPublic: Ratelimit | null = null;
let limiterAuthed: Ratelimit | null = null;
let limiterStrict: Ratelimit | null = null;
let limiterAi: Ratelimit | null = null;

function getRedis(): Redis | null {
    if (redis) return redis;
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redis;
}

function getLimiters() {
    const r = getRedis();
    if (!r) return null;
    if (!limiterPublic) {
        limiterPublic = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(20, "1 m"), prefix: "rl:pub", ephemeralCache: new Map() });
        limiterAuthed = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(120, "1 m"), prefix: "rl:auth", ephemeralCache: new Map() });
        limiterStrict = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(10, "1 m"), prefix: "rl:strict", ephemeralCache: new Map() });
        limiterAi = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(5, "1 m"), prefix: "rl:ai", ephemeralCache: new Map() });
    }
    return { limiterPublic: limiterPublic!, limiterAuthed: limiterAuthed!, limiterStrict: limiterStrict!, limiterAi: limiterAi! };
}

const STRICT_PATHS = [
    "/api/auth/signin",
    "/api/auth/callback/credentials",
    "/api/auth/forgot-password",
    "/api/webhooks",
];

const AI_PATHS = [
    "/api/aeo/ai-reasoning",
    "/api/aeo/sov",
    "/api/competitors/beat-plan",
    "/api/aeo/forecast",
    "/api/aeo/diagnosis",
    "/api/geo/competitor-profile",
    "/api/aio/competitor-entity",
];

const PUBLIC_PAGE_PREFIXES = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/_next",
    "/favicon.ico",
];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

    const isProtectedPage = pathname.startsWith("/dashboard");
    const isAdminPage = pathname.startsWith("/admin");
    const isPublicPage = PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
    const isApiRoute = pathname.startsWith("/api/");

    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

    const refCode = request.nextUrl.searchParams.get("ref");
    const existingRef = request.cookies.get("aiseo_ref")?.value;

    let baseResponse = NextResponse.next();

    if (refCode && !existingRef && /^REF-[A-F0-9]{8}$/i.test(refCode)) {
        baseResponse.cookies.set("aiseo_ref", refCode.toUpperCase(), {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 90,
        });
    }

    if (isProtectedPage && !isPublicPage && !isApiRoute) {
        if (!token) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            const redirectRes = NextResponse.redirect(loginUrl);
            return applySecurityHeaders(redirectRes, nonce);
        }
    }

    if (isAdminPage || pathname.startsWith("/api/admin/")) {
        if (!token) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            const redirectRes = NextResponse.redirect(loginUrl);
            return applySecurityHeaders(redirectRes, nonce);
        }
        const isSuperAdmin = (token.role as string | undefined) === "SUPER_ADMIN";
        if (!isSuperAdmin) {
            const redirectRes = NextResponse.redirect(new URL("/dashboard", request.url));
            return applySecurityHeaders(redirectRes, nonce);
        }
    }

    if (isApiRoute && !pathname.startsWith("/api/auth/")) {
        const ip =
            (request as NextRequest & { ip?: string }).ip ??
            request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
            "127.0.0.1";

        const limiters = getLimiters();
        if (!limiters) return applySecurityHeaders(baseResponse, nonce);

        const isStrict = STRICT_PATHS.some((p) => pathname.startsWith(p));
        const isAi = AI_PATHS.some((p) => pathname.startsWith(p));

        let identifier: string;
        let limiter: Ratelimit;

        if (isStrict) {
            identifier = `ip:${ip}:${pathname}`;
            limiter = limiters.limiterStrict;
        } else if (isAi) {
            identifier = token?.id ? `ai:${token.id as string}:${pathname}` : `ai:${ip}:${pathname}`;
            limiter = limiters.limiterAi;
        } else {
            if (token?.id) {
                identifier = `uid:${token.id as string}`;
                limiter = limiters.limiterAuthed;
            } else {
                identifier = `ip:${ip}`;
                limiter = limiters.limiterPublic;
            }
        }

        const { success, limit, remaining, reset } = await limiter.limit(identifier);

        if (!success) {
            const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
            const tooManyRes = new NextResponse(
                JSON.stringify({ error: "Too many requests", retryAfter }),
                {
                    status: 429,
                    headers: {
                        "Content-Type": "application/json",
                        "X-RateLimit-Limit": String(limit),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": String(reset),
                        "Retry-After": String(retryAfter),
                    },
                }
            );
            return applySecurityHeaders(tooManyRes, nonce);
        }

        const apiRes = NextResponse.next();
        apiRes.headers.set("X-RateLimit-Limit", String(limit));
        apiRes.headers.set("X-RateLimit-Remaining", String(remaining));
        apiRes.headers.set("X-RateLimit-Reset", String(reset));
        forwardRefCookie(baseResponse, apiRes);
        return applySecurityHeaders(apiRes, nonce);
    }

    return applySecurityHeaders(baseResponse, nonce);
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    ],
};