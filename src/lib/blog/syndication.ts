/**
 * Shared syndication contract for CMS publishing clients.
 *
 * All CMS clients (WordPress, Ghost, Hashnode) follow the same lifecycle:
 *   validate → resolve existing → resolve tags → resolve media → create/update → return
 *
 * Idempotency is enforced via deterministic slugs — the same draft always
 * produces the same slug, preventing duplicate publications on retry.
 */

import type { BlogPostDraft } from "./index";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Deterministic identity for idempotent syndication operations */
export interface SyndicationIdentity {
    /** Unique operation ID (e.g. "wp:myblog.com:best-seo-tools-2026") */
    operationId: string;
    /** Deterministic slug derived from BlogPostDraft */
    slug: string;
}

export type SyndicationOutcome = "created" | "already_exists" | "failed";

export interface SyndicationResult {
    success: boolean;
    outcome: SyndicationOutcome;
    postUrl?: string;
    postId?: string | number;
    error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives a deterministic slug from a draft.
 * Same draft title → same slug → idempotent publish.
 */
export function deriveSyndicationSlug(draft: BlogPostDraft): string {
    // Prefer the draft's own slug if it looks clean (not a placeholder)
    if (draft.slug && !draft.slug.startsWith("generating-")) {
        return normalizeSyndicationSlug(draft.slug);
    }

    // Fall back to title-derived slug
    return normalizeSyndicationSlug(draft.title);
}

function normalizeSyndicationSlug(input: string): string {
    return input
        .toLowerCase()
        .replace(/['']/g, "")              // smart quotes
        .replace(/[^a-z0-9]+/g, "-")       // non-alphanumeric → hyphens
        .replace(/^-+|-+$/g, "")           // trim leading/trailing hyphens
        .slice(0, 200);                    // reasonable length cap
}

/**
 * Validates a draft is safe to publish.
 * Must pass before any CMS API call.
 */
export function validateDraftForSyndication(draft: BlogPostDraft): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!draft.title || typeof draft.title !== "string" || draft.title.trim().length === 0) {
        errors.push("Draft title is empty or missing");
    }

    if (!draft.content || typeof draft.content !== "string" || draft.content.trim().length < 50) {
        errors.push("Draft content is empty or too short (min 50 chars)");
    }

    const slug = deriveSyndicationSlug(draft);
    if (!slug || slug.length < 3) {
        errors.push("Cannot derive a valid slug from draft title");
    }

    if (draft.title?.includes("undefined") || draft.content?.includes("undefined")) {
        errors.push("Draft contains 'undefined' — likely a template error");
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Deduplicates and normalizes keywords for tag creation.
 */
export function normalizeKeywordsForTags(keywords: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const kw of keywords) {
        const normalized = kw.trim().toLowerCase();
        if (normalized.length > 0 && normalized.length <= 100 && !seen.has(normalized)) {
            seen.add(normalized);
            result.push(kw.trim()); // preserve original casing
        }
    }

    return result.slice(0, 10); // cap at 10 tags
}

/**
 * Sanitizes error messages to strip credentials/tokens.
 * Call this before returning any error to the caller.
 */
export function sanitizeError(error: unknown, sensitivePatterns: string[]): string {
    let message = error instanceof Error ? error.message : String(error);

    for (const pattern of sensitivePatterns) {
        if (!pattern || pattern.length < 4) continue; // skip very short patterns
        // Replace the sensitive value with a redacted placeholder
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        message = message.replace(new RegExp(escaped, "g"), "[REDACTED]");
    }

    // Also strip any Basic auth headers that may leak
    message = message.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [REDACTED]");
    // Strip Bearer tokens
    message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");

    return message;
}

/**
 * Builds a SyndicationIdentity from a draft and CMS target.
 */
export function buildSyndicationIdentity(
    cmsType: "wordpress" | "ghost" | "hashnode",
    targetHost: string,
    draft: BlogPostDraft,
): SyndicationIdentity {
    const slug = deriveSyndicationSlug(draft);
    const cleanHost = targetHost.replace(/^https?:\/\//, "").replace(/\/$/, "");

    return {
        operationId: `${cmsType}:${cleanHost}:${slug}`,
        slug,
    };
}

/**
 * Logs a syndication operation with consistent structure.
 */
export function logSyndication(
    cms: string,
    action: string,
    details: Record<string, unknown>,
): void {
    logger.info(`[Syndication/${cms}] ${action}`, details);
}
