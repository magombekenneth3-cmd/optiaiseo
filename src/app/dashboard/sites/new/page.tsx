"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function NewSiteRegistration() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [mode, setMode] = useState<"REPORT_ONLY" | "FULL_ACCESS">("REPORT_ONLY");
    const [domain, setDomain] = useState("");
    const [domainError, setDomainError] = useState("");
    const [_githubConnected, _setGithubConnected] = useState(false);
    const [submitError, setSubmitError] = useState("");

    // Entity fields — Step 4
    const [niche, setNiche] = useState("");
    const [location, setLocation] = useState("");
    const [services, setServices] = useState("");
    const [targetCustomer, setTargetCustomer] = useState("");

    const [isSubmitting, setIsSubmitting] = useState(false);

    const validateDomain = (str: string) => {
        if (!str) return false;

        // Strip protocol and trailing slash for the regex test
        const domainStr = str.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
        // Regex ensures at least one dot, valid chars, and a 2+ char TLD
        const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/i;

        if (!domainRegex.test(domainStr)) {
            const errorMsg = "Please enter a valid website domain (e.g., example.com)";
            setDomainError(errorMsg);
            toast.error(errorMsg);
            return false;
        }

        let urlStr = str.trim();
        if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
            urlStr = `https://${urlStr}`;
        }

        try {
            new URL(urlStr);
            setDomainError("");
            return true;
        } catch {
            const errorMsg = "Please enter a valid website domain (e.g., example.com)";
            setDomainError(errorMsg);
            toast.error(errorMsg);
            return false;
        }
    };

    const handleNext = () => {
        if (step === 1 && domain) {
            if (validateDomain(domain)) {
                setStep(2);
            }
        }
        else if (step === 2) setStep(3);
        else if (step === 3) setStep(4);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (step < 4) {
            handleNext();
            return;
        }

        setIsSubmitting(true);
        setSubmitError("");
        const { createSite } = await import('@/app/actions/site');
        const result = await createSite({
            domain,
            operatingMode: mode,
            niche: niche || undefined,
            location: location || undefined,
            coreServices: services || undefined,
            targetCustomer: targetCustomer || undefined,
        });

        if (result.success) {
            toast.success("Site registered! Your first audit has been queued — results will appear in the Audits tab within 60 seconds.");
            router.push("/dashboard/sites");
        } else {
            const msg = result.error ?? "Failed to create site. Please try again.";
            setSubmitError(msg);
            toast.error(msg);
            setIsSubmitting(false);
        }
    };

    const TOTAL_STEPS = 4;

    return (
        <div className="flex flex-col gap-8 w-full max-w-3xl mx-auto pt-8">
            <div className="flex items-center gap-4 mb-4 text-muted-foreground text-sm font-medium">
                <Link href="/dashboard/sites" className="hover:text-foreground transition-colors">Sites</Link>
                <span>/</span>
                <span className="text-foreground">Register New</span>
            </div>

            <div className="card-surface p-8 md:p-12">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Register a New Website</h1>
                <p className="text-muted-foreground mb-10">Add your domain to unlock SEO audits, AEO visibility tracking, and daily AI blog generation.</p>

                {submitError && (
                    <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
                        {submitError}
                    </div>
                )}

                {/* Form Progress */}
                <div className="flex items-center gap-2 mb-8">
                    {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                        <div key={i} className={`h-2 flex-1 rounded-full ${step > i ? 'bg-primary' : 'bg-white/10'}`} />
                    ))}
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-8">
                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            <label className="block text-sm font-medium mb-2">Website Domain</label>
                            <input
                                type="text"
                                autoComplete="url"
                                placeholder="https://example.com"
                                value={domain}
                                onChange={(e) => {
                                    setDomain(e.target.value);
                                    if (domainError) setDomainError("");
                                }}
                                onBlur={() => validateDomain(domain)}
                                className={`w-full bg-background/50 border ${domainError ? 'border-rose-500/50 focus:ring-rose-500/50' : 'border-border focus:ring-primary/50'} rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition-all text-white placeholder:text-muted-foreground`}
                            />
                            {domainError && (
                                <p className="mt-2 text-sm text-rose-400 font-medium animate-in fade-in slide-in-from-top-1">
                                    {domainError}
                                </p>
                            )}
                        </div>
                    )}

                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col gap-4">
                            <label className="block text-sm font-medium">Select Operating Mode</label>

                            <div
                                onClick={() => setMode("REPORT_ONLY")}
                                className={`p-5 rounded-xl border ${mode === 'REPORT_ONLY' ? 'border-primary bg-primary/5' : 'border-border bg-muted'} hover:border-primary/50 cursor-pointer transition-all flex gap-4 items-start`}
                            >
                                <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center ${mode === 'REPORT_ONLY' ? 'border-primary' : 'border-white/20'}`}>
                                    {mode === 'REPORT_ONLY' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg mb-1">Report-Only Mode</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">Weekly audits and daily blog drafts. You will need to manually approve blogs and apply code fixes from the PDF reports.</p>
                                </div>
                            </div>

                            <div
                                onClick={() => setMode("FULL_ACCESS")}
                                className={`p-5 rounded-xl border ${mode === 'FULL_ACCESS' ? 'border-primary bg-primary/5 relative overflow-hidden' : 'border-border bg-muted'} hover:border-primary/50 cursor-pointer transition-all flex gap-4 items-start`}
                            >
                                {mode === 'FULL_ACCESS' && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[30px] rounded-full pointer-events-none" />}
                                <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center ${mode === 'FULL_ACCESS' ? 'border-primary' : 'border-white/20'}`}>
                                    {mode === 'FULL_ACCESS' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 w-full">
                                        <h3 className="font-semibold text-lg mb-1">Full Access Mode</h3>
                                        <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-gradient-to-r from-emerald-500 to-blue-500 text-white">Recommended</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed">Let the AI engine auto-apply code fixes via GitHub Pull Requests and auto-publish daily blog content with no manual intervention.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            {mode === "FULL_ACCESS" ? (
                                <div className="flex flex-col gap-6 text-center py-8">
                                    <div className="w-20 h-20 mx-auto rounded-full bg-card border border-border flex items-center justify-center mb-2">
                                        <svg className="w-10 h-10 text-zinc-300" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold mb-2">Connect GitHub Repository</h3>
                                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">Authorize the OptiAISEO to read your source code and open Pull Requests for SEO fixes.</p>
                                    </div>

                                    <div className="flex flex-col items-center gap-4 w-full mt-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setIsSubmitting(true);
                                                const { createSite } = await import('@/app/actions/site');
                                                const result = await createSite({
                                                    domain,
                                                    operatingMode: mode,
                                                    niche: niche || undefined,
                                                    location: location || undefined,
                                                    coreServices: services || undefined,
                                                    targetCustomer: targetCustomer || undefined,
                                                });
                                                if (result.success && result.site) {
                                                    const { signIn } = await import("next-auth/react");
                                                    signIn("github", { callbackUrl: `/dashboard/sites/${result.site.id}?setup_github=true` });
                                                } else {
                                                    toast.error("Failed to create site before GitHub auth");
                                                    setIsSubmitting(false);
                                                }
                                            }}
                                            disabled={isSubmitting}
                                            className="w-full sm:w-auto mx-auto px-8 py-3 rounded-xl bg-white text-black font-semibold hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                                            {isSubmitting ? "Saving..." : "Authenticate with GitHub"}
                                        </button>
                                        <div className="pt-6 mt-2 border-t border-border w-full">
                                            <button
                                                type="button"
                                                onClick={handleNext}
                                                className="text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                            >
                                                Skip — add entity info first →
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-6 text-center py-8">
                                    <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mb-2">
                                        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold mb-2">Almost There</h3>
                                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                            One more step — tell us what your site does so the AI can build entity-first content from day one.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleNext}
                                        className="w-full sm:w-auto mx-auto px-10 py-3.5 rounded-xl bg-primary hover:bg-emerald-400 text-primary-foreground font-semibold text-lg transition-colors shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
                                    >
                                        Continue →
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 4 — Entity Data */}
                    {step === 4 && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col gap-5">
                            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-sm text-purple-300">
                                <strong>Entity-First SEO</strong> — this data feeds your Knowledge Graph, AEO audits, and service page generator.
                                You can update it anytime in Site Settings.
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    What industry or niche is this site in?
                                </label>
                                <input
                                    id="entity-niche"
                                    placeholder="e.g. Digital Marketing Agency, E-commerce Store, Law Firm"
                                    value={niche}
                                    onChange={e => setNiche(e.target.value)}
                                    className="w-full bg-background/50 border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Location served
                                </label>
                                <input
                                    id="entity-location"
                                    placeholder="e.g. London, UK — or Global / Remote"
                                    value={location}
                                    onChange={e => setLocation(e.target.value)}
                                    className="w-full bg-background/50 border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Core services <span className="text-muted-foreground font-normal">(comma-separated)</span>
                                </label>
                                <textarea
                                    id="entity-services"
                                    placeholder="e.g. SEO Audits, Content Writing, Technical SEO, Link Building"
                                    value={services}
                                    onChange={e => setServices(e.target.value)}
                                    rows={3}
                                    className="w-full bg-background/50 border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Each service will become a separate page entity in your SEO strategy.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Target customer <span className="text-muted-foreground font-normal">(optional)</span>
                                </label>
                                <input
                                    id="entity-target-customer"
                                    placeholder="e.g. Small e-commerce businesses, B2B SaaS companies"
                                    value={targetCustomer}
                                    onChange={e => setTargetCustomer(e.target.value)}
                                    className="w-full bg-background/50 border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                />
                            </div>
                            <button
                                type="submit"
                                id="complete-registration-btn"
                                disabled={isSubmitting}
                                className="w-full sm:w-auto px-10 py-3.5 rounded-xl bg-primary hover:bg-emerald-400 text-primary-foreground font-semibold text-lg transition-colors shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? "Registering…" : "Complete Registration"}
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    setIsSubmitting(true);
                                    setSubmitError("");
                                    const { createSite } = await import('@/app/actions/site');
                                    const result = await createSite({ domain, operatingMode: mode });
                                    if (result.success) {
                                        toast.success("Site registered! Running initial audit…");
                                        router.push("/dashboard/sites");
                                    } else {
                                        const msg = result.error ?? "Failed to create site.";
                                        setSubmitError(msg);
                                        toast.error(msg);
                                        setIsSubmitting(false);
                                    }
                                }}
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
                            >
                                Skip — I&apos;ll add entity data later
                            </button>
                        </div>
                    )}

                    {/* Navigation footer */}
                    {step < 4 && step !== 3 && (
                        <div className="flex items-center justify-between pt-6 border-t border-border mt-4">
                            {step > 1 ? (
                                <button
                                    type="button"
                                    onClick={() => setStep(step - 1)}
                                    className="px-6 py-2.5 rounded-lg font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                                >
                                    Back
                                </button>
                            ) : <div />}

                            <button
                                type="button"
                                onClick={handleNext}
                                disabled={step === 1 && !domain}
                                className="px-6 py-2.5 rounded-lg bg-foreground text-background font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Continue
                            </button>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="flex items-center justify-start pt-0 border-t border-border -mt-4">
                            <button
                                type="button"
                                onClick={() => setStep(3)}
                                className="px-6 py-2.5 rounded-lg font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                            >
                                Back
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}
