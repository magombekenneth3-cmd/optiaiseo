import { Metadata } from "next";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";

const BLOG_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "SEO & AI Search Blog — Guides, Tips & Case Studies | OptiAISEO",
    description: "Practical guides on technical SEO, AEO, GEO, and AI visibility. Learn how to rank on Google and get cited in ChatGPT, Perplexity, and Claude. Updated weekly.",
    alternates: { canonical: `${BLOG_SITE_URL}/blog` },
    openGraph: {
        title: "SEO & AI Search Blog — Guides, Tips & Case Studies | OptiAISEO",
        description: "Practical guides on technical SEO, AEO, GEO, and AI visibility. Learn how to rank on Google and get cited in ChatGPT, Perplexity, and Claude.",
        url: `${BLOG_SITE_URL}/blog`,
        siteName: "OptiAISEO",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO SEO Blog" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "SEO & AI Search Blog | OptiAISEO",
        description: "Practical guides on technical SEO, AEO, GEO, and AI visibility.",
        images: ["/og-image.png"],
    },
};

export const dynamic = "force-dynamic"; // DB not available at build time in Docker

const BLOG_SCHEMA = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "SEO & AI Search Blog — OptiAISEO",
    "url": "https://optiaiseo.online/blog",
    "description": "Practical guides on technical SEO, AEO, GEO, and AI visibility. Learn how to rank on Google and get cited in ChatGPT, Perplexity, and Claude.",
    "publisher": {
        "@type": "Organization",
        "name": "OptiAISEO",
        "url": "https://optiaiseo.online",
        "logo": { "@type": "ImageObject", "url": "https://optiaiseo.online/logo.png" }
    }
};

export default async function BlogIndexPage() {
    const blogs = await prisma.blog.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 12,
        include: {
            site: {
                select: { domain: true, authorName: true },
            },
        },
    });

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BLOG_SCHEMA) }} />
            {/* Simple Public Nav */}
            <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
                            <span className="font-black text-background text-[11px] tracking-tight">Opti</span>
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                        </div>
                    </Link>
                    <div className="flex items-center gap-6 text-sm font-medium">
                        <Link href="/pricing" className="text-muted-foreground hover:text-foreground hidden sm:block">Pricing</Link>
                        <Link href="/free/seo-checker" className="text-muted-foreground hover:text-foreground hidden sm:block">Free tools</Link>
                        <Link href="/blog" className="text-foreground border-b-2 border-brand pb-0.5">Blog</Link>
                        <div className="h-4 w-px bg-border hidden sm:block" />
                        <Link href="/login" className="text-muted-foreground hover:text-foreground">Log in</Link>
                        <Link href="/signup" className="font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all active:scale-95">Get started free</Link>
                    </div>
                </div>
            </nav>

            <main className="flex-1 max-w-7xl mx-auto px-6 py-24 w-full">
                <div className="text-center mb-16">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand/10 border border-brand/20 mb-6 mx-auto">
                        <BookOpen className="w-8 h-8 text-brand" />
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6">Resources &amp; Insights</h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                        Learn how to optimize your site for Answer Engines, track your GSoV, and win visibility across ChatGPT, Claude, and Perplexity.
                    </p>
                </div>

                {blogs.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-border rounded-xl bg-card/50">
                        <p className="text-muted-foreground">No posts have been published yet. Check back soon!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {blogs.map((blog) => (
                            <Link 
                                href={`/blog/${blog.slug}`} 
                                key={blog.id}
                                className="group flex flex-col bg-card border border-border rounded-2xl overflow-hidden hover:border-brand/50 transition-all hover:shadow-lg hover:shadow-brand/5"
                            >
                                {/* Image cover */}
                                <div className="aspect-video bg-muted relative overflow-hidden">
                                    {blog.ogImage ? (
                                        <img 
                                            src={blog.ogImage} 
                                            alt={blog.title}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-brand/20 to-border/20">
                                            <BookOpen className="w-10 h-10 text-muted-foreground/30" />
                                        </div>
                                    )}
                                </div>
                                
                                {/* Content */}
                                <div className="p-6 flex flex-col flex-1">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-brand mb-3 uppercase tracking-wider">
                                        <span>AI Search</span>
                                        {blog.publishedAt && (
                                            <>
                                                <span className="text-muted-foreground">·</span>
                                                <span className="text-muted-foreground">
                                                    {blog.publishedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <h2 className="text-xl font-bold mb-3 line-clamp-2 group-hover:text-brand transition-colors">
                                        {blog.title}
                                    </h2>
                                    {blog.metaDescription && (
                                        <p className="text-sm text-muted-foreground line-clamp-3 mb-6 flex-1">
                                            {blog.metaDescription}
                                        </p>
                                    )}
                                    <div className="mt-auto flex items-center justify-between pt-4 border-t border-border">
                                        <span className="text-xs font-medium text-foreground">
                                            {blog.site.authorName || blog.site.domain}
                                        </span>
                                        <span className="text-brand flex items-center gap-1 text-sm font-semibold group-hover:gap-2 transition-all">
                                            Read <ArrowRight className="w-4 h-4" />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
            <SiteFooter />
        </div>
    );
}
