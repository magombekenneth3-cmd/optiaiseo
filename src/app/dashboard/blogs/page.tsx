import { Metadata } from "next";
import { getUserBlogs } from "@/app/actions/blog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { GenerateBlogButton } from "./GenerateBlogButton";
import { ContentPipelineWrapper, ContentPipelineWithList } from "./ContentPipelineWrapper";
import { ActiveGenerationCard } from "./ActiveGenerationCard";
import { ContentHealthRow } from "./ContentHealthRow";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/design-system/PageHeader";

export const metadata: Metadata = {
    title: "Content | OptiAISEO",
    description: "Create content built for search and AI answers.",
};

export default async function BlogsPage({
    searchParams,
}: {
    searchParams: Promise<{ keyword?: string; review?: string; tab?: string }>;
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

    const autoOpenCreate = params.tab === "new";

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
        (b) =>
            b.status === "GENERATING" ||
            b.status === "QUEUED" ||
            b.status === "PENDING" ||
            b.status === "DRAFT"
    ).length;

    const evidenceCount = content.filter(
        (b) => b.status === "EVIDENCE_REVIEW"
    ).length;

    const reviewCount = content.filter(
        (b) => b.status === "REVIEW" || b.status === "NEEDS_REVIEW" || b.status === "REJECTED"
    ).length;

    const readyCount = content.filter(
        (b) =>
            b.status === "DRAFT" &&
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

    /* ── AI opportunity count ────────────────────────────────────── */

    const aiOpportunityCount = content.filter(
        (b) =>
            b.citationScore != null &&
            Number(b.citationScore) < 70 &&
            b.status !== "GENERATING" &&
            b.status !== "FAILED"
    ).length;

    /* ── Generate control ────────────────────────────────────────── */

    const canGenerate = Boolean(subscriptionTier);

    const generateControl =
        canGenerate && primarySite ? (
            <GenerateBlogButton
                siteId={primarySite.id}
                siteDomain={primarySite.domain}
                initialKeyword={initialKeyword}
                autoOpen={autoOpenCreate}
            />
        ) : canGenerate ? (
            <Link
                href="/dashboard/sites/new"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-400"
            >
                Add a site
            </Link>
        ) : (
            <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
                Sign in to generate
            </Link>
        );

    /* ── Monthly usage (for subtle FREE tier counter) ────────────── */

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const postsThisMonth = content.filter(
        (b) => new Date(b.createdAt) >= startOfMonth
    ).length;

    const headerActions = (
        <div className="flex items-center gap-3 flex-wrap">
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
    );

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            {/* ── Header + Inline Primary Action ─────────────────── */}
            <PageHeader
                title="Articles"
                description="Create, review, and publish search-ready content."
                category="Content Studio"
                actions={headerActions}
            />

            {/* ── Active Generation Progress (only when running) ─── */}
            {generatingBlogs.length > 0 && (
                <ActiveGenerationCard generatingBlogs={generatingBlogs} />
            )}

            {/* ── Unified Readiness, Next Best Action & AI Opportunity ── */}
            {totalCount > 0 && (
                <ContentHealthRow
                    blogs={content}
                    aiOpportunityCount={aiOpportunityCount}
                />
            )}

            {/* ── Content Pipeline Tabs + Article Table / Empty State ── */}
            {totalCount === 0 ? (
                <>
                    <ContentPipelineWrapper counts={pipelineCounts} />
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/15 bg-emerald-500/10">
                            <FileText className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                        </div>

                        <h2 className="text-xl font-bold tracking-tight text-foreground">
                            Build your content library
                        </h2>

                        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                            Generate your first SEO article and start building content that ranks
                            in search and earns citations in AI answers.
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
