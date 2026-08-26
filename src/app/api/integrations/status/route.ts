import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface IntegrationStatus {
    id: string;
    name: string;
    description: string;
    connected: boolean;
    accountLabel?: string;
    lastSyncAt?: string | null;
    configErrors: string[];
    canConnect: boolean;
    canDisconnect: boolean;
}

/**
 * GET /api/integrations/status
 *
 * Returns unified connection status for all integrations:
 * GSC, GA4, GitHub, WordPress, Moz, API Access
 *
 * Used by the Integrations settings panel to render live status.
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;

        // Parallel queries for all integration data
        const [user, gscAccount, firstSite] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    gscConnected: true,
                    wpApiKey: true,
                    preferences: true,
                },
            }),
            prisma.account.findFirst({
                where: { userId, provider: "google-gsc" },
                select: { id: true, providerAccountId: true },
            }),
            prisma.site.findFirst({
                where: { userId },
                select: {
                    id: true,
                    domain: true,
                    ga4PropertyId: true,
                    githubRepoUrl: true,
                    wordPressConfig: true,
                    ghostConfig: true,
                    hashnodeToken: true,
                    hashnodePublicationId: true,
                },
                orderBy: { createdAt: "asc" },
            }),
        ]);

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const prefs = (user.preferences as Record<string, unknown>) ?? {};
        const mozToken = typeof prefs.mozApiToken === "string" ? prefs.mozApiToken : null;

        // Determine last GSC sync from GscDailyPerformance if site exists
        let gscLastSync: string | null = null;
        if (firstSite) {
            const lastPerf = await prisma.gscDailyPerformance.findFirst({
                where: { siteId: firstSite.id },
                orderBy: { fetchedAt: "desc" },
                select: { fetchedAt: true },
            });
            gscLastSync = lastPerf?.fetchedAt?.toISOString() ?? null;
        }

        const gscConnected = (user.gscConnected || !!gscAccount);
        const ga4Connected = !!firstSite?.ga4PropertyId;
        const githubConnected = !!firstSite?.githubRepoUrl;

        // Parse WordPress config
        const wpConfig = firstSite?.wordPressConfig as Record<string, unknown> | null;
        const wpConnected = !!wpConfig?.siteUrl;
        const wpConfigErrors: string[] = [];
        if (wpConnected && !wpConfig?.apiKey) {
            wpConfigErrors.push("API key not configured");
        }

        // Parse Ghost config
        const ghostConfig = firstSite?.ghostConfig as Record<string, unknown> | null;
        const ghostConnected = !!ghostConfig?.ghostUrl;
        const ghostConfigErrors: string[] = [];
        if (ghostConnected && !ghostConfig?.ghostAdminKey) {
            ghostConfigErrors.push("Admin API key not configured");
        }

        // Hashnode config
        const hashnodeConnected = !!firstSite?.hashnodeToken && !!firstSite?.hashnodePublicationId;
        const hashnodeConfigErrors: string[] = [];
        if (firstSite?.hashnodeToken && !firstSite?.hashnodePublicationId) {
            hashnodeConfigErrors.push("Publication ID not configured");
        }
        if (!firstSite?.hashnodeToken && firstSite?.hashnodePublicationId) {
            hashnodeConfigErrors.push("Personal Access Token not configured");
        }

        const integrations: IntegrationStatus[] = [
            {
                id: "gsc",
                name: "Google Search Console",
                description: "Live CTR, impressions, position data, keyword opportunities, and experiment tracking.",
                connected: gscConnected,
                accountLabel: gscAccount?.providerAccountId ?? undefined,
                lastSyncAt: gscLastSync,
                configErrors: gscConnected && !gscLastSync ? ["No data synced yet"] : [],
                canConnect: !gscConnected,
                canDisconnect: gscConnected,
            },
            {
                id: "ga4",
                name: "Google Analytics 4",
                description: "Unified search + analytics data on the Keywords page.",
                connected: ga4Connected,
                accountLabel: firstSite?.ga4PropertyId ?? undefined,
                lastSyncAt: null,
                configErrors: [],
                canConnect: true,
                canDisconnect: ga4Connected,
            },
            {
                id: "github",
                name: "GitHub",
                description: "Automated pull requests for content fixes, meta tags, and schema markup.",
                connected: githubConnected,
                accountLabel: firstSite?.githubRepoUrl ?? undefined,
                lastSyncAt: null,
                configErrors: githubConnected && !firstSite?.githubRepoUrl
                    ? ["Repository URL not configured"]
                    : [],
                canConnect: true,
                canDisconnect: githubConnected,
            },
            {
                id: "wordpress",
                name: "WordPress",
                description: "Auto-publish blogs, apply meta tag fixes, and sync content directly to your site.",
                connected: wpConnected,
                accountLabel: wpConfig?.siteUrl as string | undefined,
                lastSyncAt: null,
                configErrors: wpConfigErrors,
                canConnect: true,
                canDisconnect: wpConnected,
            },
            {
                id: "ghost",
                name: "Ghost",
                description: "Auto-publish blogs and content to your Ghost CMS via Admin API.",
                connected: ghostConnected,
                accountLabel: ghostConfig?.ghostUrl as string | undefined,
                lastSyncAt: null,
                configErrors: ghostConfigErrors,
                canConnect: true,
                canDisconnect: ghostConnected,
            },
            {
                id: "hashnode",
                name: "Hashnode",
                description: "Auto-publish blogs with canonical links to your Hashnode publication.",
                connected: hashnodeConnected,
                accountLabel: hashnodeConnected ? "Publication configured" : undefined,
                lastSyncAt: null,
                configErrors: hashnodeConfigErrors,
                canConnect: true,
                canDisconnect: hashnodeConnected,
            },
            {
                id: "moz",
                name: "Moz",
                description: "Domain authority, spam score, and backlink metrics for competitive analysis.",
                connected: !!mozToken,
                accountLabel: mozToken ? "API Token configured" : undefined,
                lastSyncAt: null,
                configErrors: [],
                canConnect: true,
                canDisconnect: !!mozToken,
            },
            {
                id: "api",
                name: "API Access",
                description: "Call the OptiAISEO REST API from your own tools, scripts, or integrations.",
                connected: !!user.wpApiKey,
                accountLabel: user.wpApiKey ? "Active" : undefined,
                lastSyncAt: null,
                configErrors: [],
                canConnect: true,
                canDisconnect: !!user.wpApiKey,
            },
        ];

        return NextResponse.json({ integrations });
    } catch (err: unknown) {
        return NextResponse.json(
            { error: "Failed to fetch integration status" },
            { status: 500 }
        );
    }
}
