"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userIsPaid } from "@/lib/paywall";
import { parseCountryCode } from "@/lib/competitors";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

const BLOCKED_DOMAINS = new Set([
    "facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com",
    "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com",
    "play.google.com", "apps.apple.com", "itunes.apple.com", "amazon.com",
    "wikipedia.org", "trustpilot.com", "g2.com", "capterra.com",
    "crunchbase.com", "yelp.com", "glassdoor.com", "medium.com",
    "substack.com", "wordpress.com", "blogger.com", "wix.com",
    "shopify.com", "squarespace.com", "hubspot.com", "mailchimp.com",
]);

const CONTENT_SITE_PATTERNS = [
    /\b(news|blog|magazine|media|press|journal|post|times|daily|weekly|tribune|herald|gazette)\b/i,
    /\b(techradar|pcmag|wired|verge|engadget|cnet|tomsguide|techcrunch|mashable|gizmodo)\b/i,
    /\b(review|compare|versus|bestof|top\d|ranking|listicle)\b/i,
    /\b(howto|guide|tutorial|learn|tips|advice|explained|definition)\b/i,
    /\b(statista|similarweb|semrush|ahrefs|moz|alexa)\b/i,
];

function isContentSite(domain: string): boolean {
    return CONTENT_SITE_PATTERNS.some(p => p.test(domain));
}

function buildServiceQueries(serviceName: string, location: string): string[] {
    const loc = location.trim();
    const base = loc && !serviceName.toLowerCase().includes(loc.toLowerCase())
        ? `${serviceName} ${loc}`
        : serviceName;

    return [
        base,
        `best ${base}`,
        `${base} provider`,
        `${base} pricing`,
    ].map(q => q.replace(/\s+/g, " ").trim()).filter(q => q.length > 3);
}

async function getSessionUser() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;
    return prisma.user.findUnique({ where: { email: session.user.email } });
}

async function assertSiteOwnership(siteId: string, userId: string) {
    if (!siteId || siteId.length > 50) return null;
    return prisma.site.findFirst({ where: { id: siteId, userId } });
}

async function fetchSiteText(domain: string): Promise<string> {
    try {
        const res = await fetch(`https://${domain}`, {
            signal: AbortSignal.timeout(6000),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        });
        const html = await res.text();

        const title = html.match(/<title[^>]*>([^<]{3,120})<\/title>/i)?.[1]?.trim() ?? "";
        const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1]?.trim() ?? "";
        const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1]?.trim() ?? "";
        const headings = [...html.matchAll(/<h[123][^>]*>([^<]{5,120})<\/h[123]>/gi)]
            .map(m => m[1].trim()).slice(0, 10).join(" | ");
        const paras = [...html.matchAll(/<p[^>]*>([^<]{20,300})<\/p>/gi)]
            .map(m => m[1].replace(/<[^>]+>/g, "").trim()).slice(0, 5).join(" ");
        const navLinks = [...html.matchAll(/<a[^>]+href=["']([^"'#?]+)["'][^>]*>([^<]{2,60})<\/a>/gi)]
            .filter(m => /\/(services?|products?|pricing|solutions?|plans?|packages?|offerings?)/i.test(m[1]))
            .map(m => m[2].replace(/<[^>]+>/g, "").trim())
            .filter(t => t.length > 1)
            .slice(0, 8)
            .join(", ");

        return [title, metaDesc || ogDesc, navLinks ? `Nav categories: ${navLinks}` : "", headings, paras]
            .filter(Boolean)
            .join("\n");
    } catch {
        return "";
    }
}

async function extractServicesWithAI(
    siteText: string,
    domain: string,
    localContext: string | null,
    coreServices: string | null,
): Promise<Array<{ name: string; label: string }>> {
    const location = localContext ? localContext.split(",")[0].trim() : "";

    const contextHint = coreServices
        ? `The operator has described their core services as: "${coreServices}". Use this as the primary signal.`
        : "";

    const prompt = `You are analyzing a business website to identify its distinct services for competitor research.

Website domain: ${domain}
Location context: ${location || "unknown"}
${contextHint}
Homepage content:
"""
${siteText.slice(0, 2000)}
"""

List each distinct service this business offers.

Rules:
- Be SPECIFIC not generic. "fibre broadband internet Uganda" not "internet".
- Include the location in the service name when relevant for search (e.g. "accountancy services Kampala").
- Max 4 services. Only real, distinct offerings.
- If only one clear service exists, return just one.
- Return ONLY a JSON array of objects, nothing else.

Example output:
[
  { "name": "fibre broadband Uganda", "label": "Fibre Broadband" },
  { "name": "pay TV streaming Uganda", "label": "Pay TV" }
]`;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) throw new Error(`AI call failed: ${res.status}`);

        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        const cleaned = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (
            Array.isArray(parsed) &&
            parsed.every(
                (s: unknown) =>
                    typeof s === "object" &&
                    s !== null &&
                    "name" in s &&
                    "label" in s &&
                    typeof (s as Record<string, unknown>).name === "string" &&
                    typeof (s as Record<string, unknown>).label === "string",
            )
        ) {
            return (parsed as Array<{ name: string; label: string }>).slice(0, 4);
        }
    } catch (e) {
        logger.warn("[Services] AI service extraction failed", { error: (e as Error)?.message });
    }

    const fallbackLabel = domain.split(".")[0];
    return [{ name: `${fallbackLabel} ${location}`.trim(), label: fallbackLabel }];
}

