export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

interface CmsConfigBody {
    wordpress?: {
        wpUrl: string;
        wpUser: string;
        wpAppPassword: string;
    } | null;
    ghost?: {
        ghostUrl: string;
        ghostAdminKey: string;
    } | null;
    hashnode?: {
        hashnodeToken: string;
        hashnodePublicationId: string;
    } | null;
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;

    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { id: true },
    });
    if (!dbUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user!.id },
        select: { id: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Site not found or unauthorized" }, { status: 404 });
    }

    let body: CmsConfigBody;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Basic validation for WordPress config
    if (body.wordpress !== undefined && body.wordpress !== null) {
        const { wpUrl, wpUser, wpAppPassword } = body.wordpress;
        if (!wpUrl || !wpUser || !wpAppPassword) {
            return NextResponse.json(
                { error: "WordPress config requires wpUrl, wpUser, and wpAppPassword" },
                { status: 400 }
            );
        }
        // Ensure URL is valid
        try {
            new URL(wpUrl);
        } catch {
            return NextResponse.json({ error: "wpUrl must be a valid URL" }, { status: 400 });
        }
    }

    // Basic validation for Ghost config
    if (body.ghost !== undefined && body.ghost !== null) {
        const { ghostUrl, ghostAdminKey } = body.ghost;
        if (!ghostUrl || !ghostAdminKey) {
            return NextResponse.json(
                { error: "Ghost config requires ghostUrl and ghostAdminKey" },
                { status: 400 }
            );
        }
        if (!ghostAdminKey.includes(":")) {
            return NextResponse.json(
                { error: "ghostAdminKey must be in {id}:{secret} format" },
                { status: 400 }
            );
        }
        try {
            new URL(ghostUrl);
        } catch {
            return NextResponse.json({ error: "ghostUrl must be a valid URL" }, { status: 400 });
        }
    }

    // Basic validation for Hashnode config
    if (body.hashnode !== undefined && body.hashnode !== null) {
        const { hashnodeToken, hashnodePublicationId } = body.hashnode;
        if (!hashnodeToken || !hashnodePublicationId) {
            return NextResponse.json(
                { error: "Hashnode config requires hashnodeToken and hashnodePublicationId" },
                { status: 400 }
            );
        }
    }

    try {
        const updateData: Record<string, unknown> = {};

        // null means "clear the config"; undefined means "leave unchanged"
        if (body.wordpress !== undefined) {
            updateData.wordPressConfig = body.wordpress;
        }
        if (body.ghost !== undefined) {
            updateData.ghostConfig = body.ghost;
        }
        if (body.hashnode !== undefined) {
            // Store directly on the Site columns (not a JSON blob)
            if (body.hashnode === null) {
                updateData.hashnodeToken = null;
                updateData.hashnodePublicationId = null;
            } else {
                updateData.hashnodeToken = body.hashnode.hashnodeToken;
                updateData.hashnodePublicationId = body.hashnode.hashnodePublicationId;
            }
        }

        await prisma.site.update({
            where: { id: siteId },
            data: updateData,
        });

        logger.info("[CmsConfig] Saved CMS config for site", { siteId });
        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        logger.error("[CmsConfig] Failed to save:", { error: (err as Error)?.message || String(err) });
        return NextResponse.json({ error: "Failed to save CMS configuration" }, { status: 500 });
    }
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const user = await getAuthUser(req);
    if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: user!.email },
        select: { id: true },
    });
    if (!dbUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: dbUser!.id },
        select: { wordPressConfig: true, ghostConfig: true, hashnodeToken: true, hashnodePublicationId: true },
    });
    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Return masked secrets so frontend knows config is set without exposing credentials
    const wpConfig = site.wordPressConfig as Record<string, string> | null;
    const ghostConfig = site.ghostConfig as Record<string, string> | null;

    return NextResponse.json({
        wordpress: wpConfig
            ? {
                  wpUrl: wpConfig.wpUrl,
                  wpUser: wpConfig.wpUser,
                  wpAppPassword: "••••••••",  // masked
                  isConfigured: true,
              }
            : null,
        ghost: ghostConfig
            ? {
                  ghostUrl: ghostConfig.ghostUrl,
                  ghostAdminKey: "••••••••",  // masked
                  isConfigured: true,
              }
            : null,
        hashnode: site.hashnodeToken && site.hashnodePublicationId
            ? {
                  hashnodeToken: "••••••••",           // masked
                  hashnodePublicationId: site.hashnodePublicationId,
                  isConfigured: true,
              }
            : null,
    });
}
