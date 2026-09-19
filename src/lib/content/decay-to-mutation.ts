/**
 * Decay → Mutation Bridge
 *
 * Reads blogs where `needsRefresh = true` and creates a `PROPOSED`
 * `BLOG_REFRESH` MutationOperation for each one via the standard
 * `createOperation` lifecycle (idempotency, risk assessment, kill-switch).
 *
 * Called by:
 *   - The decay-check cron (after `runDecayCheck` flags blogs)
 *   - The content-decay dashboard "Propose Refresh" action
 *
 * Invariants:
 *   - Never creates a duplicate operation (idempotency key guards this)
 *   - Respects REPORT_ONLY mode (createOperation enforces it)
 *   - BLOG_REFRESH only touches `needsRefresh` + `refreshRequestedAt` fields,
 *     so risk is LOW and auto-approved by the mutation engine
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createOperation } from "@/lib/mutations/operation";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * System actor ID used when the cron triggers decay → mutation.
 * Human actors (dashboard "Propose Refresh") should pass their own userId.
 */
const DECAY_CRON_ACTOR = "system:decay-cron";

/**
 * Fields modified by a BLOG_REFRESH operation.
 * These are content-only fields — risk engine scores this LOW → auto-approved.
 */
const REFRESH_AFFECTED_FIELDS = ["needsRefresh", "refreshRequestedAt"];

// ── Types ────────────────────────────────────────────────────────────────────

export interface DecayMutationResult {
  /** Blog IDs for which a MutationOperation was created or already existed */
  proposed: string[];
  /** Blog IDs skipped due to a non-idempotency error */
  skipped: string[];
  /** Total blogs with needsRefresh=true that were processed */
  totalDecayed: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Proposes BLOG_REFRESH mutations for all decayed blogs in a site.
 *
 * @param siteId  - The site to process
 * @param actorId - Who is initiating (CRON → DECAY_CRON_ACTOR, user → userId)
 * @param actorType - "SYSTEM" for cron, "USER" for dashboard action
 * @param limit   - Max blogs to process in one call (default 25, safety cap)
 */
export async function proposeRefreshForDecayedBlogs(
  siteId: string,
  actorId: string = DECAY_CRON_ACTOR,
  actorType: "SYSTEM" | "USER" | "CRON" = "CRON",
  limit = 25,
): Promise<DecayMutationResult> {
  // 1. Fetch decayed blogs — only ones not already in the mutation queue
  const decayedBlogs = await prisma.blog.findMany({
    where: {
      siteId,
      needsRefresh: true,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      title: true,
      slug: true,
      version: true,
      targetKeywords: true,
    },
    take: limit,
    orderBy: { publishedAt: "asc" }, // oldest decay first
  });

  if (decayedBlogs.length === 0) {
    logger.info("[DecayMutation] No decayed blogs found", { siteId });
    return { proposed: [], skipped: [], totalDecayed: 0 };
  }

  logger.info("[DecayMutation] Proposing refresh mutations", {
    siteId,
    count: decayedBlogs.length,
  });

  // 2. Get site page count for blast radius calculation
  const sitePageCount = await prisma.blog.count({
    where: { siteId, status: "PUBLISHED" },
  });

  const proposed: string[] = [];
  const skipped: string[] = [];

  for (const blog of decayedBlogs) {
    try {
      const { operation } = await createOperation({
        siteId,
        actorId,
        actorType,
        mutationType: "BLOG_REFRESH",
        targetModel: "Blog",
        targetId: blog.id,
        expectedVersion: blog.version,
        mutationPayload: {
          // The actual mutation that will be applied when executed:
          // mark the blog as refresh-requested so the refresh pipeline
          // picks it up and generates a new draft.
          needsRefresh: false,        // clear the flag after execution
          refreshRequestedAt: new Date().toISOString(),
        },
        affectedFields: REFRESH_AFFECTED_FIELDS,
        sitePageCount,
        affectedUrlCount: 1,          // single blog URL
        idempotencyParams: {
          // Scoped to this blog's current version — prevents duplicate
          // proposals if the cron runs multiple times before execution
          blogVersion: String(blog.version),
        },
      });

      logger.info("[DecayMutation] Proposed refresh", {
        blogId: blog.id,
        slug: blog.slug,
        operationId: operation.id,
        status: operation.status,
      });

      proposed.push(blog.id);
    } catch (err: unknown) {
      const message = (err as Error)?.message ?? String(err);

      // MutationBlockedError = REPORT_ONLY mode — expected, not an error
      if (message.includes("REPORT_ONLY")) {
        logger.info("[DecayMutation] Site in REPORT_ONLY — skipping blog", {
          blogId: blog.id,
          siteId,
        });
        skipped.push(blog.id);
        break; // All future blogs will also be blocked — no point continuing
      }

      logger.warn("[DecayMutation] Failed to propose refresh for blog", {
        blogId: blog.id,
        siteId,
        error: message,
      });
      skipped.push(blog.id);
    }
  }

  logger.info("[DecayMutation] Batch complete", {
    siteId,
    proposed: proposed.length,
    skipped: skipped.length,
    totalDecayed: decayedBlogs.length,
  });

  return {
    proposed,
    skipped,
    totalDecayed: decayedBlogs.length,
  };
}

/**
 * Proposes a BLOG_REFRESH mutation for a single blog.
 * Used by the content-decay dashboard "Propose Refresh" button.
 *
 * @param blogId  - The specific blog to propose refresh for
 * @param userId  - The user requesting the refresh
 */
export async function proposeSingleBlogRefresh(
  blogId: string,
  userId: string,
): Promise<{ operationId: string; status: string; requiresApproval: boolean }> {
  const blog = await prisma.blog.findUniqueOrThrow({
    where: { id: blogId },
    select: {
      id: true,
      siteId: true,
      slug: true,
      version: true,
      status: true,
    },
  });

  const sitePageCount = await prisma.blog.count({
    where: { siteId: blog.siteId, status: "PUBLISHED" },
  });

  const { operation, requiresApproval } = await createOperation({
    siteId: blog.siteId,
    actorId: userId,
    actorType: "USER",
    mutationType: "BLOG_REFRESH",
    targetModel: "Blog",
    targetId: blog.id,
    expectedVersion: blog.version,
    mutationPayload: {
      needsRefresh: false,
      refreshRequestedAt: new Date().toISOString(),
    },
    affectedFields: REFRESH_AFFECTED_FIELDS,
    sitePageCount,
    affectedUrlCount: 1,
    idempotencyParams: {
      blogVersion: String(blog.version),
      initiator: "user-dashboard",
    },
  });

  return {
    operationId: operation.id,
    status: operation.status,
    requiresApproval,
  };
}
