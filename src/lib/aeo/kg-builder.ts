import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { BRAND } from "@/lib/constants/brand";

/**
 * Builds a comprehensive Knowledge Graph (JSON-LD) for a site by aggregating
 * data from Site, Blog, AeoReport, and Audit models.
 *
 * Entity-first update: each coreService is structured as a typed Service node
 * with an @id, provider backlink, and optional areaServed when location is set.
 */
export async function buildKnowledgeGraph(domain: string) {
    const cacheKey = `kg:feed:${domain}`;

    try {
        const cached = await redis.get<string>(cacheKey);
        if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
     
     
    } catch (e: unknown) {
        logger.warn("[KG-Builder] Redis cache hit failed:", { error: (e as Error).message || e });
    }

    const site = await prisma.site.findFirst({
        where: { domain },
        include: {
            brandFacts: {
                where: { verified: true },
                take: 20
            },
            blogs: {
                where: { status: "PUBLISHED" },
                orderBy: { publishedAt: "desc" },
                take: 10
            },
            aeoReports: {
                orderBy: { createdAt: "desc" },
                take: 1
            },
            audits: {
                orderBy: { runTimestamp: "desc" },
                take: 1
            }
        }
    });

    if (!site) return null;

    const latestReport = site.aeoReports?.[0];
    const latestAudit = site.audits?.[0];

    // Derive a human-readable organization name:
    // 1. Try a verified brand fact with label "name"
    // 2. Try the first item from coreServices
    // 3. Fall back to the raw domain (no uppercasing)
     
    const nameFact = site.brandFacts?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) => f.factType?.toLowerCase() === "name" || f.label?.toLowerCase() === "name"
    );
    const organizationName =
        nameFact?.value ||
        site.coreServices?.split(",")[0]?.trim() ||
        site.domain;

    // ── Build structured Service entity nodes (entity-first) ────────────────
    // Replace the flat coreServices string with typed Service nodes.
    // Each service gets its own @id so AI engines parse it as a distinct entity,
    // and the Organization links to them via hasOfferCatalog.
    const siteLocation = (site as { location?: string | null }).location;
    const serviceEntities = (site.coreServices
        ?.split(",")
        .map((s: string) => s.trim())
        .filter(Boolean) ?? []).map((service: string, i: number) => ({
            "@type": "Service",
            "@id": `https://${site.domain}/#service-${i}`,
            "name": siteLocation ? `${service} in ${siteLocation}` : service,
            "serviceType": service,
            "provider": {
                "@id": `https://${site.domain}/#organization`,
            },
            ...(siteLocation
                ? { "areaServed": { "@type": "Place", "name": siteLocation } }
                : {}),
        }));

    // ── Core Organization node + Service child nodes in @graph ───────────────
    const kg = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": `https://${site.domain}/#organization`,
                "url": `https://${site.domain}`,
                "name": organizationName,
                "description": site.coreServices || `Leading provider of digital solutions on ${site.domain}.`,
                "foundingDate": site.createdAt,
                // Link Organization to the service catalog for rich AI parsing
                ...(serviceEntities.length > 0
                    ? {
                        "hasOfferCatalog": {
                            "@type": "OfferCatalog",
                            "name": "Services",
                            "itemListElement": serviceEntities.map((s) => ({
                                "@type": "Offer",
                                "itemOffered": { "@id": s["@id"] },
                            })),
                        },
                      }
                    : {}),
                "knowsAbout": [
                    "AEO",
                    "SEO",
                    "Generative Search Optimization",
                    ...(site.coreServices?.split(",").map((s: string) => s.trim()) || []),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ...(site.brandFacts?.map((f: any) => f.value) || []),
                ],
                "measurement": [
                    {
                        "@type": "PropertyValue",
                        "name": "Generative Share of Voice",
                        "value": latestReport?.generativeShareOfVoice || 0,
                        "unitText": "PERCENT"
                    },
                    {
                        "@type": "PropertyValue",
                        "name": "AEO Optimization Grade",
                        "value": latestReport?.grade || "N/A"
                    }
                ],
                "verifiedMetrics": {
                    "aeoScore": latestReport?.score || 0,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    "technicalScore": latestAudit?.categoryScores ? (latestAudit.categoryScores as any).overall || 0 : 0,
                    "lastVerified": latestReport?.createdAt || site.updatedAt
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                "brandFacts": site.brandFacts.map((f: any) => ({
                    "@type": "PropertyValue",
                    "name": f.factType,
                    "value": f.value,
                    "isVerified": f.verified
                })),
                [`${BRAND.NAME}Certified`]: true,
                "kgIdentifier": `kg-${site.domain.replace(/\./g, "-")}`
            },
            // Service entity nodes — each a distinct resolvable entity in the graph
            ...serviceEntities,
            // Published blog posts as BlogPosting nodes
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...site.blogs.map((blog: any) => ({
                "@type": "BlogPosting",
                "headline": blog.title,
                "url": `https://${site.domain}/blog/${blog.slug}`,
                "datePublished": blog.publishedAt,
                "keywords": blog.targetKeywords,
                "publisher": { "@id": `https://${site.domain}/#organization` },
            })),
        ]
    };

    try {
        await redis.setex(cacheKey, 3600, JSON.stringify(kg)); // Cache for 1 hour
     
    } catch (e: unknown) {
        logger.warn("[KG-Builder] Redis cache set failed:", { error: (e as Error).message || e });
    }

    return kg;
}