async function runSerperQueries(
    queries: string[],
    glCode: string,
    ownRoot: string,
): Promise<{ domainFrequency: Map<string, number>; domainBestPosition: Map<string, number> }> {
    const domainFrequency = new Map<string, number>();
    const domainBestPosition = new Map<string, number>();

    for (const query of queries) {
        try {
            const response = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: {
                    "X-API-KEY": process.env.SERPER_API_KEY!,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ q: query, gl: glCode, hl: "en", num: 10 }),
                signal: AbortSignal.timeout(8000),
            });

            if (!response.ok) continue;

            const data = await response.json();
            const organic: Array<{ link?: string }> = data.organic ?? [];
            const relatedSearches: Array<{ query: string }> = data.relatedSearches ?? [];
            const relatedText = relatedSearches.map(r => r.query).join(" ").toLowerCase();

            for (const [index, result] of organic.entries()) {
                if (!result.link) continue;
                try {
                    const domain = new URL(result.link).hostname
                        .replace(/^www\./, "")
                        .toLowerCase();

                    if (domain === ownRoot || domain.endsWith(`.${ownRoot}`)) continue;
                    if (BLOCKED_DOMAINS.has(domain)) continue;
                    if (isContentSite(domain)) continue;

                    const domainBase = domain.split(".")[0];
                    const relatedBonus = relatedText.includes(domainBase) ? 0.5 : 0;

                    domainFrequency.set(domain, (domainFrequency.get(domain) ?? 0) + 1 + relatedBonus);

                    const existing = domainBestPosition.get(domain) ?? 999;
                    domainBestPosition.set(domain, Math.min(existing, index + 1));
                } catch {
                    /* skip malformed URLs */
                }
            }
        } catch (e) {
            logger.warn("[Services] Serper query failed", { query, error: (e as Error)?.message });
        }
    }

    return { domainFrequency, domainBestPosition };
}

function rankCandidates(
    domainFrequency: Map<string, number>,
    domainBestPosition: Map<string, number>,
    limit: number,
): string[] {
    return Array.from(domainFrequency.entries())
        .map(([domain, freq]) => {
            const pos = domainBestPosition.get(domain) ?? 10;
            const posWeight = 1 / Math.sqrt(pos);
            return { domain, score: freq * posWeight };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ domain }) => domain);
}

export async function detectAndStoreServices(siteId: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID", services: [] };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized", services: [] };

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found", services: [] };

        const ownRoot = site.domain.replace(/^www\./, "").toLowerCase();
        const location = site.localContext?.split(",")?.[0]?.trim() ?? site.location ?? "";

        let services: Array<{ name: string; label: string }>;

        if (site.targetKeyword) {
            const enrichedName =
                location && !site.targetKeyword.toLowerCase().includes(location.toLowerCase())
                    ? `${site.targetKeyword} ${location}`.trim()
                    : site.targetKeyword;
            services = [{ name: enrichedName, label: site.targetKeyword }];
        } else {
            const siteText = await fetchSiteText(ownRoot);
            services = await extractServicesWithAI(
                siteText,
                ownRoot,
                site.localContext ?? null,
                site.coreServices ?? null,
            );
        }

        const saved = await Promise.all(
            services.map(s =>
                prisma.detectedService.upsert({
                    where: { siteId_name: { siteId, name: s.name } },
                    update: { label: s.label },
                    create: { siteId, name: s.name, label: s.label },
                }),
            ),
        );

        revalidatePath("/dashboard/keywords");
        revalidatePath("/dashboard");
        logger.info("[Services] detectAndStoreServices saved", { count: saved.length, siteId });
        return { success: true, services: saved };
    } catch (e: unknown) {
        logger.error("[Services] detectAndStoreServices failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to detect services", services: [] };
    }
}

