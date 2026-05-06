"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
    { key: "researching",  label: "Researching keywords",      detail: "Pulling GSC data and SERP competitors" },
    { key: "drafting",     label: "Drafting article",           detail: "Generating your AI-optimised content" },
    { key: "fact_check",   label: "Fact checking",              detail: "Scanning for unsourced claims" },
    { key: "schema",       label: "Adding schema markup",       detail: "Injecting JSON-LD for AI citations" },
    { key: "widget",       label: "Creating interactive widget", detail: "Building the embeddable component" },
];

export default function BlogGeneratingPage({
    params,
}: {
    params: Promise<{ blogId: string }>;
}) {
    const { blogId } = use(params);
    const router = useRouter();
    const [status, setStatus] = useState<string>("researching");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const poll = async () => {
            try {
                const res = await fetch(`/api/blogs/${blogId}/status`);
                if (!res.ok) return;
                const data = (await res.json()) as {
                    status: string;
                    generationStep?: string;
                    failReason?: string;
                };
                if (data.status === "PUBLISHED" || data.status === "DRAFT") {
                    router.replace("/dashboard/blogs");
                    return;
                }
                if (data.status === "FAILED") {
                    setError(data.failReason ?? "Generation failed");
                    return;
                }
                setStatus(data.generationStep ?? "researching");
            } catch {
                // keep polling silently
            }
        };

        poll();
        const id = setInterval(poll, 3_000);
        return () => clearInterval(id);
    }, [blogId, router]);

    const currentIdx = STEPS.findIndex((s) => s.key === status);

    return (
        <div className="max-w-lg mx-auto mt-20 px-4">
            <h1 className="text-2xl font-bold tracking-tight mb-2">
                Generating your article
            </h1>
            <p className="text-muted-foreground mb-10 text-sm">
                15 credits have been reserved. This takes 60–120 seconds.
            </p>

            {error ? (
                <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-sm">
                    {error} — your credits have been refunded.
                </div>
            ) : (
                <div className="space-y-4">
                    {STEPS.map((step, idx) => {
                        const done = idx < currentIdx;
                        const active = idx === currentIdx;
                        return (
                            <div key={step.key} className="flex items-start gap-4">
                                <div
                                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-all ${
                                        done
                                            ? "bg-emerald-500/20 text-emerald-400"
                                            : active
                                            ? "border-2 border-brand/40 border-t-brand animate-spin"
                                            : "bg-muted text-muted-foreground/40"
                                    }`}
                                >
                                    {done ? "✓" : active ? "" : idx + 1}
                                </div>
                                <div>
                                    <p
                                        className={`text-sm font-medium ${
                                            active
                                                ? "text-foreground"
                                                : done
                                                ? "text-muted-foreground"
                                                : "text-muted-foreground/40"
                                        }`}
                                    >
                                        {step.label}
                                    </p>
                                    {active && (
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {step.detail}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
