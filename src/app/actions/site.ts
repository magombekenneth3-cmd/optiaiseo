"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { revalidatePath, unstable_cache, revalidateTag } from "next/cache";
import { requireUser, assertSiteOwnership } from "@/lib/auth/require-user";

const VALID_STACKS = ["nextjs", "react-vite", "vue", "nuxt", "angular", "html", "wordpress", "other"];

export async function saveGithubRepo(siteId: string, repoUrl: string) {
    try {
        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const trimmed = repoUrl.trim()
            .replace(/\.git$/, "")
            .replace(/\/$/, "");

        if (trimmed) {
            try {
                const url = new URL(trimmed);
                if (url.hostname !== "github.com") {
                    return { success: false, error: "Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)." };
                }
                const parts = url.pathname.split("/").filter(Boolean);
                if (parts.length < 2) {
                    return { success: false, error: "Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)." };
                }
            } catch {
                return { success: false, error: "Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)." };
            }
        }

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: { githubRepoUrl: trimmed || null },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidatePath("/dashboard/sites");
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save GitHub repo:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save GitHub repository." };
    }
}

export async function createSite(data: {
    domain: string;
    operatingMode: "REPORT_ONLY" | "FULL_ACCESS";
    niche?: string;
    location?: string;
    coreServices?: string;
    targetCustomer?: string;
}) {
    try {
        let urlStr = data.domain.trim();
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
            urlStr = `https://${urlStr}`;
        }

        let normalizedDomain: string;
        try {
            const parsedUrl = new URL(urlStr);
            const { isValidPublicDomain } = await import("@/lib/security");
            if (!isValidPublicDomain(parsedUrl.hostname)) {
                return { success: false, error: "Invalid or restricted domain provided." };
            }
            normalizedDomain = parsedUrl.hostname;
        } catch {
            return { success: false, error: "Invalid domain format provided." };
        }

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const { withinLimit } = await import("@/lib/stripe/plans");

        const newSite = await prisma.$transaction(async (tx) => {
            const currentSiteCount = await tx.site.count({ where: { userId: user.id } });
            if (!withinLimit(user.subscriptionTier, "sites", currentSiteCount)) {
                throw Object.assign(new Error("LIMIT_REACHED"), { code: "LIMIT_REACHED" });
            }

            return tx.site.create({
                data: {
                    userId: user.id,
                    domain: normalizedDomain,
                    operatingMode: data.operatingMode,
                    ...(data.niche ? { niche: data.niche.trim() } : {}),
                    ...(data.location ? { location: data.location.trim() } : {}),
                    ...(data.coreServices ? { coreServices: data.coreServices.trim() } : {}),
                    ...(data.targetCustomer ? { targetCustomer: data.targetCustomer.trim() } : {}),
                },
            });
        });

        revalidatePath("/dashboard/sites");
        revalidateTag(`user-sites-${user.id}`);
        // Pre-emptively bust the GSC keyword cache so the Keywords dashboard
        // fetches fresh data on first load after a site is registered.
        revalidateTag(`gsc-keywords-${newSite.id}`);

        try {
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({
                name: "site.created",
                data: { siteId: newSite.id, domain: normalizedDomain, userId: user.id },
            });
        } catch (err) {
            logger.warn("Inngest site.created event failed", { error: (err as Error)?.message });
        }

        return { success: true, site: newSite };
    } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        if (code === "LIMIT_REACHED") {
            return { success: false, error: "You have reached the maximum number of sites for your tier. Please upgrade your plan." };
        }
        if (code === "P2002") {
            return { success: false, error: "This site has already been added." };
        }
        logger.error("Failed to create site:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to create site." };
    }
}

export async function getUserSites() {
    try {
        const auth = await requireUser();
        // Read-only — unauthenticated gets empty list
        if (!auth.ok) return { success: true, sites: [] };
        const { user } = auth;

        const cachedFetch = unstable_cache(
            async () => prisma.site.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: "desc" },
                take: 100,
                include: {
                    audits: {
                        orderBy: { runTimestamp: "desc" },
                        take: 1,
                    },
                },
            }),
            [`user-sites-${user.id}`],
            { revalidate: 60, tags: [`user-sites-${user.id}`] }
        );

        const sites = await cachedFetch();
        return { success: true, sites };
    } catch (error: unknown) {
        logger.error("Failed to fetch sites:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch sites.", sites: [] };
    }
}

