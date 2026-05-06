"use server";

import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit/check";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { callGeminiJson } from "@/lib/gemini/client";
import crypto from "crypto";

export interface ServiceEntity {
    name: string;
    fullName: string;
    intentType: "transactional" | "informational" | "navigational";
    isUnique: boolean;
    clusterParent?: string;
    variations: string[];
    suggestedSlug: string;
}

function hashInput(coreServices: string, niche: string, location: string): string {
    return crypto
        .createHash("sha256")
        .update(`${coreServices}||${niche}||${location}`)
        .digest("hex")
        .slice(0, 16);
}

function deriveSlug(entityName: string, location?: string): string {
    const base = location ? `${entityName} ${location}` : entityName;
    return base
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

export async function discoverServiceEntities(siteId: string): Promise<{
    success: boolean;
    entities?: ServiceEntity[];
    cached?: boolean;
    error?: string;
}> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return { success: false, error: "User not found" };

    const limited = await rateLimit("auditRun", user.id);
    if (limited) {
        const body = await limited.json();
        return { success: false, error: body.error ?? "Too many requests. Please wait." };
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: {
            domain: true,
            coreServices: true,
            niche: true,
            location: true,
            targetCustomer: true,
        },
    });

    if (!site) return { success: false, error: "Site not found" };
    if (!site.coreServices) return { success: false, error: "Add your core services first in site settings." };

    const inputHash = hashInput(
        site.coreServices,
        site.niche ?? "",
        site.location ?? ""
    );

    const cached = await (prisma as any).serviceEntityCache.findFirst({
        where: { siteId, inputHash },
        orderBy: { createdAt: "desc" },
    });

    if (cached) {
        return { success: true, entities: cached.entities as ServiceEntity[], cached: true };
    }

    const prompt = `You are an expert in Service Entity Optimization for SEO and AI search engines.

Given this business profile, identify and validate all distinct service entities.

Business Profile:
- Domain: ${site.domain}
- Niche: ${site.niche ?? "Not specified"}
- Location: ${site.location ?? "Not specified"}
- Core Services: ${site.coreServices}
- Target Customer: ${site.targetCustomer ?? "Not specified"}

Rules:
1. Each entity = one specific service that could have its own search results page
2. Include location in fullName if the business serves a specific area
3. Mark isUnique: false if two entries describe the same service differently
4. Keep names concise and searchable (under 60 characters)
5. Generate real search query variations people actually type
6. Return a maximum of 12 entities

Return ONLY valid JSON:
{
  "entities": [
    {
      "name": "Service name without location",
      "fullName": "Service name + location if local",
      "intentType": "transactional",
      "isUnique": true,
      "clusterParent": null,
      "variations": ["how users search for this", "another variation"],
      "suggestedSlug": "url-slug-for-this-page"
    }
  ]
}`;

    try {
        const result = await callGeminiJson<{ entities: ServiceEntity[] }>(
            prompt,
            { maxOutputTokens: 2048, temperature: 0.2 }
        );

        const entities: ServiceEntity[] = (result.entities ?? []).map((e) => ({
            ...e,
            suggestedSlug: deriveSlug(e.name, site.location ?? undefined),
        }));

        await (prisma as any).serviceEntityCache.create({
            data: {
                siteId,
                inputHash,
                entities,
            },
        });

        return { success: true, entities, cached: false };
    } catch (err: unknown) {
        logger.error("[EntityDiscovery] Failed:", { error: (err as Error)?.message ?? String(err) });
        return { success: false, error: "Entity discovery failed. Check your services list." };
    }
}

export async function generateEntityPageForSite(
    siteId: string,
    entity: ServiceEntity
): Promise<{ success: boolean; blogId?: string; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return { success: false, error: "User not found" };

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: {
            id: true,
            domain: true,
            coreServices: true,
            authorName: true,
            niche: true,
            location: true,
            targetCustomer: true,
        },
    });

    if (!site) return { success: false, error: "Site not found" };

    const slug = deriveSlug(entity.name, site.location ?? undefined);

    const existing = await prisma.blog.findFirst({
        where: { siteId, slug },
    });

    if (existing) return { success: true, blogId: existing.id };

    try {
        const relatedEntityPages = await prisma.blog.findMany({
            where: { siteId, pipelineType: "ENTITY_PAGE" },
            select: { slug: true, title: true, targetKeywords: true },
            take: 20,
        });

        const relatedEntities: ServiceEntity[] = relatedEntityPages.map((p: { title: string; slug: string; targetKeywords: string[] }) => ({
            name: p.title,
            fullName: p.title,
            intentType: "transactional" as const,
            isUnique: true,
            variations: p.targetKeywords,
            suggestedSlug: p.slug,
        }));

        const { generateEntityPage, assembleEntityPageHtml } = await import("@/lib/blog/entityPage");
        const page = await generateEntityPage(entity, site, relatedEntities);

        const { sanitizeHtml, sanitizeSchemaMarkup } = await import("@/lib/sanitize-html");
        const rawHtml = assembleEntityPageHtml(page);

        const blog = await prisma.blog.create({
            data: {
                siteId: site.id,
                pipelineType: "ENTITY_PAGE",
                title: page.title,
                slug,
                content: sanitizeHtml(rawHtml),
                metaDescription: page.metaDescription,
                targetKeywords: entity.variations,
                schemaMarkup: sanitizeSchemaMarkup(
                    `<script type="application/ld+json">\n${page.schema}\n</script>`
                ),
                status: "DRAFT",
            },
        });

        return { success: true, blogId: blog.id };
    } catch (err: unknown) {
        logger.error("[EntityDiscovery] Page generation failed:", { error: (err as Error)?.message ?? String(err) });
        return { success: false, error: "Failed to generate entity page. Please try again." };
    }
}