export async function fetchCompetitorsForService(siteId: string, serviceId: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID", suggestions: [] as string[] };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized", suggestions: [] as string[] };

        const paid = await userIsPaid(user.id);
        if (!paid) {
            return {
                success: false,
                error: "upgrade_required",
                message: "Competitor search is available on paid plans. Upgrade to continue.",
                suggestions: [] as string[],
            };
        }

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found", suggestions: [] as string[] };

        if (!process.env.SERPER_API_KEY)
            return { success: false, error: "Search unavailable", suggestions: [] as string[] };

        const service = await prisma.detectedService.findUnique({ where: { id: serviceId } });
        if (!service || service.siteId !== siteId)
            return { success: false, error: "Service not found", suggestions: [] as string[] };

        const ownRoot = site.domain.replace(/^www\./, "").toLowerCase();
        const glCode = site.localContext ? parseCountryCode(site.localContext) : "us";
        const location = site.localContext?.split(",")?.[0]?.trim() ?? site.location ?? "";

        const queries = buildServiceQueries(service.name, location);

        const { domainFrequency, domainBestPosition } = await runSerperQueries(
            queries,
            glCode,
            ownRoot,
        );

        let suggestions = rankCandidates(domainFrequency, domainBestPosition, 8);

        if (suggestions.length === 0) {
            const fallbackName = service.name
                .replace(/\b(uganda|kenya|nigeria|ghana|south africa|uk|us|usa|india|australia|kampala|nairobi|lagos)\b/gi, "")
                .replace(/\s+/g, " ")
                .trim();

            if (fallbackName.length > 3) {
                const { domainFrequency: ff, domainBestPosition: fp } = await runSerperQueries(
                    [fallbackName, `best ${fallbackName}`],
                    glCode,
                    ownRoot,
                );
                suggestions = rankCandidates(ff, fp, 5);
            }
        }

        return { success: true, suggestions };
    } catch (e: unknown) {
        logger.error("[Services] fetchCompetitorsForService failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to fetch competitors", suggestions: [] as string[] };
    }
}

export async function skipCompetitorSuggestion(siteId: string, serviceId: string, domain: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID" };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        const service = await prisma.detectedService.findUnique({ where: { id: serviceId } });
        if (!service || service.siteId !== siteId)
            return { success: false, error: "Service not found" };

        await prisma.skippedCompetitor.upsert({
            where: { siteId_serviceId_domain: { siteId, serviceId, domain } },
            update: {},
            create: { siteId, serviceId, domain },
        });

        return { success: true };
    } catch (e: unknown) {
        logger.error("[Services] skipCompetitorSuggestion failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to skip competitor" };
    }
}

export async function saveCompetitorForService(siteId: string, serviceId: string, domain: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID" };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const paid = await userIsPaid(user.id);
        if (!paid) return { success: false, error: "upgrade_required" };

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        const service = await prisma.detectedService.findUnique({ where: { id: serviceId } });
        if (!service || service.siteId !== siteId)
            return { success: false, error: "Service not found" };

        const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, "");
        if (!cleanDomain || cleanDomain.length > 253)
            return { success: false, error: "Invalid domain" };

        const competitor = await prisma.competitor.upsert({
            where: { siteId_domain: { siteId, domain: cleanDomain } },
            update: { serviceId },
            create: { siteId, serviceId, domain: cleanDomain },
        });

        revalidatePath("/dashboard/keywords");
        revalidatePath("/dashboard");
        return { success: true, competitor };
    } catch (e: unknown) {
        logger.error("[Services] saveCompetitorForService failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to save competitor" };
    }
}

export async function deleteServiceCompetitor(siteId: string, competitorId: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID" };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const competitor = await prisma.competitor.findUnique({
            where: { id: competitorId },
            include: { site: { select: { userId: true } } },
        });

        if (!competitor) return { success: false, error: "Not found" };
        if (!competitor.site || competitor.site.userId !== user.id) return { success: false, error: "Forbidden" };
        if (competitor.siteId !== siteId) return { success: false, error: "Forbidden" };

        await prisma.competitor.delete({ where: { id: competitorId } });
        revalidatePath("/dashboard/keywords");
        revalidatePath("/dashboard");
        return { success: true };
    } catch (e: unknown) {
        logger.error("[Services] deleteServiceCompetitor failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to delete competitor" };
    }
}

export async function getServicesWithCompetitors(siteId: string) {
    try {
        if (!siteId || siteId.length > 50)
            return { success: false, error: "Invalid site ID", data: [] };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized", data: [] };

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found", data: [] };

        const services = await prisma.detectedService.findMany({
            where: { siteId },
            include: { competitors: { orderBy: { addedAt: "asc" } } },
            orderBy: { createdAt: "asc" },
        });

        return { success: true, data: services };
    } catch (e: unknown) {
        logger.error("[Services] getServicesWithCompetitors failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to load", data: [] };
    }
}

export async function deleteService(serviceId: string) {
    try {
        if (!serviceId || serviceId.length > 50)
            return { success: false, error: "Invalid service ID" };

        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const service = await prisma.detectedService.findUnique({
            where: { id: serviceId },
            include: { site: { select: { userId: true } } },
        });

        if (!service) return { success: false, error: "Not found" };
        if (service.site.userId !== user.id) return { success: false, error: "Forbidden" };

        await prisma.detectedService.delete({ where: { id: serviceId } });
        revalidatePath("/dashboard/keywords");
        revalidatePath("/dashboard");
        return { success: true };
    } catch (e: unknown) {
        logger.error("[Services] deleteService failed", { error: (e as Error)?.message });
        return { success: false, error: "Failed to delete service" };
    }
}