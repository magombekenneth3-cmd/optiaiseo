/**
 * Grounded Prompt Context Builder
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls live data from the DB for a specific site and formats it as a context
 * block that can be prepended to any LLM prompt. This makes every AI call
 * site-specific instead of generic.
 *
 * The "grounding" pattern is the single highest-leverage change for content
 * quality — Gemini cannot guess your user's Uganda location, their verified
 * pricing facts, or their current keyword positions from a template string.
 * This module provides that data every time.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface GroundedSiteContext {
    /** Raw context block — prepend to any LLM prompt */
    contextBlock: string;
    /** Structured data for programmatic use */
    data: {
        domain: string;
        coreServices: string | null;
        location: string | null;
        authorName: string | null;
        authorRole: string | null;
        authorBio: string | null;
        realExperience: string | null;
        brandFacts: Array<{ factType: string; value: string }>;
        topKeywords: Array<{ keyword: string; position: number }>;
        auditScore: number | null;
        competitorDomains: string[];
    };
}

/**
 * Build a grounded context block for a site from live DB data.
 * Returns null on DB errors to allow callers to degrade gracefully.
 *
 * @example
 * const ctx = await buildGroundedContext(siteId);
 * const prompt = `${ctx?.contextBlock ?? ""}\n\nWrite a blog about ${keyword}.`;
 */
export async function buildGroundedContext(siteId: string): Promise<GroundedSiteContext | null> {
    try {
        const [site, brandFacts, topKeywords, latestAudit, competitors] = await Promise.all([
            prisma.site.findUnique({
                where: { id: siteId },
                select: {
                    domain: true,
                    coreServices: true,
                    location: true,
                    authorName: true,
                    authorRole: true,
                    authorBio: true,
                    realExperience: true,
                    realNumbers: true,
                    localContext: true,
                    niche: true,
                    targetCustomer: true,
                },
            }),
            prisma.brandFact.findMany({
                where: { siteId, verified: true },
                take: 10,
                select: { factType: true, value: true },
            }),
            prisma.rankSnapshot.findMany({
                where: { siteId, device: "desktop" },
                orderBy: { recordedAt: "desc" },
                take: 20,
                distinct: ["keyword"],
                select: { keyword: true, position: true },
            }),
            prisma.audit.findFirst({
                where: { siteId },
                orderBy: { runTimestamp: "desc" },
                select: { categoryScores: true },
            }),
            prisma.competitor.findMany({
                where: { siteId },
                take: 10,
                select: { domain: true },
            }),
        ]);

        if (!site) {
            logger.warn("[GroundedContext] Site not found", { siteId });
            return null;
        }

        // Parse audit score if available
        let auditScore: number | null = null;
        if (latestAudit?.categoryScores) {
            try {
                const scores = latestAudit.categoryScores as Record<string, number>;
                const values = Object.values(scores).filter((v) => typeof v === "number");
                if (values.length > 0) {
                    auditScore = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
                }
            } catch {
                // ignore parse error
            }
        }

        // Sort keywords by position (best ranks first)
        const sortedKeywords = [...topKeywords].sort((a, b) => a.position - b.position);

        // Build the structured data object
        const data: GroundedSiteContext["data"] = {
            domain: site.domain,
            coreServices: site.coreServices ?? null,
            location: site.location ?? null,
            authorName: site.authorName ?? null,
            authorRole: site.authorRole ?? null,
            authorBio: site.authorBio ?? null,
            realExperience: site.realExperience ?? null,
            brandFacts: brandFacts.map((f) => ({ factType: f.factType, value: f.value })),
            topKeywords: sortedKeywords.map((k) => ({ keyword: k.keyword, position: k.position })),
            auditScore,
            competitorDomains: competitors.map((c) => c.domain),
        };

        // ── Build the context block string ─────────────────────────────────────
        const lines: string[] = [
            "=== SITE CONTEXT (use this to make your response specific and accurate) ===",
            `Domain: ${site.domain}`,
        ];

        if (site.coreServices) lines.push(`Core Services: ${site.coreServices}`);
        if (site.location) lines.push(`Location / Market: ${site.location}`);
        if (site.niche) lines.push(`Niche: ${site.niche}`);
        if (site.targetCustomer) lines.push(`Target Customer: ${site.targetCustomer}`);

        if (site.authorName) {
            lines.push(`Author: ${site.authorName}${site.authorRole ? ` — ${site.authorRole}` : ""}`);
        }
        if (site.authorBio) lines.push(`Author bio: ${site.authorBio}`);
        if (site.realExperience) lines.push(`Real experience: ${site.realExperience}`);
        if (site.realNumbers) lines.push(`Real numbers / data: ${site.realNumbers}`);
        if (site.localContext) lines.push(`Local context: ${site.localContext}`);

        if (brandFacts.length > 0) {
            lines.push("\nVERIFIED BRAND FACTS (treat these as authoritative, do not contradict them):");
            for (const f of brandFacts) {
                lines.push(`  - ${f.factType}: ${f.value}`);
            }
        }

        if (sortedKeywords.length > 0) {
            lines.push("\nCURRENT SEO POSITIONS (from Google Search Console):");
            for (const k of sortedKeywords.slice(0, 10)) {
                const label = k.position <= 3 ? " [top 3]" : k.position <= 10 ? " [page 1]" : k.position <= 20 ? " [page 2]" : " [page 3+]";
                lines.push(`  - "${k.keyword}": position ${k.position}${label}`);
            }
        }

        if (auditScore !== null) {
            lines.push(`\nSEO HEALTH: Overall audit score ${auditScore}/100`);
        }

        if (competitors.length > 0) {
            lines.push(`\nKNOWN COMPETITORS: ${competitors.map((c) => c.domain).join(", ")}`);
        }

        lines.push("=== END SITE CONTEXT ===");

        return { contextBlock: lines.join("\n"), data };
    } catch (err: unknown) {
        logger.error("[GroundedContext] Failed to build context", {
            siteId,
            error: (err as Error)?.message ?? String(err),
        });
        return null;
    }
}

/**
 * Returns just the context block string (or empty string on failure).
 * Convenience wrapper for use directly in prompt templates.
 */
export async function getGroundedContextBlock(siteId: string): Promise<string> {
    const result = await buildGroundedContext(siteId);
    return result?.contextBlock ?? "";
}