export async function generateEntityPagesBatch(
    siteId: string,
    entities: ServiceEntity[]
): Promise<{ success: boolean; results?: { entity: string; blogId?: string; skipped?: boolean; error?: string }[]; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return { success: false, error: "User not found" };

    const limited = await rateLimit("blogGenerate", user.id);
    if (limited) {
        const body = await limited.json();
        return { success: false, error: body.error ?? "Too many requests. Please wait." };
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: {
            id: true,
            domain: true,
            coreServices: true,
            authorName: true,
            niche: true,
            location: true,
            targetCustomer: true,
        },
    });

    if (!site) return { success: false, error: "Site not found" };

    const slugs = entities.map((e) => deriveSlug(e.name, site.location ?? undefined));

    const existingSlugs = await prisma.blog.findMany({
        where: { siteId, slug: { in: slugs } },
        select: { slug: true, id: true },
    });

    const existingMap = new Map(existingSlugs.map((b: { slug: string; id: string }) => [b.slug, b.id]));

    const toGenerate = entities.filter((e, i) => !existingMap.has(slugs[i]));
    const skipped = entities
        .filter((e, i) => existingMap.has(slugs[i]))
        .map((e) => ({ entity: e.name, skipped: true, blogId: existingMap.get(deriveSlug(e.name, site.location ?? undefined)) }));

    if (toGenerate.length === 0) {
        return { success: true, results: skipped };
    }

    try {
        const relatedEntityPages = await prisma.blog.findMany({
            where: { siteId, pipelineType: "ENTITY_PAGE" },
            select: { slug: true, title: true, targetKeywords: true },
            take: 20,
        });

        const relatedEntities: ServiceEntity[] = relatedEntityPages.map((p: { title: string; slug: string; targetKeywords: string[] }) => ({
            name: p.title,
            fullName: p.title,
            intentType: "transactional" as const,
            isUnique: true,
            variations: p.targetKeywords,
            suggestedSlug: p.slug,
        }));

        const { generateEntityPage, assembleEntityPageHtml } = await import("@/lib/blog/entityPage");
        const pages = await Promise.all(
            toGenerate.map((e) => generateEntityPage(e, site, relatedEntities))
        );

        const { sanitizeHtml, sanitizeSchemaMarkup } = await import("@/lib/sanitize-html");

        const created = await prisma.$transaction(
            pages.map((page: any, i: number) => {
                const slug = deriveSlug(toGenerate[i].name, site.location ?? undefined);
                return prisma.blog.create({
                    data: {
                        siteId: site.id,
                        pipelineType: "ENTITY_PAGE",
                        title: page.title,
                        slug,
                        content: sanitizeHtml(assembleEntityPageHtml(page)),
                        metaDescription: page.metaDescription,
                        targetKeywords: toGenerate[i].variations,
                        schemaMarkup: sanitizeSchemaMarkup(
                            `<script type="application/ld+json">\n${page.schema}\n</script>`
                        ),
                        status: "DRAFT",
                    },
                });
            })
        );

        const generatedResults = created.map((blog: any, i: number) => ({
            entity: toGenerate[i].name,
            blogId: blog.id,
        }));

        return { success: true, results: [...skipped, ...generatedResults] };
    } catch (err: unknown) {
        logger.error("[EntityDiscovery] Batch generation failed:", { error: (err as Error)?.message ?? String(err) });
        return { success: false, error: "Batch page generation failed. Please try again." };
    }
}

export async function saveEntityFields(
    siteId: string,
    fields: { niche?: string; location?: string; targetCustomer?: string; coreServices?: string }
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return { success: false, error: "User not found" };

    try {
        await (prisma.site.update as any)({
            where: { id: siteId, userId: user.id },
            data: {
                niche: fields.niche?.trim() || null,
                location: fields.location?.trim() || null,
                targetCustomer: fields.targetCustomer?.trim() || null,
                ...(fields.coreServices !== undefined
                    ? { coreServices: fields.coreServices.trim() || null }
                    : {}),
            },
        });

        return { success: true };
    } catch (err: unknown) {
        logger.error("[EntityDiscovery] saveEntityFields failed:", { error: (err as Error)?.message ?? String(err) });
        return { success: false, error: "Failed to save entity fields." };
    }
}