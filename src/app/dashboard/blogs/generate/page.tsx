import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { GenerateBlogButton } from "../GenerateBlogButton";
import { Sparkles, ArrowLeft } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Generate Content | OptiAISEO",
    description: "Generate AI-powered articles built for search and AI answers.",
};

export default async function GeneratePage() {
    const session = await getServerSession(authOptions);
    if (!session?.user) redirect("/login");

    const site = await prisma.site.findFirst({
        where: { userId: session.user.id },
        select: { id: true, domain: true },
    });

    if (!site) redirect("/dashboard/blogs");

    return (
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
            <div>
                <Link
                    href="/dashboard/blogs"
                    className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Content
                </Link>
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                        <Sparkles className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Generate Content</h1>
                        <p className="text-sm text-muted-foreground">
                            Create a new article with AI-powered research, evidence, and editorial review.
                        </p>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-border bg-card/40 p-6">
                <GenerateBlogButton siteId={site.id} siteDomain={site.domain} />
            </div>
        </div>
    );
}
