import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { BRAND } from "@/lib/constants/brand";

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

    const nameFact = site.brandFacts?.find(
        (f: any) => f.factType?.toLowerCase() === "name" || f.label?.toLowerCase() === "name"
    );
    const organizationName =
        nameFact?.value ||
        site.coreServices?.split(",")[0]?.trim() ||
        site.domain;

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

    const authorEntity = {
        "@type": "Person",
        "@id": `https://${site.domain}/#author`,
        "name": `${organizationName} Editorial Team`,
        "jobTitle": "SEO & AEO Strategist",
        "worksFor": { "@id": `https://${site.domain}/#organization` },
        "sameAs": [
            `https://www.linkedin.com/company/${site.domain.split('.')[0]}`,
            `https://www.wikidata.org/wiki/Q123456`
        ]
    };

    const productEntity = {
        "@type": "Product",
        "@id": `https://${site.domain}/#product`,
        "name": site.coreServices?.split(",")[0]?.trim() || organizationName,
        "description": site.coreServices || `Professional solutions by ${organizationName}`,
        "brand": { "@id": `https://${site.domain}/#organization` },
        "offers": {
            "@type": "Offer",
            "price": "49.00",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock"
        }
    };

    const blogPostingNodes = site.blogs.map((blog: any) => ({
        "@type": "BlogPosting",
        "@id": `https://${site.domain}/blog/${blog.slug}#article`,
        "headline": blog.title,
        "url": `https://${site.domain}/blog/${blog.slug}`,
        "datePublished": blog.publishedAt,
        "dateModified": blog.updatedAt || blog.publishedAt,
        "keywords": blog.targetKeywords,
        "author": { "@id": `https://${site.domain}/#author` },
        "publisher": { "@id": `https://${site.domain}/#organization` },
        "mainEntityOfPage": `https://${site.domain}/blog/${blog.slug}`
    }));

    const faqNodes = site.blogs.filter((b: any) => b.metaDescription).slice(0, 5).map((blog: any) => ({
        "@type": "FAQPage",
        "@id": `https://${site.domain}/blog/${blog.slug}#faq`,
        "mainEntity": [
            {
                "@type": "Question",
                "name": `What is ${blog.title}?`,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": blog.metaDescription || blog.title
                }
            }
        ]
    }));

    const howToNodes = site.blogs.filter((b: any) => b.title.toLowerCase().includes("how")).slice(0, 3).map((blog: any) => ({
        "@type": "HowTo",
        "@id": `https://${site.domain}/blog/${blog.slug}#howto`,
        "name": blog.title,
        "step": [
            {
                "@type": "HowToStep",
                "position": 1,
                "name": "Initial Assessment",
                "text": `Review requirements for ${blog.title}`
            },
            {
                "@type": "HowToStep",
                "position": 2,
                "name": "Execution & Optimization",
                "text": `Apply AISEO recommendations for ${blog.title}`
            }
        ]
    }));

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
                "sameAs": [
                    `https://www.linkedin.com/company/${site.domain.split('.')[0]}`,
                    `https://crunchbase.com/organization/${site.domain.split('.')[0]}`,
                    `https://www.wikidata.org/wiki/Q123456`
                ],
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
                    "technicalScore": latestAudit?.categoryScores ? (latestAudit.categoryScores as any).overall || 0 : 0,
                    "lastVerified": latestReport?.createdAt || site.updatedAt
                },
                "brandFacts": site.brandFacts.map((f: any) => ({
                    "@type": "PropertyValue",
                    "name": f.factType,
                    "value": f.value,
                    "isVerified": f.verified
                })),
                [`${BRAND.NAME}Certified`]: true,
                "kgIdentifier": `kg-${site.domain.replace(/\./g, "-")}`
            },
            authorEntity,
            productEntity,
            ...serviceEntities,
            ...blogPostingNodes,
            ...faqNodes,
            ...howToNodes,
        ]
    };

    try {
        await redis.setex(cacheKey, 3600, JSON.stringify(kg));
    } catch (e: unknown) {
        logger.warn("[KG-Builder] Redis cache set failed:", { error: (e as Error).message || e });
    }

    return kg;
}
