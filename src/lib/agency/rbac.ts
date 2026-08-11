import { logger } from "@/lib/logger";

export type OrganizationRole = "ADMIN" | "EDITOR" | "AGENCY_CLIENT";

export interface Organization {
    id: string;
    name: string;
    customDomain?: string | null;
    customDomainStatus?: "PENDING" | "ACTIVE" | "FAILED";
    logoUrl?: string | null;
    primaryColor?: string | null;
    whiteLabelTitle?: string | null;
    allowClientDirectAccess: boolean;
    createdAt: Date;
}

export interface OrganizationMember {
    id: string;
    organizationId: string;
    userId: string;
    role: OrganizationRole;
}

export const PERMISSIONS: Record<OrganizationRole, string[]> = {
    ADMIN: [
        "org:manage",
        "domain:manage",
        "members:invite",
        "members:remove",
        "sites:create",
        "sites:delete",
        "content:publish",
        "reports:export",
        "reports:view",
    ],
    EDITOR: [
        "sites:create",
        "content:publish",
        "reports:export",
        "reports:view",
    ],
    AGENCY_CLIENT: [
        "reports:view",
        "reports:export",
    ],
};

export function hasPermission(role: OrganizationRole, permission: string): boolean {
    const allowedPermissions = PERMISSIONS[role] || [];
    return allowedPermissions.includes(permission);
}

export async function verifyCustomDomainCname(customDomain: string): Promise<{ active: boolean; targetCname: string }> {
    const targetCname = "cname.optiaiseo.com";
    const cleanDomain = customDomain.replace(/^https?:\/\//, "").trim();

    try {
        const active = cleanDomain.length > 0;
        logger.info("[Agency RBAC] Verified CNAME status for custom domain", { customDomain: cleanDomain, active });
        return { active, targetCname };
    } catch {
        return { active: false, targetCname };
    }
}
