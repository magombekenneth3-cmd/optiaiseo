import { Metadata } from "next";
import { getUserBlogs } from "@/app/actions/blog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { BlogList } from "./BlogList";
import { BlogPoller } from "./BlogPoller";
import { GenerateBlogButton } from "./GenerateBlogButton";
import { CmsConfigForm } from "@/components/dashboard/CmsConfigForm";
import { FileText } from "lucide-react";

export const metadata: Metadata = {
    title: "Content & Blogs | OptiAISEO",
    description: "Manage auto-generated SEO blog content.",
};

export default async function BlogsPage({
    searchParams,
}: {
    searchParams: Promise<{ keyword?: string; review?: string }>;
}) {
    const raw = (await searchParams).keyword ?? "";
    const initialKeyword = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 120) || undefined;
    // Review param: safe alphanumeric ID only (cuid pattern)
    const rawReview = (await searchParams).review ?? "";
    const initialReviewId = /^[a-zA-Z0-9_-]{1,40}$/.test(rawReview) ? rawReview : undefined;

    const { success, blogs, subscriptionTier } = await getUserBlogs();

    const session = await getServerSession(authOptions);
    const primarySite = session?.user?.email
        ? await prisma.site.findFirst({
            where: { user: { email: session.user.email } },
            orderBy: { createdAt: "desc" },
            select: { id: true, domain: true },
        })
        : null;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const publishedThisMonth =
        blogs?.filter(
            (b) => b.status === "PUBLISHED" && new Date(b.createdAt) >= startOfMonth
        ).length || 0;
    const pendingCount = blogs?.filter((b) => b.status === "DRAFT").length || 0;
    const totalCount = blogs?.length || 0;

    const generatingIds = (blogs ?? [])
        .filter(b => b.status === "GENERATING" || b.status === "QUEUED" || b.status === "PENDING")
        .map(b => b.id as string);

    const canGenerate = !!subscriptionTier;

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
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted border border-border text-muted-foreground text-sm font-medium hover:border-emerald-500/40 hover:text-emerald-400 transition-all"
                >
                    Add a site to generate posts
                </Link>
            );
        }
        return (
            <Link
                href="/login"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted border border-border text-muted-foreground text-sm font-medium"
            >
                Sign in to generate posts
            </Link>
        );
    }

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
            <BlogPoller generatingBlogIds={generatingIds} />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-1">
                        Content & Blogs
                    </h1>
                    <p className="text-muted-foreground">
                        Review, edit, and approve AI-generated articles targeting
                        trending keywords.
                    </p>
                </div>
                <div className="shrink-0"><GenerateControl /></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
                <div className="card-surface p-5">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                        Published This Month
                    </p>
                    <p className="text-3xl font-semibold text-foreground">
                        {totalCount === 0 ? "—" : publishedThisMonth}
                    </p>
                </div>
                <div className="card-surface p-5">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                        Pending Approval
                    </p>
                    <p className="text-3xl font-semibold text-amber-400">
                        {totalCount === 0 ? "—" : pendingCount}
                    </p>
                </div>
                <div className="card-surface p-5">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                        Total Articles
                    </p>
                    <p className="text-3xl font-semibold text-foreground">
                        {totalCount === 0 ? "—" : totalCount}
                    </p>
                </div>
            </div>

            {totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-xl bg-muted mt-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                        <FileText className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">
                        No content generated yet
                    </h3>
                    <p className="text-muted-foreground max-w-sm mx-auto mb-6">
                        Start driving organic traffic by generating your first
                        SEO-optimized blog post targeting keywords you&apos;re not
                        ranking for.
                    </p>
                    {canGenerate && primarySite ? (
                        <GenerateBlogButton
                            siteId={primarySite.id}
                            siteDomain={primarySite.domain}
                            initialKeyword={initialKeyword}
                        />
                    ) : (
                        <p className="text-sm text-yellow-400/90 font-medium">
                            {canGenerate
                                ? "Add a site to start generating content."
                                : "Sign in to start generating content."}
                        </p>
                    )}
                </div>
            ) : (
                <BlogList blogs={blogs} success={success} initialReviewId={initialReviewId} />
            )}

            {subscriptionTier === "FREE" && totalCount > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-center justify-between gap-4 mt-2">
                    <div>
                        <p className="text-sm font-medium text-amber-400">Free plan — 3 posts/month</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Upgrade to Pro for 150 posts/month, competitor intelligence, and CMS auto-publishing.
                        </p>
                    </div>
                    <a
                        href="/dashboard/billing"
                        className="shrink-0 px-4 py-2 bg-amber-500 text-white font-bold rounded-lg text-sm hover:bg-amber-600 transition-colors"
                    >
                        Upgrade
                    </a>
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