// Derives the exact Prisma shape that getSite returns on success.
// Using a helper function keeps the type in sync with the query automatically.
async function fetchSite(siteId: string, userId: string) {
    return prisma.site.findFirst({
        where: { id: siteId, userId },
        include: {
            audits: {
                orderBy: { runTimestamp: "desc" },
                take: 5,
            },
            blogs: {
                orderBy: { createdAt: "desc" },
                take: 5,
            },
            competitors: {
                include: { _count: { select: { keywords: true } } },
                orderBy: { addedAt: "desc" },
                take: 3,
            },
            brandFacts: {
                orderBy: { updatedAt: "desc" },
                take: 10,
            },
        },
    });
}

type SiteFull = NonNullable<Awaited<ReturnType<typeof fetchSite>>>;

type GetSiteResult =
    | { success: true; site: SiteFull; userRole: string }
    | { success: false; error: string };

export async function getSite(siteId: string): Promise<GetSiteResult> {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await fetchSite(siteId, user.id);

        if (!site) return { success: false, error: "Site not found" };

        const tier = (user.subscriptionTier ?? "").toUpperCase();
        const role = (user.role ?? "").toUpperCase();
        // SUPER_ADMIN always gets full admin privileges.
        // Any authenticated user who owns the site gets AGENCY_ADMIN so they
        // can manage (edit, delete) their own sites regardless of plan tier.
        // The old check (AGENCY || ENTERPRISE only) was incorrectly locking
        // FREE/STARTER/PRO users out of deleting their own sites.
        const userRole = role === "SUPER_ADMIN"
            ? "SUPER_ADMIN"
            : "AGENCY_ADMIN"; // site owner always has full control over their own sites

        return { success: true, site, userRole };

    } catch (error: unknown) {
        logger.error("Failed to fetch site:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to fetch site." };
    }
}

export async function deleteSite(siteId: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.delete({ where: { id: site.id } });

        revalidatePath("/dashboard/sites");
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to delete site:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to delete site. Please try again." };
    }
}

export async function saveHashnodeToken(siteId: string, token: string, publication: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: {
                hashnodeToken: token || null,
                hashnodePublicationId: publication || null,
            },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save Hashnode token:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save token" };
    }
}

export async function saveCoreServices(siteId: string, coreServices: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };
        if (typeof coreServices !== "string") return { success: false, error: "Invalid input" };

        const trimmed = coreServices.trim();
        if (trimmed.length > 2000) {
            return { success: false, error: "Core services description must be under 2000 characters." };
        }

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: { coreServices: trimmed || null },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save core services:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save core services" };
    }
}

export async function saveTechStack(siteId: string, techStack: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };
        if (!VALID_STACKS.includes(techStack)) return { success: false, error: "Invalid tech stack value." };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: { techStack },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save tech stack:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save tech stack." };
    }
}

export async function saveBlogTone(siteId: string, blogTone: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };
        if (!blogTone || typeof blogTone !== "string") return { success: false, error: "Invalid input" };
        if (blogTone.length > 500) return { success: false, error: "Blog tone must be under 500 characters." };

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: { blogTone: blogTone.trim() },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save blog tone:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save blog tone" };
    }
}

export async function saveBrandName(siteId: string, brandName: string) {
    try {
        if (!siteId || siteId.length > 50) return { success: false, error: "Invalid site ID" };
        if (typeof brandName !== "string") return { success: false, error: "Invalid input" };

        const trimmed = brandName.trim();
        if (trimmed.length > 100) {
            return { success: false, error: "Brand name must be under 100 characters." };
        }

        const auth = await requireUser();
        if (!auth.ok) return auth.error;
        const { user } = auth;

        const site = await assertSiteOwnership(siteId, user.id);
        if (!site) return { success: false, error: "Site not found" };

        await prisma.site.update({
            where: { id: site.id },
            data: { brandName: trimmed || null },
        });

        revalidatePath(`/dashboard/sites/${siteId}`);
        revalidateTag(`user-sites-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to save brand name:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to save brand name." };
    }
}