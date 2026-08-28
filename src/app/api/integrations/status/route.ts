import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type IntegrationStatusState =
    | "connected"
    | "not_connected"
    | "reauthorization_required"
    | "no_property"
    | "property_access_denied";

export interface IntegrationStatus {
    id: string;
    name: string;
    description: string;
    status: IntegrationStatusState;
    /** @deprecated Use `status` field instead. Kept for backward compatibility. */
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
 * Accepts optional `?siteId=xxx` query parameter for multi-site users.
 * When provided, returns status scoped to that specific site.
 * Falls back to the user's first site when no siteId is specified.
 *
 * Used by the Integrations settings panel to render live status.
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;
        const requestedSiteId = req.nextUrl.searchParams.get("siteId");

        // Parallel queries for all integration data
        const siteSelect = {
            id: true,
            domain: true,
            userId: true,
            ga4PropertyId: true,
            githubRepoUrl: true,
            wordPressConfig: true,
            ghostConfig: true,
            hashnodeToken: true,
            hashnodePublicationId: true,
        } as const;

        const [user, gscAccount, ga4Account, resolvedSite] = await Promise.all([
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
                select: { id: true, providerAccountId: true, scope: true, refresh_token: true },
            }),
            prisma.account.findFirst({
                where: { userId, provider: "google-ga4" },
                select: { id: true, providerAccountId: true, scope: true, refresh_token: true },
            }),
            // Site-scoped lookup: if siteId is provided, find that specific site;
            // otherwise fall back to the user's first site.
            requestedSiteId
                ? prisma.site.findUnique({
                    where: { id: requestedSiteId },
                    select: siteSelect,
                })
                : prisma.site.findFirst({
                    where: { userId },
                    select: siteSelect,
                    orderBy: { createdAt: "asc" },
                }),
        ]);

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        // Authorization: if a specific siteId was requested, verify the user
        // owns the site or is a team member. For default (first-site) queries,
        // findFirst already scopes to the user.
        const site = resolvedSite as typeof resolvedSite & { userId?: string } | null;
        if (requestedSiteId && site) {
            const isOwner = site.userId === userId;
            if (!isOwner) {
                // Check team membership
                let isTeamMember = false;
                try {
                    const membership = await (prisma as any).teamMember.findFirst({
                        where: { userId, siteId: requestedSiteId },
                        select: { id: true },
                    });
                    isTeamMember = !!membership;
                } catch {
                    // TeamMember model may not exist — treat as not a member
                }
                if (!isTeamMember) {
                    return NextResponse.json(
                        { error: "You do not have access to this site" },
                        { status: 403 }
                    );
                }
            }
        }

        const prefs = (user.preferences as Record<string, unknown>) ?? {};
        const mozToken = typeof prefs.mozApiToken === "string" ? prefs.mozApiToken : null;

        // Determine last GSC sync from GscDailyPerformance if site exists
        let gscLastSync: string | null = null;
        if (site) {
            const lastPerf = await prisma.gscDailyPerformance.findFirst({
                where: { siteId: site.id },
                orderBy: { fetchedAt: "desc" },
                select: { fetchedAt: true },
            });
            gscLastSync = lastPerf?.fetchedAt?.toISOString() ?? null;
        }

        const gscConnected = (user.gscConnected || !!gscAccount);

        // ── GSC status state machine ──
        let gscStatus: IntegrationStatusState;
        if (!gscAccount) {
            gscStatus = "not_connected";
        } else if (!gscAccount.refresh_token) {
            gscStatus = "reauthorization_required";
        } else {
            gscStatus = "connected";
        }

        // ── GA4 status state machine ──
        const ga4HasDedicatedAccount = !!ga4Account;
        const ga4LegacyScope = gscAccount?.scope?.includes('analytics.readonly') ?? false;
        const ga4HasCredentials = ga4HasDedicatedAccount || ga4LegacyScope;
        let ga4Status: IntegrationStatusState;

        if (!ga4HasCredentials) {
            ga4Status = "not_connected";
        } else if (ga4HasDedicatedAccount && !ga4Account!.refresh_token) {
            ga4Status = "reauthorization_required";
        } else if (!site?.ga4PropertyId) {
            ga4Status = "no_property";
        } else {
            ga4Status = "connected";
        }

        const ga4Connected = ga4Status === "connected";
        const ga4ConfigErrors: string[] = [];
        if (site?.ga4PropertyId && !ga4HasDedicatedAccount && !ga4LegacyScope) {
            ga4ConfigErrors.push("Connect Google Analytics separately to restore GA4 data");
        }
        if (site?.ga4PropertyId && !ga4HasDedicatedAccount && !gscAccount) {
            ga4ConfigErrors.push("Google account disconnected — GA4 data unavailable");
        }
        const githubConnected = !!site?.githubRepoUrl;

        // Parse WordPress config
        const wpConfig = site?.wordPressConfig as Record<string, unknown> | null;
        const wpConnected = !!wpConfig?.siteUrl;
        const wpConfigErrors: string[] = [];
        if (wpConnected && !wpConfig?.apiKey) {
            wpConfigErrors.push("API key not configured");
        }

        // Parse Ghost config
        const ghostConfig = site?.ghostConfig as Record<string, unknown> | null;
        const ghostConnected = !!ghostConfig?.ghostUrl;
        const ghostConfigErrors: string[] = [];
        if (ghostConnected && !ghostConfig?.ghostAdminKey) {
            ghostConfigErrors.push("Admin API key not configured");
        }

        const hashnodeConnected = !!site?.hashnodeToken && !!site?.hashnodePublicationId;
        const hashnodeConfigErrors: string[] = [];
        if (site?.hashnodeToken && !site?.hashnodePublicationId) {
            hashnodeConfigErrors.push("Publication ID not configured");
        }
        if (!site?.hashnodeToken && site?.hashnodePublicationId) {
            hashnodeConfigErrors.push("Personal Access Token not configured");
        }

        const integrations: IntegrationStatus[] = [
            {
                id: "gsc",
                name: "Google Search Console",
                description: "Live CTR, impressions, position data, keyword opportunities, and experiment tracking.",
                status: gscStatus,
                connected: gscStatus === "connected",
                accountLabel: gscAccount?.providerAccountId ?? undefined,
                lastSyncAt: gscLastSync,
                configErrors: gscStatus === "connected" && !gscLastSync ? ["No data synced yet"] : [],
                canConnect: gscStatus !== "connected",
                canDisconnect: gscStatus !== "not_connected",
            },
            {
                id: "ga4",
                name: "Google Analytics 4",
                description: "Unified search + analytics data on the Keywords page.",
                status: ga4Status,
                connected: ga4Connected,
                accountLabel: site?.ga4PropertyId ?? undefined,
                lastSyncAt: null,
                configErrors: ga4ConfigErrors,
                canConnect: true,
                canDisconnect: ga4Connected,
            },
            {
                id: "github",
                name: "GitHub",
                description: "Automated pull requests for content fixes, meta tags, and schema markup.",
                status: githubConnected ? "connected" : "not_connected",
                connected: githubConnected,
                accountLabel: site?.githubRepoUrl ?? undefined,
                lastSyncAt: null,
                configErrors: githubConnected && !site?.githubRepoUrl
                    ? ["Repository URL not configured"]
                    : [],
                canConnect: true,
                canDisconnect: githubConnected,
            },
            {
                id: "wordpress",
                name: "WordPress",
                description: "Auto-publish blogs, apply meta tag fixes, and sync content directly to your site.",
                status: wpConnected ? "connected" : "not_connected",
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
                status: ghostConnected ? "connected" : "not_connected",
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
                status: hashnodeConnected ? "connected" : "not_connected",
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
                status: mozToken ? "connected" : "not_connected",
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
                status: user.wpApiKey ? "connected" : "not_connected",
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
