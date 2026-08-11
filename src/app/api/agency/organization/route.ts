import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyCustomDomainCname, hasPermission, OrganizationRole } from "@/lib/agency/rbac";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { orgName, customDomain, logoUrl, primaryColor, role = "ADMIN" } = body as {
            orgName: string;
            customDomain?: string;
            logoUrl?: string;
            primaryColor?: string;
            role?: OrganizationRole;
        };

        if (!hasPermission(role, "org:manage")) {
            return NextResponse.json({ error: "Forbidden: Insufficient permissions" }, { status: 403 });
        }

        let domainVerification = { active: false, targetCname: "cname.optiaiseo.com" };
        if (customDomain) {
            domainVerification = await verifyCustomDomainCname(customDomain);
        }

        return NextResponse.json({
            success: true,
            organization: {
                name: orgName,
                customDomain: customDomain || null,
                customDomainStatus: domainVerification.active ? "ACTIVE" : "PENDING",
                targetCname: domainVerification.targetCname,
                logoUrl: logoUrl || null,
                primaryColor: primaryColor || "#3b82f6",
            },
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "Agency organization setup failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
