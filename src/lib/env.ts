import { logger } from "./logger";
import { z } from "zod";

const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GEMINI_API_KEY: z.string().min(1),
    LIVEKIT_URL: z.string().min(1),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    PERPLEXITY_API_KEY: z.string().optional(),
    SERPER_API_KEY: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    // Upstash Redis (replaces REDIS_URL for HTTP client)
    UPSTASH_REDIS_REST_URL: process.env.NODE_ENV === "production"
        ? z.string().url()
        : z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().optional(),
    // Upstash Vector — semantic LLM response cache (Win 3)
    // Create an index at console.upstash.com with dimension 1536
    UPSTASH_VECTOR_REST_URL: z.string().url().optional(),
    UPSTASH_VECTOR_REST_TOKEN: z.string().optional(),
    // Legacy REDIS_URL — only for ioredis-compatible clients (docker redis service)
    // REDIS_URL is legacy (docker-compose local Redis). Production uses Upstash HTTP
    // via UPSTASH_REDIS_REST_URL — never require a raw redis:// URL in production.
    REDIS_URL: z.string().url().optional(),
    // Stripe
    // Stripe — required in production, optional in local dev so the build succeeds
    // without billing wire-up.
    STRIPE_SECRET_KEY: process.env.NODE_ENV === "production"
        ? z.string().min(1).startsWith("sk_")
        : z.string().optional(),
    STRIPE_WEBHOOK_SECRET: process.env.NODE_ENV === "production"
        ? z.string().min(1).startsWith("whsec_")
        : z.string().optional(),
    STRIPE_PRO_PRICE_ID: z.string().optional(),
    STRIPE_STARTER_PRICE_ID: z.string().optional(), // Required in production — see startup check below
    STRIPE_AGENCY_PRICE_ID: z.string().optional(),
    STRIPE_CREDIT_PACK_PRICE_ID: process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().optional(),
    // Annual billing price IDs — optional; fall back to monthly when absent
    STRIPE_STARTER_ANNUAL_PRICE_ID: z.string().optional(),
    STRIPE_PRO_ANNUAL_PRICE_ID:     z.string().optional(),
    STRIPE_AGENCY_ANNUAL_PRICE_ID:  z.string().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    // CRON_SECRET — required in production. Missing = all cron jobs silently 401.
    CRON_SECRET: process.env.NODE_ENV === "production"
        ? z.string().min(32, "CRON_SECRET must be at least 32 chars in production")
        : z.string().optional(),
    DATAFORSEO_LOGIN: z.string().optional(),
    DATAFORSEO_PASSWORD: z.string().optional(),
    // Inngest — required in production. Missing INNGEST_SIGNING_KEY means any caller
    // can invoke your background jobs — unauthenticated code execution.
    INNGEST_EVENT_KEY: process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().optional(),
    INNGEST_SIGNING_KEY: process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().optional(),
    // Gemini tuning
    GEMINI_RPM_LIMIT: z.string().optional(),
    // Optional API integrations (features degrade gracefully when absent)
    PAGESPEED_API_KEY: z.string().optional(),
    GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
    GOOGLE_KG_API_KEY: z.string().optional(),
    GOOGLE_SEARCH_API_KEY: z.string().optional(),
    GOOGLE_SEARCH_CX: z.string().optional(),
    UNSPLASH_ACCESS_KEY: z.string().optional(),
    RESEND_FROM_DOMAIN: z.string().optional(),
    BROWSERLESS_URL: z.string().url().optional(),
    GITHUB_TOKEN: z.string().optional(),
    MOZ_API_TOKEN: z.string().optional(),
    MOZ_ACCESS_ID: z.string().optional(),
    MOZ_SECRET_KEY: z.string().optional(),
    // Blog publishing
    HASHNODE_TOKEN: z.string().optional(),
    HASHNODE_PUBLICATION_ID: z.string().optional(),
    // Missing entries — gap 1.4 fix
    SERPAPI_KEY: z.string().optional(),
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    // Google Service Account (GSC indexing, Google Indexing API)
    GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
    GOOGLE_PRIVATE_KEY: z.string().optional(),
    // Admin email override (gap 1.1)
    ADMIN_EMAIL: z.string().email().optional(),
});

