import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserBlogs } from "@/app/actions/blog";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, PenSquare, CheckCircle2, AlertCircle, Clock } from "lucide-react";

export const metadata: Metadata = {
    title: "Editorial | OptiAISEO",
    description: "Review and approve content before publication.",
};

export default async function EditorialPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user) redirect("/login");

    const site = await prisma.site.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
    });

    const blogs = site
        ? await getUserBlogs(site.id)
        : [];

    const reviewBlogs = (blogs ?? []).filter(
        (b) =>
            b.status === "EVIDENCE_REVIEW" ||
            b.status === "EDITORIAL_REVIEW" ||
            b.status === "EDITORIAL_REJECTED" ||
            b.status === "DRAFT"
    );

    const approved = reviewBlogs.filter((b) => b.validationScore != null && Number(b.validationScore) >= 80);
    const needsWork = reviewBlogs.filter(
        (b) => b.validationScore != null && Number(b.validationScore) >= 60 && Number(b.validationScore) < 80
    );
    const critical = reviewBlogs.filter(
        (b) => b.validationScore == null || Number(b.validationScore) < 60
    );

    return (
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
            <div>
                <Link
                    href="/dashboard/blogs"
                    className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Content
                </Link>
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                        <PenSquare className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Editorial Review</h1>
                        <p className="text-sm text-muted-foreground">
                            Review, approve, and refine content before publication.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Ready</span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-emerald-400">{approved.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-400" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Needs Work</span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-amber-400">{needsWork.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-red-400" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Critical</span>
                    </div>
                    <p className="mt-2 text-2xl font-bold text-red-400">{critical.length}</p>
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/40">
                <div className="border-b border-border px-5 py-4">
                    <h2 className="text-sm font-bold text-foreground">Articles Awaiting Review</h2>
                    <p className="text-[11px] text-muted-foreground">{reviewBlogs.length} articles in editorial pipeline</p>
                </div>
                {reviewBlogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <PenSquare className="h-8 w-8 text-muted-foreground/20" />
                        <p className="mt-3 text-sm font-medium text-muted-foreground">No articles pending review</p>
                        <p className="mt-1 text-xs text-muted-foreground/60">Generated articles will appear here for editorial review.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {reviewBlogs.map((blog) => {
                            const score = blog.validationScore != null ? Number(blog.validationScore) : null;
                            return (
                                <Link
                                    key={blog.id}
                                    href={`/dashboard/blogs?review=${blog.id}`}
                                    className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-card/60"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-foreground">{blog.title}</p>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {blog.targetKeywords?.[0] || "No keyword"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {score != null && (
                                            <span className={`text-xs font-bold ${
                                                score >= 80 ? "text-emerald-400" :
                                                score >= 60 ? "text-amber-400" :
                                                "text-red-400"
                                            }`}>
                                                {score}%
                                            </span>
                                        )}
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                            blog.status === "EVIDENCE_REVIEW" ? "bg-blue-500/10 text-blue-300" :
                                            blog.status === "EDITORIAL_REJECTED" ? "bg-red-500/10 text-red-300" :
                                            "bg-muted text-muted-foreground"
                                        }`}>
                                            {blog.status === "EVIDENCE_REVIEW" ? "Evidence" :
                                             blog.status === "EDITORIAL_REVIEW" ? "Review" :
                                             blog.status === "EDITORIAL_REJECTED" ? "Rejected" :
                                             "Draft"}
                                        </span>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
