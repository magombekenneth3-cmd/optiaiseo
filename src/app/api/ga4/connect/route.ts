import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserGa4Token } from "@/lib/ga4/token";
import { listGa4Properties } from "@/lib/ga4";

/**
 * GA4 property ID format: 9-12 digit numeric string.
 * See https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties
 */
const GA4_PROPERTY_ID_PATTERN = /^\d{9,12}$/;

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { siteId, propertyId } = body as { siteId: string; propertyId: string | null };

    if (!siteId) {
        return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    // Format validation (null = disconnect, which is always valid)
    if (propertyId !== null && !GA4_PROPERTY_ID_PATTERN.test(propertyId)) {
        return NextResponse.json(
            { error: "Invalid GA4 property ID format. Must be a 9-12 digit number." },
            { status: 400 },
        );
    }

    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: session.user.id },
        select: { id: true, userId: true },
    });

    if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Ownership verification: ensure the property belongs to the authenticated user
    if (propertyId !== null) {
        try {
            const accessToken = await getUserGa4Token(site.userId);
            const userProperties = await listGa4Properties(accessToken);
            const ownsProperty = userProperties.some((p) => p.id === propertyId);
            if (!ownsProperty) {
                return NextResponse.json(
                    { error: "You do not have access to this GA4 property." },
                    { status: 403 },
                );
            }
        } catch {
            return NextResponse.json(
                { error: "Could not verify GA4 property ownership. Ensure Google Analytics is connected." },
                { status: 500 },
            );
        }
    }

    await prisma.site.update({
        where: { id: site.id },
        data: { ga4PropertyId: propertyId },
    });

    return NextResponse.json({ success: true });
}

