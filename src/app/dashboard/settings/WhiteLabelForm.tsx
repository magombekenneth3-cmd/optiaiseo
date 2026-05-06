"use client";

import { updateWhiteLabel } from "@/app/actions/user";
import { useState } from "react";
import { toast } from "sonner";
import { PaintBucket, Link as LinkIcon, Building2, Crown } from "lucide-react";
import Link from "next/link";

interface WhiteLabelFormProps {
    isAgency: boolean;
    initialCompanyName?: string;
    initialLogoUrl?: string;
    initialPrimaryColor?: string;
}

export function WhiteLabelForm({
    isAgency,
    initialCompanyName,
    initialLogoUrl,
    initialPrimaryColor,
}: WhiteLabelFormProps) {
    const [isPending, setIsPending] = useState(false);

    async function handleSubmit(formData: FormData) {
        setIsPending(true);
        const result = await updateWhiteLabel(formData);
        setIsPending(false);
        if (result.success) toast.success("White-label settings saved successfully");
        else toast.error(result.error || "Failed to save white-label settings");
    }

    return (
        <div className="relative card-surface p-8 border-brand/20 bg-brand/[0.02]">
            {!isAgency && (
                <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center text-center p-6">
                    <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex flex-col items-center justify-center mb-3">
                        <Crown className="w-6 h-6 text-brand" />
                    </div>
                    <h3 className="text-lg font-bold mb-1 tracking-tight">Agency Feature</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mb-5">
                        Upgrade to the Agency plan to export white-labelled SEO & AEO audit PDFs with your own branding to share with clients.
                    </p>
                    <Link
                        href="/dashboard/billing"
                        className="bg-foreground text-background font-semibold px-5 py-2 rounded-lg text-sm hover:bg-foreground/90 transition-all font-inter"
                    >
                        Upgrade to Agency
                    </Link>
                </div>
            )}

            <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
                    <PaintBucket className="w-4 h-4 text-brand" />
                </div>
                <h2 className="text-lg font-bold">White-label PDF Reports</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-6 max-w-xl">
                Customize the branding of exported SEO & AEO PDF reports. Add your agency logo, name, and brand color to look professional when sending reports to clients.
            </p>

            <form action={handleSubmit} className="space-y-6 relative z-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            Agency Name
                        </label>
                        <input
                            type="text"
                            name="companyName"
                            defaultValue={initialCompanyName || ""}
                            placeholder="e.g. Acme SEO Agency"
                            disabled={!isAgency}
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 transition-shadow disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">Appears on the report cover and footer.</p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <LinkIcon className="w-4 h-4" />
                            Logo URL
                        </label>
                        <input
                            type="url"
                            name="logoUrl"
                            defaultValue={initialLogoUrl || ""}
                            placeholder="https://example.com/logo.png"
                            disabled={!isAgency}
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 transition-shadow disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">URL to a publicly accessible logo image.</p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Brand Color</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                name="primaryColor"
                                defaultValue={initialPrimaryColor || "#2563eb"}
                                disabled={!isAgency}
                                className="w-12 h-12 p-1 bg-black/50 border border-border rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-muted-foreground">Pick a color to match your brand theme.</p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end mt-4">
                    <button
                        type="submit"
                        disabled={!isAgency || isPending}
                        className="bg-brand text-white hover:bg-brand/90 px-5 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isPending ? (
                            <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Saving...</>
                        ) : "Save Preferences"}
                    </button>
                </div>
            </form>
        </div>
    );
}
