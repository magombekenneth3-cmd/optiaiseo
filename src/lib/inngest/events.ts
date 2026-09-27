/**
 * Typed Inngest event schema for the blog pipeline.
 *
 * Every event the blog pipeline can SEND or LISTEN FOR must be declared here.
 * This is the single source of truth. No event string should appear elsewhere.
 *
 * Inngest's `inngest/function.failed` is an internal system event. It is NOT
 * a valid trigger for application functions — any attempt to listen for it
 * causes "Event not found in triggers" errors. Application failure paths
 * must use `blog/generation.failed` instead.
 */

// ─── Blog Generation Events ─────────────────────────────────────────────────

export interface BlogGenerateEvent {
    name: "blog.generate";
    data: {
        siteId: string;
        pipelineType: string;
        keyword?: string;
        competitorDomain?: string;
        searchVolume?: number;
        difficulty?: number;
        blogId?: string;
        userId?: string;
        authorName?: string;
        authorRole?: string;
        authorBio?: string;
        realExperience?: string;
        realNumbers?: string;
        localContext?: string;
        serpSignal?: Record<string, unknown>;
        gscEvidence?: Record<string, unknown>;
    };
}

export interface BlogGenerationFailedEvent {
    name: "blog/generation.failed";
    data: {
        /** The Inngest run ID for correlation. */
        runId: string;
        /** The blog row ID in Postgres. May be absent when failure occurs before DB insert. */
        blogId: string | null;
        /** The site that triggered this generation run. */
        siteId: string;
        /** The user who owns the site. */
        userId: string | null;
        /** Which pipeline stage the failure occurred in. */
        stage: string;
        /**
         * Structured error classification.
         * - CONTENT_FAILURE   → the content itself was bad (placeholder, fabrication)
         * - PROVIDER_FAILURE  → an external AI/API dependency failed
         * - SYSTEM_FAILURE    → internal infrastructure failure (DB, Redis, config)
         * - RATE_LIMIT        → per-user or per-site rate limit exceeded
         * - VALIDATION_ERROR  → input data was invalid (missing keyword, no author, etc.)
         */
        errorCode:
            | "CONTENT_FAILURE"
            | "PROVIDER_FAILURE"
            | "SYSTEM_FAILURE"
            | "RATE_LIMIT"
            | "VALIDATION_ERROR"
            | "UNKNOWN";
        /** Human-readable description of the failure, safe to surface in logs. */
        errorMessage: string;
        /** True when a retry may succeed (e.g. transient 503). False for hard failures. */
        retryable: boolean;
        /** ISO timestamp of the failure. */
        failedAt: string;
    };
}

export interface BlogPublishedEvent {
    name: "blog.published";
    data: {
        siteId: string;
        blogId: string;
        blogUrl?: string;
        keyword?: string;
        targetKeywords?: string[];
        publishedAt?: string;
    };
}

// ─── Union type used by the Inngest client for type inference ─────────────────

export type BlogPipelineEvents =
    | BlogGenerateEvent
    | BlogGenerationFailedEvent
    | BlogPublishedEvent;
