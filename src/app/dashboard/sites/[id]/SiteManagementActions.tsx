"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { deleteSite, saveHashnodeToken, saveCoreServices, saveGithubRepo, saveBlogTone, saveTechStack, saveBrandName } from "@/app/actions/site";
import { toast } from "sonner";


export function SiteManagementActions({
    siteId,
    domain,
    initialGithubRepoUrl,
    initialHashnodeToken,
    initialHashnodePublicationId,
    initialCoreServices,
    initialTechStack,
    initialBlogTone,
    initialBrandName,
    githubOAuthConnected = false,
    userRole = "AGENCY_ADMIN"
}: {
    siteId: string,
    domain: string,
    initialGithubRepoUrl?: string | null,
    initialHashnodeToken?: string | null,
    initialHashnodePublicationId?: string | null,
    initialCoreServices?: string | null,
    initialTechStack?: string | null,
    initialBlogTone?: string | null,
    initialBrandName?: string | null,
    githubOAuthConnected?: boolean,
    userRole?: string
}) {
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);

    const [githubRepoUrl, setGithubRepoUrl] = useState(initialGithubRepoUrl || "");
    const [isSavingGithub, setIsSavingGithub] = useState(false);
    const [isConnectingGithub, setIsConnectingGithub] = useState(false);

    const [hashnodeToken, setHashnodeToken] = useState(initialHashnodeToken || "");
    const [hashnodePublicationId, setHashnodePublicationId] = useState(initialHashnodePublicationId || "");
    const [isSavingToken, setIsSavingToken] = useState(false);

    const [coreServices, setCoreServices] = useState(initialCoreServices || "");
    const [_isSavingServices, setIsSavingServices] = useState(false);

    const [techStack, setTechStack] = useState(initialTechStack || "nextjs");
    const [isSavingStack, setIsSavingStack] = useState(false);

    const [blogTone, setBlogTone] = useState(initialBlogTone || "Authoritative & Professional");
    const [isSavingTone, setIsSavingTone] = useState(false);

    const [brandName, setBrandName] = useState(initialBrandName || "");
    const [isSavingBrand, setIsSavingBrand] = useState(false);

    useEffect(() => {
        if (showModal) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [showModal]);

    const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);

        const deleteResult = await deleteSite(siteId);

        if (deleteResult.success) {
            router.push("/dashboard/sites");
            router.refresh();
        } else {
            setError(deleteResult.error || "Failed to delete site.");
            setIsDeleting(false);
            setShowModal(false);
        }
    };

    /**
     * Save (or clear) the GitHub repo URL.
     * Accepts an explicit `urlOverride` so the disconnect path can pass ""
     * directly without depending on React state flushing first.
     */
    const handleSaveGithub = async (urlOverride?: string) => {
        setIsSavingGithub(true);
        const urlToSave = urlOverride !== undefined ? urlOverride : githubRepoUrl;
        const githubResult = await saveGithubRepo(siteId, urlToSave);
        setIsSavingGithub(false);
        if (githubResult.success) {
            toast.success(urlToSave.trim() ? "GitHub repository connected!" : "GitHub repository disconnected.");
            router.refresh();
        } else {
            toast.error(githubResult.error || "Failed to save GitHub repository.");
        }
    };

    const handleSaveHashnodeToken = async () => {
        setIsSavingToken(true);
        const hashnodeResult = await saveHashnodeToken(siteId, hashnodeToken, hashnodePublicationId);
        setIsSavingToken(false);
        if (hashnodeResult.success) {
            toast.success("Hashnode settings saved successfully.");
        } else {
            toast.error(hashnodeResult.error || "Failed to save Hashnode settings.");
        }
    };

    const _handleSaveCoreServices = async () => {
        setIsSavingServices(true);
        const coreResult = await saveCoreServices(siteId, coreServices);
        setIsSavingServices(false);
        if (coreResult.success) {
            toast.success("Core services saved successfully.");
        } else {
            toast.error(coreResult.error || "Failed to save core services.");
        }
    };

    const handleSaveBlogTone = async () => {
        setIsSavingTone(true);
        const toneResult = await saveBlogTone(siteId, blogTone);
        setIsSavingTone(false);
        if (toneResult.success) {
            toast.success("Blog tone saved successfully.");
        } else {
            toast.error(toneResult.error || "Failed to save blog tone.");
        }
    };

    const handleSaveTechStack = async () => {
        setIsSavingStack(true);
        const stackResult = await saveTechStack(siteId, techStack);
        setIsSavingStack(false);
        if (stackResult.success) {
            toast.success("Tech stack saved!");
            router.refresh();
        } else {
            toast.error(stackResult.error || "Failed to save tech stack.");
        }
    };

    const handleSaveBrandName = async () => {
        setIsSavingBrand(true);
        const result = await saveBrandName(siteId, brandName);
        setIsSavingBrand(false);
        if (result.success) {
            toast.success("Brand name saved — re-run AEO Scan to see updated scores.");
            router.refresh();
        } else {
            toast.error(result.error || "Failed to save brand name.");
        }
    };

    const isGithubConnected = !!initialGithubRepoUrl;

    return (
        <div className="flex flex-col gap-6">
            {/* GitHub Integration */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    GitHub Integration
                    {isGithubConnected && (
                        <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                            ✓ Connected
                        </span>
                    )}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Connect your GitHub repository to enable nightly AI auto-fix Pull Requests. The AI will scan your site, find SEO issues, and open a PR with the generated fixes — ready for your review.
                </p>

                {/* ── Step 1: GitHub OAuth ───────────────────────────────────────── */}
                <div className="mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Step 1 — Authorize GitHub</p>
                    {githubOAuthConnected ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            <span className="text-xs text-emerald-400 font-semibold">GitHub account authorized</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">OAuth token stored</span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <span className="text-xs text-amber-300">GitHub account not connected — auto-PRs won&apos;t work without this.</span>
                            </div>
                            <button
                                onClick={async () => {
                                    setIsConnectingGithub(true);
                                    await signIn("github", { callbackUrl: window.location.href });
                                }}
                                disabled={isConnectingGithub}
                                className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white text-sm font-semibold transition-all disabled:opacity-50"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                                {isConnectingGithub ? "Redirecting to GitHub…" : "Connect GitHub Account"}
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Step 2: Repo URL ───────────────────────────────────────────── */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Step 2 — Set Repository URL</p>

                {isGithubConnected && (
                    <div className="mb-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
                        <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground mb-0.5">Connected repository</p>
                            <a
                                href={initialGithubRepoUrl!}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-white hover:text-emerald-400 transition-colors font-medium truncate block"
                            >
                                {initialGithubRepoUrl!.replace("https://github.com/", "")}
                            </a>
                        </div>
                        <div className="ml-auto shrink-0 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                            🤖 Auto-PRs On
                        </div>
                    </div>
                )}

                {userRole === "AGENCY_ADMIN" && (

                    <div className="flex flex-col gap-3">
                        <input
                            type="url"
                            value={githubRepoUrl}
                            onChange={(e) => setGithubRepoUrl(e.target.value)}
                            placeholder="https://github.com/your-username/your-repo"
                            className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleSaveGithub()}
                                disabled={isSavingGithub}
                                className="flex-1 bg-muted hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                </svg>
                                {isSavingGithub ? "Saving..." : (isGithubConnected ? "Update Repository" : "Connect Repository")}
                            </button>
                            {isGithubConnected && (
                                <button
                                    onClick={async () => {
                                        // Pass "" explicitly — do NOT rely on state flushing
                                        // before the async save call reads it.
                                        setGithubRepoUrl("");
                                        await handleSaveGithub("");
                                    }}
                                    disabled={isSavingGithub}
                                    className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-rose-500/20 text-rose-400 hover:bg-rose-500/10"
                                    title="Disconnect repository"
                                >
                                    Disconnect
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Requires a <code className="text-zinc-500">GITHUB_TOKEN</code> env var with <code className="text-zinc-500">repo</code> scope set in the platform to enable automated PRs.
                        </p>
                    </div>
                )}
            </div>

            {/* Brand Display Name */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    🏷️ Brand Display Name
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Override how AI detects your brand. By default we derive it from your domain (e.g.
                    <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-zinc-300 text-xs font-mono">searchatlas.com</code>
                    → <span className="text-zinc-300 font-medium">Searchatlas</span>). If AI knows you by a
                    different name — e.g. <span className="text-zinc-300 font-medium">Search Atlas</span> — enter it here.
                </p>
                <div className="flex flex-col gap-3">
                    <div className="relative">
                        <input
                            type="text"
                            value={brandName}
                            onChange={(e) => setBrandName(e.target.value)}
                            placeholder={`e.g. ${domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1)}`}
                            maxLength={100}
                            className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none pr-24"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums">
                            {brandName.length}/100
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                            {brandName.trim()
                                ? <>AI will be asked about <span className="text-white font-medium">&ldquo;{brandName.trim()}&rdquo;</span> — leave blank to use the auto-derived name.</>
                                : <>Leave blank to auto-derive from domain.</>}
                        </p>
                        <button
                            onClick={handleSaveBrandName}
                            disabled={isSavingBrand}
                            className="shrink-0 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/30"
                        >
                            {isSavingBrand ? "Saving..." : "Save"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Core Services Integration */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    🎯 Core Roles & Services
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Define the core purpose, products, or services of your website. This directly improves the AEO audits by targeting the things you want AI Answer Engines to actually know about you. E.g. &quot;B2B SaaS for HR Management&quot;, &quot;Local plumbing services in Seattle&quot;.
                </p>
                {userRole === "AGENCY_ADMIN" ? (
                    <div className="flex flex-col gap-3">
                        <textarea
                            value={coreServices}
                            onChange={(e) => setCoreServices(e.target.value)}
                            placeholder="e.g. We provide enterprise SEO automation and AI content services..."
                            rows={3}
                            maxLength={2000}
                            className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none resize-y"
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{coreServices.length}/2000</span>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 rounded-lg bg-card border border-border text-sm text-zinc-300">
                        {coreServices || "No core services defined for this site."}
                    </div>
                )}
            </div>

            {/* Tech Stack */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    🛠️ Tech Stack / Framework
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Tell the AI Fix Assistant what framework this site uses. Fixes will only reference files that exist in your chosen stack — no more Next.js-specific files if you&apos;re using Vue or plain HTML.
                </p>
                {userRole === "AGENCY_ADMIN" ? (
                    <div className="flex flex-col gap-3">
                        <select
                            value={techStack}
                            onChange={(e) => setTechStack(e.target.value)}
                            className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white outline-none appearance-none"
                            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.4-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7rem top 50%', backgroundSize: '.65rem auto' }}
                        >
                            <option value="nextjs">Next.js (App Router)</option>
                            <option value="react-vite">React + Vite / CRA</option>
                            <option value="vue">Vue 3 + Vite</option>
                            <option value="nuxt">Nuxt.js</option>
                            <option value="angular">Angular</option>
                            <option value="html">Plain HTML / Static</option>
                            <option value="wordpress">WordPress</option>
                            <option value="other">Other / Unknown</option>
                        </select>
                        <div className="flex items-center justify-end">
                            <button
                                onClick={handleSaveTechStack}
                                disabled={isSavingStack}
                                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/30"
                            >
                                {isSavingStack ? "Saving..." : "Save Stack"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 rounded-lg bg-card border border-border text-sm text-zinc-300">
                        {techStack || "Not specified"}
                    </div>
                )}
            </div>

            {/* AI Blog Tone Integration */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    ✍️ AI Tone of Voice
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    Select the writing style for auto-generated blogs. This instructs the AI to adopt a specific personality and vocabulary that aligns with your brand.
                </p>
                {userRole === "AGENCY_ADMIN" ? (
                    <div className="flex flex-col gap-3">
                        <select
                            value={blogTone}
                            onChange={(e) => setBlogTone(e.target.value)}
                            className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white outline-none appearance-none"
                            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.4-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7rem top 50%', backgroundSize: '.65rem auto' }}
                        >
                            <option value="Authoritative & Professional">Authoritative & Professional</option>
                            <option value="Conversational & Friendly">Conversational & Friendly</option>
                            <option value="Academic & Detailed">Academic & Detailed</option>
                            <option value="Humorous & Witty">Humorous & Witty</option>
                            <option value="Empathetic & Supportive">Empathetic & Supportive</option>
                            <option value="Edgy & Disruptive">Edgy & Disruptive</option>
                            <option value="Luxury & Exclusive">Luxury & Exclusive</option>
                        </select>
                        <div className="flex items-center justify-end">
                            <button
                                onClick={handleSaveBlogTone}
                                disabled={isSavingTone}
                                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/30"
                            >
                                {isSavingTone ? "Saving..." : "Save Tone"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 rounded-lg bg-card border border-border text-sm text-zinc-300">
                        {blogTone}
                    </div>
                )}
            </div>

            {/* Hashnode Integration */}
            <div className="card-surface p-6 border-border hover:border-white/20 transition-all duration-300 relative overflow-hidden group bg-gradient-to-br from-white/[0.02] to-transparent">
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    {/* Hashnode logo mark */}
                    <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 337 337" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M23.155 112.598c-30.873 30.874-30.873 80.93 0 111.804l89.443 89.443c30.874 30.873 80.93 30.873 111.804 0l89.443-89.443c30.873-30.874 30.873-80.93 0-111.804l-89.443-89.443c-30.874-30.873-80.93-30.873-111.804 0l-89.443 89.443zm184.476 95.033c22.398-22.398 22.398-58.7 0-81.098-22.397-22.398-58.7-22.398-81.097 0-22.398 22.397-22.398 58.7 0 81.098 22.397 22.397 58.7 22.397 81.097 0z" />
                    </svg>
                    Hashnode Publishing
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                    By default, approved blogs are syndicated to our platform&apos;s central Hashnode account — no setup required.
                    You can optionally override this with your own Hashnode credentials to publish under your personal account.
                    Get a free token at{" "}
                    <a
                        href="https://hashnode.com/settings/developer"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
                    >
                        hashnode.com/settings/developer
                    </a>
                </p>
                {userRole === "AGENCY_ADMIN" ? (
                    <div className="flex flex-col gap-3">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Personal Access Token (PAT)</label>
                            <input
                                type="password"
                                value={hashnodeToken}
                                onChange={(e) => setHashnodeToken(e.target.value)}
                                placeholder="Your Hashnode PAT (optional — leave blank to use platform default)"
                                className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Publication ID <span className="text-muted-foreground">(optional — leave blank to auto-discover from token)</span></label>
                            <input
                                type="text"
                                value={hashnodePublicationId}
                                onChange={(e) => setHashnodePublicationId(e.target.value)}
                                placeholder="e.g. 6769f1a59c13c4f98d3b7a2e"
                                className="w-full bg-background/50 border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-lg px-4 py-2.5 text-sm transition-all text-white placeholder:text-muted-foreground outline-none font-mono"
                            />
                            <p className="text-xs text-muted-foreground mt-1">Find your Publication ID at <a href="https://hashnode.com" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground hover:underline">Hashnode</a> → Your Blog → Settings → Domain & SEO → Publication ID.</p>
                        </div>
                        <button
                            onClick={handleSaveHashnodeToken}
                            disabled={isSavingToken}
                            className="w-full bg-muted hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-border"
                        >
                            {isSavingToken ? "Saving..." : "Save Hashnode Settings"}
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground italic">Integration settings are managed by the site owner.</p>
                )}
            </div>

            {/* Danger Zone */}
            {userRole === "AGENCY_ADMIN" && (
                <div className="card-surface p-6 border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all duration-300 h-fit relative overflow-hidden group">
                    <h3 className="text-xl font-semibold mb-2 text-rose-500 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        Danger Zone
                    </h3>
                    <p className="text-sm text-rose-200/60 mb-6">
                        Permanently remove this site and all of its associated data from the platform. This action cannot be undone.
                    </p>

                    {error && (
                        <div className="mb-4 p-3 text-sm text-rose-500 bg-rose-500/10 rounded-md border border-rose-500/20">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={() => setShowModal(true)}
                        disabled={isDeleting}
                        className="w-full bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-rose-500/30 hover:border-transparent flex justify-center items-center gap-2"
                    >
                        {isDeleting ? "Deleting..." : "Delete Site"}
                    </button>
                </div>
            )}
            {/* Delete confirmation modal — rendered via portal at document.body to
                escape any ancestor transform/filter stacking context */}
            {showModal && typeof document !== "undefined" && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
                >
                    <div
                        className="rounded-2xl border border-zinc-700 w-full max-w-md p-6 shadow-2xl"
                        style={{ backgroundColor: "#0f0f0f" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(239,68,68,0.1)" }}>
                            <svg className="w-6 h-6 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold mb-2 text-white">Delete {domain}?</h2>
                        <p className="text-zinc-400 text-sm mb-6">
                            Are you absolutely sure? This will permanently remove all associated Audit Reports, Keyword Tracking, and Blog Posts. This action cannot be undone.
                        </p>
                        {error && (
                            <div className="mb-4 p-3 text-sm text-rose-400 rounded-md border border-rose-500/20" style={{ backgroundColor: "rgba(239,68,68,0.1)" }}>
                                {error}
                            </div>
                        )}
                        <div className="flex items-center gap-3 w-full">
                            <button
                                onClick={() => setShowModal(false)}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 transition-colors font-medium text-sm text-zinc-300 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="flex-1 flex justify-center items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
                            >
                                {isDeleting ? (
                                    <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Deleting…</>
                                ) : "Yes, Delete Site"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}