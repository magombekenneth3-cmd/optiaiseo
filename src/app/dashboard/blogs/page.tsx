import { Metadata } from "next";
import { Suspense } from "react";
import { getUserBlogs } from "@/app/actions/blog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BlogList } from "./BlogList";
import { BlogPoller } from "./BlogPoller";
import { GenerateBlogButton } from "./GenerateBlogButton";
import { CmsConfigForm } from "@/components/dashboard/CmsConfigForm";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    FileText,
    PenLine,
    Sparkles,
    XCircle,
} from "lucide-react";

export const metadata: Metadata = {
    title: "Content | OptiAISEO",
    description: "Create, optimize, review, and publish SEO content.",
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

    const { success, blogs, subscriptionTier } = await getUserBlogs();

    const session = await getServerSession(authOptions);

    const primarySite = session?.user?.email
        ? await prisma.site.findFirst({
            where: {
                user: {
                    email: session.user.email,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                domain: true,
            },
        })
        : null;

    const content = blogs ?? [];
    const totalCount = content.length;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const draftsCount = content.filter(
        (blog) => blog.status === "DRAFT"
    ).length;

    const reviewCount = content.filter(
        (blog) =>
            blog.status === "REVIEW" ||
            blog.status === "NEEDS_REVIEW"
    ).length;

    const publishedCount = content.filter(
        (blog) => blog.status === "PUBLISHED"
    ).length;

    const publishedThisMonth = content.filter(
        (blog) =>
            blog.status === "PUBLISHED" &&
            new Date(blog.createdAt) >= startOfMonth
    ).length;

    const issuesCount = content.filter((blog) => {
        const hasValidationErrors =
            Array.isArray(blog.validationErrors) &&
            blog.validationErrors.length > 0;

        const lowScore =
            blog.validationScore != null &&
            Number(blog.validationScore) < 60;

        return hasValidationErrors || lowScore || blog.status === "FAILED";
    }).length;

    const generatingIds = content
        .filter(
            (blog) =>
                blog.status === "GENERATING" ||
                blog.status === "QUEUED" ||
                blog.status === "PENDING"
        )
        .map((blog) => blog.id as string);

    const canGenerate = Boolean(subscriptionTier);

    function GenerateControl() {
        if (canGenerate && primarySite) {
            return (
                <GenerateBlogButton
                    siteId={primarySite.id}
                    siteDomain={primarySite.domain}
                    initialKeyword={initialKeyword}
                />
            );
        }

        if (canGenerate && !primarySite) {
            return (
                <Link
                    href="/dashboard/sites/new"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-400"
                >
                    Add a site
                </Link>
            );
        }

        return (
            <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground"
            >
                Sign in to generate
            </Link>
        );
    }

    const stats = [
        {
            label: "Drafts",
            value: draftsCount,
            description: "Content being prepared",
            icon: PenLine,
            tone: "amber",
        },
        {
            label: "Needs review",
            value: reviewCount,
            description: "Waiting for approval",
            icon: AlertTriangle,
            tone: "orange",
        },
        {
            label: "Published",
            value: publishedCount,
            description:
                publishedThisMonth > 0
                    ? `${publishedThisMonth} this month`
                    : "No posts this month",
            icon: CheckCircle2,
            tone: "emerald",
        },
        {
            label: "Issues",
            value: issuesCount,
            description:
                issuesCount > 0
                    ? "Needs attention"
                    : "Everything looks healthy",
            icon: XCircle,
            tone: issuesCount > 0 ? "red" : "zinc",
        },
    ];

    const toneClasses = {
        amber: {
            icon: "bg-amber-500/10 text-amber-400",
            value: "text-amber-300",
        },
        orange: {
            icon: "bg-orange-500/10 text-orange-400",
            value: "text-orange-300",
        },
        emerald: {
            icon: "bg-emerald-500/10 text-emerald-400",
            value: "text-emerald-300",
        },
        red: {
            icon: "bg-red-500/10 text-red-400",
            value: "text-red-300",
        },
        zinc: {
            icon: "bg-muted text-muted-foreground",
            value: "text-foreground",
        },
    } as const;

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">
            <BlogPoller generatingBlogIds={generatingIds} />

            <section className="grid gap-5 xl:grid-cols-[1fr_420px] xl:items-stretch">
                <div className="flex min-h-[190px] flex-col justify-between rounded-2xl border border-border bg-card/40 p-6 shadow-sm">
                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                                <FileText className="h-4 w-4 text-emerald-400" />
                            </span>
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                Content library
                            </span>
                        </div>

                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            Content
                        </h1>

                        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                            Create, optimize, review, and publish SEO content
                            designed to perform in search and AI answers.
                        </p>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <GenerateControl />

                        {totalCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                                {totalCount}{" "}
                                {totalCount === 1 ? "article" : "articles"} in
                                your library
                            </span>
                        )}
                    </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/[0.10] via-emerald-500/[0.04] to-card p-5 shadow-sm">
                    <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />

                    <div className="relative flex h-full flex-col">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
                                    <Sparkles className="h-4 w-4" />
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-foreground">
                                        AI visibility opportunity
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Content readiness
                                    </p>
                                </div>
                            </div>

                            <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-purple-300">
                                Insight
                            </span>
                        </div>

                        <div className="mt-5 flex-1">
                            {totalCount > 0 ? (
                                <>
                                    <p className="text-sm leading-6 text-muted-foreground">
                                        Improve your strongest content by
                                        focusing on answer structure, entity
                                        coverage, and concise sections that
                                        are easier for AI systems to interpret.
                                    </p>

                                    <div className="mt-4 flex items-center gap-2 text-xs text-purple-300">
                                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                                        AI readiness analysis available
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm leading-6 text-muted-foreground">
                                    Generate your first article to start
                                    analyzing content readiness for search and
                                    AI discovery.
                                </p>
                            )}
                        </div>

                        {totalCount > 0 && (
                            <button
                                type="button"
                                className="mt-5 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                            >
                                Explore opportunities
                                <ArrowRight className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    const tone = toneClasses[stat.tone as keyof typeof toneClasses];

                    return (
                        <button
                            key={stat.label}
                            type="button"
                            className="group rounded-2xl border border-border bg-card/40 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-border/80 hover:bg-card/70"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div
                                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone.icon}`}
                                >
                                    <Icon className="h-4 w-4" />
                                </div>

                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                            </div>

                            <div className="mt-4">
                                <p className="text-xs font-medium text-muted-foreground">
                                    {stat.label}
                                </p>

                                <p
                                    className={`mt-1 text-2xl font-bold tracking-tight ${tone.value}`}
                                >
                                    {totalCount === 0 ? "—" : stat.value}
                                </p>

                                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                    {stat.description}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </section>

            {totalCount === 0 ? (
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
            ) : (
                <Suspense
                    fallback={
                        <div className="space-y-4">
                            <div className="h-12 w-full animate-pulse rounded-xl bg-muted" />
                            <div className="h-[420px] w-full animate-pulse rounded-2xl bg-muted" />
                        </div>
                    }
                >
                    <BlogList
                        blogs={blogs}
                        success={success}
                        initialReviewId={initialReviewId}
                    />
                </Suspense>
            )}

            {subscriptionTier === "FREE" && totalCount > 0 && (
                <div className="flex flex-col gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-semibold text-amber-400">
                            Free plan · 3 posts/month
                        </p>

                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Upgrade to Pro for 150 posts/month, competitor
                            intelligence, and CMS auto-publishing.
                        </p>
                    </div>

                    <Link
                        href="/dashboard/billing"
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-600"
                    >
                        Upgrade
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            )}

            {primarySite && (
                <CmsConfigForm
                    siteId={primarySite.id}
                    siteDomain={primarySite.domain}
                />
            )}
        </div>
    );
}