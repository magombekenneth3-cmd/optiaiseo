"use client";

import { updateProfile } from "@/app/actions/user";
import { useState } from "react";
import { toast } from "sonner";

interface ProfileFormProps {
    initialName: string;
    initialEmail: string;
    initialRole?: string;
    initialBio?: string;
    initialRealExperience?: string;
    initialRealNumbers?: string;
    initialLocalContext?: string;
}

export function ProfileForm({
    initialName,
    initialEmail,
    initialRole,
    initialBio,
    initialRealExperience,
    initialRealNumbers,
    initialLocalContext,
}: ProfileFormProps) {
    const [isPending, setIsPending] = useState(false);

    async function handleSubmit(formData: FormData) {
        setIsPending(true);
        const result = await updateProfile(formData);
        setIsPending(false);
        if (result.success) toast.success("Profile updated successfully");
        else toast.error(result.error || "Failed to update profile");
    }

    const firstChar = (initialName || initialEmail || "U").charAt(0).toUpperCase();

    return (
        <form action={handleSubmit} className="space-y-6">
            {/* ── Basic Info ──────────────────────────────────────────────── */}
            <div className="card-surface p-8">
                <h2 className="text-lg font-bold mb-6">Profile Information</h2>
                <div className="space-y-6">
                    <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-200 flex items-center justify-center font-bold text-white text-2xl shadow-lg border-2 border-background">
                            {firstChar}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                            <input
                                type="text"
                                name="name"
                                defaultValue={initialName}
                                className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                            <input
                                type="email"
                                name="email"
                                defaultValue={initialEmail}
                                className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Author Identity ─────────────────────────────────────────── */}
            {/*
                These fields replace AI-generated fake author bios.
                They are injected into every blog post as real author attribution.
                Google's E-E-A-T rewards verifiable real-person authorship.
            */}
            <div className="card-surface p-8">
                <h2 className="text-lg font-bold mb-2">Author Identity</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    Your details appear on every blog post. Real authorship improves Google ranking — fake AI personas get penalised.
                </p>
                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Your Role / Title</label>
                        <input
                            type="text"
                            name="authorRole"
                            defaultValue={initialRole}
                            placeholder="e.g. Founder, Fratel Farm Agribusiness"
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Author Bio</label>
                        <textarea
                            name="authorBio"
                            defaultValue={initialBio}
                            rows={3}
                            placeholder="e.g. 5 years running a piggery in Wakiso District. I help Ugandan farmers increase yields without breaking the bank."
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow resize-none"
                        />
                        <p className="text-xs text-muted-foreground">Keep it specific — where you work, how long, what results you&apos;ve achieved.</p>
                    </div>
                </div>
            </div>

            {/* ── Content Grounding ────────────────────────────────────────── */}
            {/*
                These inputs feed directly into AI blog generation.
                The AI uses your real data instead of inventing statistics.
                This is what makes your content impossible to replicate.
            */}
            <div className="card-surface p-8">
                <h2 className="text-lg font-bold mb-2">Content Grounding</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    These details are injected into every blog post you generate. The more specific you are, the better your posts rank — because no AI farm can fake your real numbers.
                </p>
                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">A Real Experience or Result</label>
                        <textarea
                            name="realExperience"
                            defaultValue={initialRealExperience}
                            rows={3}
                            placeholder="e.g. I reduced pig mortality from 12% to 4% in 60 days by switching feed supplier and adding vitamin supplements at week 3."
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow resize-none"
                        />
                        <p className="text-xs text-muted-foreground">A specific story from your work. AI will use this as the case study — not invented data.</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Real Numbers (costs, yields, rates)</label>
                        <textarea
                            name="realNumbers"
                            defaultValue={initialRealNumbers}
                            rows={2}
                            placeholder="e.g. Feed cost UGX 45,000/bag, average yield 80kg/month, FCR 2.1"
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow resize-none"
                        />
                        <p className="text-xs text-muted-foreground">Used verbatim in blog posts. These numbers make your content unique and trustworthy.</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Local Context</label>
                        <input
                            type="text"
                            name="localContext"
                            defaultValue={initialLocalContext}
                            placeholder="e.g. Kampala, Uganda — two rainy seasons April-June and October-November"
                            className="w-full bg-black/50 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                        />
                        <p className="text-xs text-muted-foreground">Your location and context. Local specifics rank better than generic global advice.</p>
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="bg-primary hover:bg-emerald-400 text-primary-foreground px-5 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {isPending ? (
                        <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Saving...</>
                    ) : "Save Changes"}
                </button>
            </div>
        </form>
    );
}