/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getPlan } from "@/lib/stripe/plans";
import { SettingsTabs } from "./SettingsTabs";

export const metadata: Metadata = {
    title: 'Settings | OptiAISEO',
    description: 'Manage your OptiAISEO account and billing settings.',
};

export default async function SettingsPage() {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
        redirect("/login");
    }

    const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, whiteLabel: true, preferences: true },
    });

    const firstSite = await prisma.site.findFirst({
        where:   { userId: dbUser?.id ?? "" },
        select:  { id: true },
        orderBy: { createdAt: "asc" },
    });

    const subscriptionTier = (session.user as any)?.subscriptionTier ?? "FREE";
    const isAgency = subscriptionTier === "AGENCY";
    const wl = (dbUser?.whiteLabel as any) || {};
    const prefs = (dbUser?.preferences as Record<string, unknown>) ?? {};
    const emailDigest = prefs.emailDigest !== false;

    return (
        <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Account Settings</h1>
                <p className="text-muted-foreground">Manage your profile, workspace, and billing preferences.</p>
            </div>

            <SettingsTabs
                initialName={session.user.name || ""}
                initialEmail={session.user.email || ""}
                isAgency={isAgency}
                wl={wl}
                emailDigest={emailDigest}
                userId={dbUser?.id ?? ""}
                firstSiteId={firstSite?.id ?? ""}
                planName={getPlan(subscriptionTier).name}
                subscriptionTier={subscriptionTier}
            />
        </div>
    );
}