export const env = (() => {
    if (process.env.SKIP_ENV_VALIDATION === "1") {
        const buildRequired = ["DATABASE_URL", "NEXTAUTH_SECRET"] as const;
        for (const key of buildRequired) {
            if (!process.env[key]) {
                // Warn instead of throw — a missing build ARG should not crash
                // the Next.js static prerender workers. The value will be
                // validated again at runtime when it truly matters.
                console.error(`[Env] WARNING: ${key} is not set as a build ARG. Static pages may behave unexpectedly.`);
            }
        }
        return process.env as unknown as z.infer<typeof envSchema>;
    }
    try {
        return envSchema.parse(process.env);
    } catch (e: unknown) {
        // NEVER re-throw here. In Next.js standalone (Docker) modules are lazy-loaded,
        // so env.ts is evaluated on the FIRST incoming request — not at process start.
        // Re-throwing crashes the layout module mid-request and triggers the global error
        // boundary ("Something went wrong") even for the static home page.
        const message = e instanceof Error ? e.message : String(e);
        console.error(
            `[Env] CRITICAL: Environment validation failed — check Railway env vars.\n` +
            `Add missing variables in Railway → Variables tab, then redeploy.\n${message}`
        );

        // In production at runtime (not during next build), exit immediately so the
        // deploy shows a clear failure rather than partially booting and failing later.
        if (
            process.env.NODE_ENV === "production" &&
            process.env.NEXT_PHASE !== "phase-production-build"
        ) {
            // Log every validation error before exiting — Railway shows all issues in one deploy.
            process.exit(1);
        }

        // In dev/build: warn and continue so hot-reload still works.
        return process.env as unknown as z.infer<typeof envSchema>;
    }
})();


export function validateEnv() {
    if (process.env.SKIP_ENV_VALIDATION === "1") {
        logger.debug('[Env] Skipping environment validation during build ✓');
        return;
    }

    // These are the hard minimum required at runtime. Missing any will degrade
    // core functionality significantly. We WARN (not throw) so a misconfigured
    // deployment still serves pages and shows a readable error rather than a
    // blank "Something went wrong" screen caused by a module-level exception.
    const required = [
        'GEMINI_API_KEY',
        'DATABASE_URL',
        'NEXTAUTH_SECRET',
        'NEXTAUTH_URL',
        'LIVEKIT_URL',
        'LIVEKIT_API_KEY',
        'LIVEKIT_API_SECRET',
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        logger.warn(`[Env] CRITICAL: Missing required environment variables: ${missing.join(', ')}. Some features will be broken.`);
    } else {
        logger.debug('[Env] All required environment variables present ✓');
    }

    // Log which optional integrations are disabled so operators know at startup
    const optionalIntegrations: Record<string, string> = {
        PAGESPEED_API_KEY: "PageSpeed/CrUX data",
        GOOGLE_SAFE_BROWSING_KEY: "Security audit",
        GOOGLE_KG_API_KEY: "Knowledge Graph AEO checks",
        UNSPLASH_ACCESS_KEY: "Blog hero images",
        GITHUB_TOKEN: "Auto-fix GitHub PRs",
        MOZ_API_TOKEN: "Backlink data (Moz)",
        PERPLEXITY_API_KEY: "Perplexity citation checks",
        OPENAI_API_KEY: "ChatGPT citation checks",
        ANTHROPIC_API_KEY: "Claude citation checks",
        INNGEST_EVENT_KEY: "Background jobs (Inngest)",
        UPSTASH_REDIS_REST_URL: "Upstash Redis rate limiting",
        GOOGLE_CLIENT_EMAIL: "Google Service Account (GSC indexing)",
        SERPAPI_KEY: "SERP data (SerpAPI)",
        BROWSERLESS_URL: "JS-rendered crawling (Browserless)",
    };

    const disabledFeatures = Object.entries(optionalIntegrations)
        .filter(([key]) => !process.env[key])
        .map(([, label]) => label);

    if (disabledFeatures.length > 0) {
        logger.warn(`[Env] ${disabledFeatures.length} optional integrations disabled: ${disabledFeatures.join(', ')}`);
    }
}

// Validate Stripe price IDs are present in production (non-fatal warning in dev).
// Import assertStripePriceIds from stripe/webhook is circular risk — inline the check here.
//
// Guard with NEXT_PHASE !== "phase-production-build" so this only fires once at
// server startup, not for every one of the 72 static pages generated during
// `next build` (which imports env.ts in each worker process).
if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
) {
    const missing: string[] = []
    if (!process.env.STRIPE_PRO_PRICE_ID)     missing.push("STRIPE_PRO_PRICE_ID")
    if (!process.env.STRIPE_STARTER_PRICE_ID) missing.push("STRIPE_STARTER_PRICE_ID")
    if (!process.env.STRIPE_AGENCY_PRICE_ID)  missing.push("STRIPE_AGENCY_PRICE_ID")
    if (!process.env.STRIPE_CREDIT_PACK_PRICE_ID) missing.push("STRIPE_CREDIT_PACK_PRICE_ID")
    if (!process.env.UPSTASH_REDIS_REST_URL)  missing.push("UPSTASH_REDIS_REST_URL")
    if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN")
    if (missing.length > 0) {
        logger.warn(
            `[OptiAISEO Startup] Missing Stripe env vars: ${missing.join(", ")}. ` +
            "Paid-plan webhooks will silently fail. Set these before going live."
        )
    }
}
