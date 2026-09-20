import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserBlogs } from "@/app/actions/blog";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, Send, ExternalLink, Globe, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
    title: "Publishing | OptiAISEO",
    description: "Publish and syndicate your content across platforms.",
};

export default async function PublishingPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user) redirect("/login");

    const site = await prisma.site.findFirst({
        where: { userId: session.user.id },
        select: { id: true, url: true, hashnodePublicationId: true, mediumIntegrationToken: true },
    });

    const blogs = site
        ? await getUserBlogs(site.id)
        : [];

    const published = (blogs ?? []).filter((b) => b.status === "PUBLISHED");
    const readyToPublish = (blogs ?? []).filter(
        (b) => b.status === "DRAFT" && b.validationScore != null && Number(b.validationScore) >= 60
    );

    const hasMedium = !!site?.mediumIntegrationToken;
    const hasHashnode = !!site?.hashnodePublicationId;

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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                        <Send className="h-5 w-5 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Publishing</h1>
                        <p className="text-sm text-muted-foreground">
                            Publish and syndicate content across your platforms.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Published</p>
                    <p className="mt-1.5 text-2xl font-bold text-emerald-400">{published.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Ready to Publish</p>
                    <p className="mt-1.5 text-2xl font-bold text-blue-400">{readyToPublish.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 rounded-full ${hasMedium ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Medium</p>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-muted-foreground">{hasMedium ? "Connected" : "Not connected"}</p>
                </div>
                <div className="rounded-xl border border-border bg-card/40 p-4">
                    <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 rounded-full ${hasHashnode ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Hashnode</p>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-muted-foreground">{hasHashnode ? "Connected" : "Not connected"}</p>
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/40">
                <div className="border-b border-border px-5 py-4">
                    <h2 className="text-sm font-bold text-foreground">Ready to Publish</h2>
                    <p className="text-[11px] text-muted-foreground">{readyToPublish.length} articles approved for publication</p>
                </div>
                {readyToPublish.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Send className="h-8 w-8 text-muted-foreground/20" />
                        <p className="mt-3 text-sm font-medium text-muted-foreground">No articles ready to publish</p>
                        <p className="mt-1 text-xs text-muted-foreground/60">Articles with a score of 60+ will appear here.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {readyToPublish.map((blog) => (
                            <Link
                                key={blog.id}
                                href={`/dashboard/blogs?review=${blog.id}`}
                                className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-card/60"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-foreground">{blog.title}</p>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {blog.targetKeywords?.[0] || "No keyword"} · {blog.validationScore}% SEO
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                                        Ready
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {published.length > 0 && (
                <div className="rounded-2xl border border-border bg-card/40">
                    <div className="border-b border-border px-5 py-4">
                        <h2 className="text-sm font-bold text-foreground">Published Articles</h2>
                        <p className="text-[11px] text-muted-foreground">{published.length} articles live</p>
                    </div>
                    <div className="divide-y divide-border">
                        {published.slice(0, 20).map((blog) => (
                            <div
                                key={blog.id}
                                className="flex items-center justify-between gap-4 px-5 py-3.5"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-foreground">{blog.title}</p>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {blog.targetKeywords?.[0] || "No keyword"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    {blog.slug && (
                                        <a
                                            href={`/blog/${blog.slug}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
