import { Metadata } from "next";
import { Suspense } from "react";
import { getUserBlogs } from "@/app/actions/blog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BlogList } from "./BlogList";

import { GenerateBlogButton } from "./GenerateBlogButton";
import { ContentPipelineWrapper, ContentPipelineWithList } from "./ContentPipelineWrapper";
import { ActiveGenerationCard } from "./ActiveGenerationCard";
import { ContentHealthRow } from "./ContentHealthRow";
import {
    ArrowRight,
    FileText,
    Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
    title: "Content | OptiAISEO",
    description: "Create content built for search and AI answers.",
};

export default async function BlogsPage({
    searchParams,
}: {
    searchParams: Promise<{ keyword?: string; review?: string }>;
}) {
    const params = await searchParams;

    const rawKeyword = params.keyword ?? "";
    const initialKeyword =
        rawKeyword
            .replace(/[\x00-\x1F\x7F]/g, "")
            .trim()
            .slice(0, 120) || undefined;

    const rawReview = params.review ?? "";
    const initialReviewId = /^[a-zA-Z0-9_-]{1,40}$/.test(rawReview)
        ? rawReview
        : undefined;

    const [{ success, blogs, subscriptionTier }, session] = await Promise.all([
        getUserBlogs(),
        getServerSession(authOptions),
    ]);

    const primarySite = session?.user?.email
        ? await prisma.site.findFirst({
            where: { user: { email: session.user.email } },
            orderBy: { createdAt: "desc" },
            select: { id: true, domain: true },
        })
        : null;

    const content = blogs ?? [];
    const totalCount = content.length;

    /* ── Pipeline counts ─────────────────────────────────────────── */

    const writingCount = content.filter(
        (b) => b.status === "GENERATING" || b.status === "QUEUED" || b.status === "PENDING" || b.status === "DRAFT"
    ).length;

    const evidenceCount = content.filter(
        (b) => b.status === "EVIDENCE_REVIEW"
    ).length;

    const reviewCount = content.filter(
        (b) => b.status === "REVIEW" || b.status === "NEEDS_REVIEW" || b.status === "REJECTED"
    ).length;

    const readyCount = content.filter(
        (b) => b.status === "DRAFT" &&
            b.validationScore != null &&
            Number(b.validationScore) >= 60
    ).length;

    const publishedCount = content.filter(
        (b) => b.status === "PUBLISHED"
    ).length;

    const issuesCount = content.filter((b) => {
        const hasErrors = Array.isArray(b.validationErrors) && b.validationErrors.length > 0;
        const lowScore = b.validationScore != null && Number(b.validationScore) < 60;
        return hasErrors || lowScore || b.status === "FAILED" || b.status === "REJECTED";
    }).length;

    const pipelineCounts = {
        total: totalCount,
        writing: writingCount,
        evidence: evidenceCount,
        review: reviewCount,
        ready: readyCount,
        published: publishedCount,
        issues: issuesCount,
    };

    /* ── Generating blogs (full objects for ActiveGenerationCard) ─ */

    const generatingBlogs = content
        .filter(
            (b) => b.status === "GENERATING" || b.status === "QUEUED" || b.status === "PENDING"
        )
        .map((b) => ({
            id: b.id as string,
            title: b.title,
            targetKeywords: b.targetKeywords,
            createdAt: b.createdAt,
        }));

    const generatingIds = generatingBlogs.map((b) => b.id);

    /* ── AI opportunity count ────────────────────────────────────── */

    const aiOpportunityCount = content.filter(
        (b) => b.citationScore != null && Number(b.citationScore) < 70 &&
            b.status !== "GENERATING" && b.status !== "FAILED"
    ).length;

    /* ── Generate button ─────────────────────────────────────────── */

    const canGenerate = Boolean(subscriptionTier);

    const generateControl = canGenerate && primarySite ? (
        <GenerateBlogButton
            siteId={primarySite.id}
            siteDomain={primarySite.domain}
            initialKeyword={initialKeyword}
        />
    ) : canGenerate ? (
        <Link
            href="/dashboard/sites/new"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-400"
        >
            Add a site
        </Link>
    ) : (
        <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground"
        >
            Sign in to generate
        </Link>
    );

    /* ── Monthly usage (for subtle upgrade bar) ──────────────────── */

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const postsThisMonth = content.filter(
        (b) => new Date(b.createdAt) >= startOfMonth
    ).length;

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            {/* BlogPoller disabled — ActiveGenerationCard handles polling every 3s */}

            {/* ── ZONE 1: Header ─────────────────────────────────── */}
            <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Content
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Create content built for search and AI answers.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Subtle usage indicator */}
                    {subscriptionTier === "FREE" && (
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                            <span>{postsThisMonth} of 3 used</span>
                            <Link
                                href="/dashboard/billing"
                                className="font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                            >
                                Upgrade →
                            </Link>
                        </div>
                    )}
                    {generateControl}
                </div>
            </section>

            {/* ── ZONE 3: Active Generation + AI Visibility ──────── */}
            {(generatingBlogs.length > 0 || aiOpportunityCount > 0) && (
                <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
                    {generatingBlogs.length > 0 ? (
                        <ActiveGenerationCard generatingBlogs={generatingBlogs} />
                    ) : (
                        <div />
                    )}

                    {aiOpportunityCount > 0 && (
                        <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/[0.08] via-card to-card p-5">
                            <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-purple-500/10 blur-3xl" />
                            <div className="relative flex h-full flex-col">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-300">
                                            <Sparkles className="h-3.5 w-3.5" />
                                        </div>
                                        <span className="text-xs font-semibold text-foreground">
                                            AI Visibility Opportunity
                                        </span>
                                    </div>
                                    <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-300">
                                        Insight
                                    </span>
                                </div>

                                <p className="mt-4 flex-1 text-xs leading-5 text-muted-foreground">
                                    {aiOpportunityCount} article{aiOpportunityCount !== 1 ? "s" : ""} could improve{" "}
                                    {aiOpportunityCount !== 1 ? "their" : "its"} chances of being understood and
                                    cited by AI search systems.
                                </p>

                                <ul className="mt-3 space-y-1">
                                    {["Improve answer structure", "Add entity coverage", "Strengthen supporting evidence"].map((item) => (
                                        <li key={item} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                            <span className="h-1 w-1 rounded-full bg-purple-400" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    href="/dashboard/aeo"
                                    className="mt-4 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-purple-300 transition-colors hover:text-purple-200"
                                >
                                    Review {aiOpportunityCount} opportunities
                                    <ArrowRight className="h-3 w-3" />
                                </Link>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* ── ZONE 4: Content Health KPIs ─────────────────────── */}
            {totalCount > 0 && (
                <ContentHealthRow blogs={content} />
            )}

            {/* ── ZONE 2 + 5: Content Pipeline + Library ─────────── */}
            {totalCount === 0 ? (
                <>
                    <ContentPipelineWrapper counts={pipelineCounts} />
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
                        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/10 bg-emerald-500/10">
                            <FileText className="h-7 w-7 text-emerald-400" />
                        </div>

                        <h2 className="text-xl font-bold tracking-tight text-foreground">
                            Build your content library
                        </h2>

                        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                            Generate your first SEO article and start building
                            content that can rank in search and become visible in
                            AI answers.
                        </p>

                        <div className="mt-6">
                            {canGenerate && primarySite ? (
                                <GenerateBlogButton
                                    siteId={primarySite.id}
                                    siteDomain={primarySite.domain}
                                    initialKeyword={initialKeyword}
                                />
                            ) : (
                                <p className="text-sm font-medium text-amber-400">
                                    {canGenerate
                                        ? "Add a site to start generating content."
                                        : "Sign in to start generating content."}
                                </p>
                            )}
                        </div>
                    </div>
                </>
            ) : (
                <ContentPipelineWithList
                    counts={pipelineCounts}
                    blogs={content}
                    success={success}
                    initialReviewId={initialReviewId}
                />
            )}
        </div>
    );
}
