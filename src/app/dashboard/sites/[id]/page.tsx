/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSite } from "@/app/actions/site";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteManagementActions } from "./SiteManagementActions";
import { CompetitorsPanel } from "./CompetitorsPanel";
import { PredictiveAlertsSection } from "./PredictiveAlertsSection";
import AutopilotSection from "./AutopilotSection";
import KnowledgeGraphEditor from "@/components/aeo/KnowledgeGraphEditor";
import { EntityPanel } from "./EntityPanel";
import { PageDiscoveryPanel } from "./PageDiscoveryPanel";
import { ArrowLeft, GitBranch, Bot, TrendingUp, ClipboardList, CheckCircle, AlertTriangle, Zap } from "lucide-react";
import { getSiteBenchmarkContext } from "@/app/actions/benchmarks";
import { BenchmarkPanel, BenchmarkPlaceholder } from "@/components/dashboard/BenchmarkPanel";
import { CacheStatsWidget } from "@/components/dashboard/CacheStatsWidget";
import { ContentDecayPanel } from "@/components/dashboard/ContentDecayPanel";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";


export const metadata: Metadata = {
    title: 'Site Details | OptiAISEO',
    description: 'Manage your website integration and settings.',
};

export default async function SiteDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const siteResult = await getSite(id);
    const benchmarkContext = siteResult.success && siteResult.site ? await getSiteBenchmarkContext(siteResult.site.id) : null;

    // Check if the user has GitHub OAuth connected (needed for auto-fix PRs)
    let githubOAuthConnected = false;
    try {
        const session = await getServerSession(authOptions);
        if (session?.user?.email) {
            const ghAccount = await prisma.account.findFirst({
                where: {
                    user: { email: session.user.email },
                    provider: "github",
                },
                select: { id: true },
            });
            githubOAuthConnected = !!ghAccount;
        }
    } catch { /* non-fatal — default false */ }

    if (!siteResult.success) {
        if (siteResult.error === "Site not found") {
            notFound();
        }
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <div className="p-4 bg-rose-500/10 text-rose-500 rounded-xl border border-rose-500/20">
                    <p>{siteResult.error || "An error occurred while loading this site."}</p>
                </div>
                <Link href="/dashboard/sites" className="text-emerald-400 hover:underline">
                    &larr; Return to Sites
                </Link>
            </div>
        );
    }

    const { site, userRole } = siteResult;

    return (
        <div className="flex flex-col gap-8 w-full max-w-4xl mx-auto fade-in-up">
            {/* Header */}
            <div>
                <Link href="/dashboard/sites" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-emerald-400 mb-4 transition-colors">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to all sites
                </Link>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-3">
                            {site.domain}
                            <span className={`status-pill text-xs ${site.operatingMode === 'FULL_ACCESS'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : 'bg-zinc-500/10 text-muted-foreground border-zinc-500/20'
                                }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${site.operatingMode === 'FULL_ACCESS' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                                    }`} />
                                {site.operatingMode === 'FULL_ACCESS' ? 'Full Access' : 'Report Only'}
                            </span>
                        </h1>
                        <p className="text-muted-foreground text-sm">Registered {new Date(site.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                    </div>
                </div>
            </div>

            <PageDiscoveryPanel siteId={site.id} domain={site.domain} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Integration Details Panel */}
                <div className="md:col-span-2 flex flex-col gap-6">
                    <AutopilotSection siteId={site.id} initialMode={site.operatingMode} />
                    <KnowledgeGraphEditor siteId={site.id} domain={site.domain} />
                    <PredictiveAlertsSection siteId={site.id} />

                    <div className="card-surface p-6">
                        <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
                            <GitBranch className="w-4 h-4 text-emerald-400" />
                            GitHub Integration
                        </h2>
                        {site.githubRepoUrl ? (
                            <div className="space-y-4">
                                <div className="p-4 rounded-lg bg-muted border border-border flex items-center justify-between">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm text-muted-foreground">Connected Repository</span>
                                        <a href={site.githubRepoUrl} target="_blank" rel="noreferrer" className="text-white hover:text-emerald-400 font-medium transition-colors">
                                            {site.githubRepoUrl.split('/').slice(-2).join('/')}
                                        </a>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                                            <CheckCircle className="w-3 h-3" /> Connected
                                        </div>
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
                                            <Bot className="w-3 h-3" /> Auto-PRs Active
                                        </div>
                                    </div>
                                </div>
                                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/15 text-sm text-blue-200/70">
                                    Every night, the AI scans your site for SEO issues and automatically opens a Pull Request with generated fixes. Just review and click <span className="font-semibold text-blue-300">Merge</span> on GitHub.
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
                                    No GitHub repository connected. Paste your repo URL in Site Settings to enable nightly AI auto-fix Pull Requests.
                                </div>
                            </div>
                        )}

                        <div className="mt-6 pt-6 border-t border-border">
                            <h3 className="text-lg font-medium mb-2">Operation Mode</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                {site.operatingMode === 'FULL_ACCESS'
                                    ? "Full Access mode allows the application to directly publish content and apply code patches."
                                    : "Report Only mode restricts the application from making any mutations to your live site or codebase. You must manually approve all generated content."}
                            </p>
                        </div>
                    </div>

                    {/* Competitors Integration Panel */}
                    <CompetitorsPanel siteId={site.id} initialCompetitors={(site as any).competitors} userRole={userRole} />
                </div>

                {/* Quick Actions */}
                <div className="md:col-span-1 flex flex-col gap-6">
                    {/* AEO Card */}
                    <div className="card-surface p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4 text-emerald-400" />
                            </div>
                            <h2 className="text-sm font-semibold">AEO Optimization</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            Check how well this site appears in AI answer engines — structured data, E-E-A-T signals, and content formatting.
                        </p>
                        <Link
                            href={`/dashboard/sites/${site.id}/aeo`}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-semibold hover:bg-emerald-500/20 transition-all w-full justify-center"
                        >
                            Run AEO Audit →
                        </Link>
                        <CacheStatsWidget domain={site.domain} />
                    </div>

                    {/* Keywords Card */}
                    <div className="card-surface p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                                <TrendingUp className="w-4 h-4 text-blue-400" />
                            </div>
                            <h2 className="text-sm font-semibold">Keywords</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            View keyword rankings, opportunities, and generate content targeted to this site.
                        </p>
                        <Link
                            href={`/dashboard/keywords?siteId=${site.id}`}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-500/20 transition-all w-full justify-center"
                        >
                            View Keywords →
                        </Link>
                    </div>

                    {/* Audits Card */}
                    <div className="card-surface p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                                <ClipboardList className="w-4 h-4 text-purple-400" />
                            </div>
                            <h2 className="text-sm font-semibold">Audit Reports</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            Run a full technical SEO audit and review issues found by the autonomous engine.
                        </p>
                        <Link
                            href={`/dashboard/audits?siteId=${site.id}`}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-lg text-xs font-semibold hover:bg-purple-500/20 transition-all w-full justify-center"
                        >
                            View Audits →
                        </Link>
                    </div>

                    {/* Healing Log Card */}
                    <div className="card-surface p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <Zap className="w-4 h-4 text-emerald-400" />
                            </div>
                            <h2 className="text-sm font-semibold">Self-Healing Log</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            Full audit trail of every automated fix applied by the AI engine — with before/after score impact.
                        </p>
                        <Link
                            href={`/dashboard/sites/${site.id}/healing-log`}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-semibold hover:bg-emerald-500/20 transition-all w-full justify-center"
                        >
                            View Healing Log →
                        </Link>
                    </div>

                    <ContentDecayPanel siteId={site.id} />

                    <EntityPanel siteId={site.id} />

                    {/* Industry Benchmark */}
                    <div className="card-surface p-5">
                        {benchmarkContext ? (
                            <BenchmarkPanel context={benchmarkContext} />
                        ) : (
                            <BenchmarkPlaceholder niche={(site as any).niche} techStack={(site as any).techStack} />
                        )}
                    </div>

                    <SiteManagementActions siteId={site.id} domain={site.domain} initialGithubRepoUrl={site.githubRepoUrl} initialHashnodeToken={site.hashnodeToken} initialHashnodePublicationId={site.hashnodePublicationId} initialCoreServices={site.coreServices} initialTechStack={(site as any).techStack} initialBlogTone={site.blogTone} initialBrandName={(site as any).brandName ?? null} githubOAuthConnected={githubOAuthConnected} userRole={userRole} />

                </div>
            </div>
        </div>
    );
}
