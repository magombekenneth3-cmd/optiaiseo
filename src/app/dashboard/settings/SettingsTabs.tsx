"use client";

import { useState } from "react";
import { User, Briefcase, Plug, CreditCard } from "lucide-react";
import { ProfileForm } from "./ProfileForm";
import { WhiteLabelForm } from "./WhiteLabelForm";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { NotificationPreferencesForm } from "./NotificationPreferencesForm";
import { SettingsClientExtras } from "./SettingsClientExtras";
import { WordPressPluginPanel } from "./WordPressPluginPanel";
import { DeleteAccountButton } from "./DeleteAccountButton";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPlan } from "@/lib/stripe/plans";

const TABS = [
    { id: "profile",        label: "Profile",          icon: User },
    { id: "workspace",      label: "Workspace",        icon: Briefcase },
    { id: "integrations",   label: "Integrations",     icon: Plug },
    { id: "billing",        label: "Billing & Account",icon: CreditCard },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
    initialName: string;
    initialEmail: string;
    isAgency: boolean;
    wl: { companyName?: string; logoUrl?: string; primaryColor?: string };
    emailDigest: boolean;
    userId: string;
    firstSiteId: string;
    planName: string;
    subscriptionTier: string;
}

export function SettingsTabs({
    initialName,
    initialEmail,
    isAgency,
    wl,
    emailDigest,
    userId,
    firstSiteId,
    planName,
    subscriptionTier,
}: Props) {
    const [active, setActive] = useState<TabId>("profile");

    return (
        <div className="flex flex-col gap-0 w-full max-w-4xl mx-auto">
            {/* Tab bar */}
            <div
                role="tablist"
                aria-label="Settings sections"
                className="flex items-center gap-1 border-b border-border mb-8 overflow-x-auto pb-px"
            >
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = active === tab.id;
                    return (
                        <button
                            key={tab.id}
                            id={`settings-tab-${tab.id}`}
                            role="tab"
                            aria-selected={isActive}
                            aria-controls={`settings-panel-${tab.id}`}
                            onClick={() => setActive(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
                                isActive
                                    ? "border-emerald-500 text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                            }`}
                        >
                            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Profile tab */}
            <div
                id="settings-panel-profile"
                role="tabpanel"
                aria-labelledby="settings-tab-profile"
                hidden={active !== "profile"}
            >
                {active === "profile" && (
                    <div className="flex flex-col gap-6">
                        <ProfileForm initialName={initialName} initialEmail={initialEmail} />
                        <ChangePasswordForm />
                        <NotificationPreferencesForm initialEmailDigest={emailDigest} siteId={firstSiteId || undefined} />
                    </div>
                )}
            </div>

            {/* Workspace tab */}
            <div
                id="settings-panel-workspace"
                role="tabpanel"
                aria-labelledby="settings-tab-workspace"
                hidden={active !== "workspace"}
            >
                {active === "workspace" && (
                    <div className="flex flex-col gap-6">
                        <WhiteLabelForm
                            isAgency={isAgency}
                            initialCompanyName={wl?.companyName}
                            initialLogoUrl={wl?.logoUrl}
                            initialPrimaryColor={wl?.primaryColor}
                        />
                        <SettingsClientExtras userId={userId} />
                    </div>
                )}
            </div>

            {/* Integrations tab */}
            <div
                id="settings-panel-integrations"
                role="tabpanel"
                aria-labelledby="settings-tab-integrations"
                hidden={active !== "integrations"}
            >
                {active === "integrations" && (
                    <WordPressPluginPanel siteId={firstSiteId} />
                )}
            </div>

            {/* Billing & Account tab */}
            <div
                id="settings-panel-billing"
                role="tabpanel"
                aria-labelledby="settings-tab-billing"
                hidden={active !== "billing"}
            >
                {active === "billing" && (
                    <div className="flex flex-col gap-6">
                        {/* Billing card */}
                        <div className="card-surface p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                    <CreditCard className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold mb-1">Billing &amp; Subscriptions</h2>
                                    <p className="text-sm text-muted-foreground max-w-sm">
                                        View your current plan, upgrade, or manage payment methods and invoices.
                                    </p>
                                    <div className="flex flex-wrap gap-3 mt-3">
                                        {[
                                            { label: "Current Plan", value: planName,                        color: "text-emerald-400" },
                                            { label: "Billing",      value: "Managed via Stripe",             color: "text-foreground" },
                                            { label: "Support",      value: "Priority for Pro & Agency",      color: "text-muted-foreground" },
                                        ].map((item) => (
                                            <div key={item.label} className="bg-muted rounded-lg px-3 py-2 border border-border">
                                                <p className="text-xs text-muted-foreground mb-0.5">{item.label}</p>
                                                <p className={`text-xs font-semibold ${item.color}`}>{item.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <Link
                                href="/dashboard/billing"
                                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-emerald-400 text-primary-foreground text-sm font-semibold transition-colors shadow-md shadow-emerald-500/20"
                            >
                                Manage Billing
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>

                        {/* Danger zone */}
                        <div className="card-surface p-6 border-rose-500/20 bg-rose-500/[0.03] flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                                    <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-rose-400 mb-1">Danger Zone</h2>
                                    <p className="text-sm text-muted-foreground max-w-sm">
                                        Permanently delete your account and <strong className="text-zinc-300">all associated data</strong> — sites, audits, blogs, keywords, competitors, billing, and sessions. This cannot be undone.
                                    </p>
                                </div>
                            </div>
                            <DeleteAccountButton />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
