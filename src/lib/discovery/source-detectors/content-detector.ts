/**
 * Phase D.1 — Content Source Detector
 *
 * Analyzes published blog content for staleness, thin content, and missing
 * metadata. Triggered alongside audit detection via `audit.completed`.
 *
 * Read-only — no mutations, no proposals.
 */

import { createHash } from "node:crypto";
import type { RawDiscoverySignal, DiscoveryEvidence } from "../types";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ── Thresholds ──────────────────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS = 180;
const THIN_CONTENT_WORD_COUNT = 300;
const VERY_THIN_WORD_COUNT = 100;

// ── Fingerprint ─────────────────────────────────────────────────────────────

function createFingerprint(siteId: string, category: string, resourceType: string, resourceId: string): string {
  const canonical = [siteId, category, resourceType, resourceId].join(":");
  return createHash("sha256").update(canonical).digest("hex");
}

// ── Word Count ──────────────────────────────────────────────────────────────

function estimateWordCount(content: string): number {
  if (!content) return 0;
  // Strip HTML tags for more accurate count
  const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Detects content-quality discovery signals from published blogs.
 * Checks: staleness, thin content, missing meta descriptions.
 */
export async function detectContentSignals(
  siteId: string,
  sourceRunId: string,
): Promise<RawDiscoverySignal[]> {
  logger.info("[ContentDetector] Starting content detection", { siteId });

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, domain: true },
  });

  if (!site) {
    logger.warn("[ContentDetector] Site not found", { siteId });
    return [];
  }

  const blogs = await prisma.blog.findMany({
    where: { siteId, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      title: true,
      content: true,
      metaDescription: true,
      targetKeywords: true,
      updatedAt: true,
    },
    take: 500, // Safety cap
  });

  const now = new Date();
  const signals: RawDiscoverySignal[] = [];

  for (const blog of blogs) {
    const canonicalUrl = `/blog/${blog.slug}`;
    const primaryKeyword = blog.targetKeywords?.[0] || blog.title;
    const wordCount = estimateWordCount(blog.content);
    const daysOld = (now.getTime() - new Date(blog.updatedAt).getTime()) / (1000 * 60 * 60 * 24);

    // ── Check STALE (> 180 days old) ──────────────────────────────────────
    if (daysOld > STALE_THRESHOLD_DAYS) {
      const confidence = daysOld > 365 ? 0.9 : daysOld > 270 ? 0.75 : 0.55;

      signals.push({
        siteId,
        source: "CONTENT",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "STALE", "PAGE", canonicalUrl),
        category: "STALE",
        suggestedAction: "REFRESH_CONTENT",
        resourceType: "PAGE",
        resourceId: canonicalUrl,
        url: canonicalUrl,
        keyword: primaryKeyword,
        confidence,
        evidence: [
          {
            sourceType: "CONTENT",
            metric: "daysOld",
            value: String(Math.round(daysOld)),
            observedAt: now,
          },
          {
            sourceType: "CONTENT",
            metric: "lastUpdated",
            value: blog.updatedAt.toISOString(),
            observedAt: now,
          },
        ],
        metadata: { blogId: blog.id, wordCount, daysOld: Math.round(daysOld) },
      });
    }

    // ── Check THIN CONTENT (< 300 words) ──────────────────────────────────
    if (wordCount < THIN_CONTENT_WORD_COUNT && wordCount > 0) {
      const confidence = wordCount < VERY_THIN_WORD_COUNT ? 0.85 : 0.65;

      signals.push({
        siteId,
        source: "CONTENT",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "STALE", "PAGE", `${canonicalUrl}:thin`),
        category: "STALE",
        suggestedAction: "OPTIMIZE_CONTENT_DEPTH",
        resourceType: "PAGE",
        resourceId: canonicalUrl,
        url: canonicalUrl,
        keyword: primaryKeyword,
        confidence,
        evidence: [
          {
            sourceType: "CONTENT",
            metric: "wordCount",
            value: String(wordCount),
            observedAt: now,
          },
        ],
        metadata: { blogId: blog.id, wordCount },
      });
    }

    // ── Check MISSING META DESCRIPTION ────────────────────────────────────
    if (!blog.metaDescription || blog.metaDescription.trim().length === 0) {
      signals.push({
        siteId,
        source: "CONTENT",
        sourceRunId,
        fingerprint: createFingerprint(siteId, "QUICK_WIN", "PAGE", `${canonicalUrl}:meta`),
        category: "QUICK_WIN",
        suggestedAction: "OPTIMIZE_TITLE",
        resourceType: "PAGE",
        resourceId: canonicalUrl,
        url: canonicalUrl,
        keyword: primaryKeyword,
        confidence: 0.95, // Very high — missing meta is objectively detectable
        evidence: [
          {
            sourceType: "CONTENT",
            metric: "metaDescription",
            value: "MISSING",
            observedAt: now,
          },
        ],
        metadata: { blogId: blog.id },
      });
    }
  }

  logger.info("[ContentDetector] Detection complete", {
    siteId,
    blogsProcessed: blogs.length,
    signalsProduced: signals.length,
  });

  return signals;
}
