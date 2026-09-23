import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";
import { NavAuthSection } from "@/components/marketing/NavAuthSection";

const BLOG_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "SEO & AI Search Blog — Guides, Research & Insights | OptiAISEO",
    description: "Research, technical guides, and practical strategies for SEO, AEO, GEO, and AI search visibility.",
    alternates: { canonical: `${BLOG_SITE_URL}/blog` },
    openGraph: {
        title: "SEO & AI Search Blog — Guides, Research & Insights | OptiAISEO",
        description: "Research, technical guides, and practical strategies for SEO, AEO, GEO, and AI search visibility.",
        url: `${BLOG_SITE_URL}/blog`,
        siteName: "OptiAISEO",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO SEO and AI Search Blog" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "SEO & AI Search Blog | OptiAISEO",
        description: "Research, technical guides, and practical strategies for SEO, AEO, GEO, and AI search visibility.",
        images: ["/og-image.png"],
    },
};

export const dynamic = "force-dynamic";

const BLOG_SCHEMA = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "SEO & AI Search Blog — OptiAISEO",
    url: "https://optiaiseo.online/blog",
    description: "Research, technical guides, and practical strategies for SEO, AEO, GEO, and AI search visibility.",
    publisher: {
        "@type": "Organization",
        name: "OptiAISEO",
        url: "https://optiaiseo.online",
        logo: { "@type": "ImageObject", url: "https://optiaiseo.online/logo.png" },
    },
};

function formatDate(date: Date | null) {
    return date?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function readingTime(content: string) {
    const words = content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
}

export default async function BlogIndexPage() {
    const blogs = await prisma.blog.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 12,
        include: { site: { select: { domain: true, authorName: true } } },
    });

    const featured = blogs[0];
    const latest = blogs.slice(1);

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BLOG_SCHEMA) }} />

            <nav className="w-full border-b border-border/80 bg-background/90 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
                            <span className="font-black text-background text-[11px] tracking-tight">Opti</span>
                        </div>
                        <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                    </Link>
                    <div className="flex items-center gap-5 sm:gap-7 text-sm font-medium">
                        <Link href="/pricing" className="text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Pricing</Link>
                        <Link href="/free/seo-checker" className="text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Free tools</Link>
                        <Link href="/blog" className="text-foreground">Blog</Link>
                        <div className="h-4 w-px bg-border hidden sm:block" />
                        <NavAuthSection ctaText="Get started free" ctaHref="/signup" ctaClassName="font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all active:scale-95" />
                    </div>
                </div>
            </nav>

            <main className="flex-1">
                <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-20 sm:pt-28 pb-16">
                    <div className="max-w-4xl">
                        <div className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.18em] uppercase text-brand mb-5">
                            <Sparkles className="w-4 h-4" />
                            Insights
                        </div>
                        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-[-0.045em] leading-[0.98] max-w-4xl">
                            SEO × AEO × GEO × AI Search
                        </h1>
                        <p className="mt-7 text-lg sm:text-xl leading-8 text-muted-foreground max-w-2xl">
                            The practical guide to winning visibility in Google and AI search — through research, experiments, technical guides, and evidence.
                        </p>
                        <div className="flex flex-wrap gap-3 mt-8">
                            <Link href="#latest" className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity">
                                Explore latest <ArrowRight className="w-4 h-4" />
                            </Link>
                            <Link href="/free/gso-checker" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:border-foreground transition-colors">
                                Check AI visibility
                            </Link>
                        </div>
                    </div>
                </section>

                {blogs.length === 0 ? (
                    <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-24">
                        <div className="rounded-2xl border border-dashed border-border py-24 text-center">
                            <BookOpen className="w-8 h-8 mx-auto mb-4 text-muted-foreground/50" />
                            <p className="text-muted-foreground">No posts have been published yet. Check back soon.</p>
                        </div>
                    </section>
                ) : (
                    <>
                        {featured && (
                            <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
                                <div className="flex items-center justify-between mb-5">
                                    <p className="text-xs font-bold tracking-[0.16em] uppercase text-muted-foreground">Featured</p>
                                </div>
                                <Link href={`/blog/${featured.slug}`} className="group grid lg:grid-cols-[1.2fr_0.8fr] overflow-hidden rounded-2xl border border-border bg-card hover:border-brand/40 transition-colors">
                                    <div className="aspect-[16/10] lg:aspect-auto bg-muted overflow-hidden">
                                        {featured.ogImage ? (
                                            <img src={featured.ogImage} alt={featured.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700" />
                                        ) : (
                                            <div className="w-full h-full min-h-72 flex items-center justify-center bg-muted"><BookOpen className="w-12 h-12 text-muted-foreground/20" /></div>
                                        )}
                                    </div>
                                    <div className="p-7 sm:p-10 lg:p-12 flex flex-col justify-center">
                                        <div className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] uppercase text-brand">
                                            <span>AI Search</span><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{formatDate(featured.publishedAt)}</span>
                                        </div>
                                        <h2 className="mt-5 text-3xl sm:text-4xl font-black tracking-[-0.035em] leading-tight group-hover:text-brand transition-colors">{featured.title}</h2>
                                        {featured.metaDescription && <p className="mt-5 text-base leading-7 text-muted-foreground line-clamp-4">{featured.metaDescription}</p>}
                                        <div className="mt-8 flex items-center justify-between gap-4 pt-5 border-t border-border">
                                            <span className="text-sm text-muted-foreground">{readingTime(featured.content)} min read</span>
                                            <span className="inline-flex items-center gap-2 text-sm font-semibold">Read article <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
                                        </div>
                                    </div>
                                </Link>
                            </section>
                        )}

                        <section id="latest" className="max-w-7xl mx-auto px-4 sm:px-6 pb-24">
                            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-7">
                                <div>
                                    <p className="text-xs font-bold tracking-[0.16em] uppercase text-muted-foreground">Latest</p>
                                    <h2 className="mt-2 text-3xl sm:text-4xl font-black tracking-[-0.035em]">Practical ideas for modern search</h2>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                                    {["All", "AI Search", "Technical SEO", "AEO", "GEO", "Content"].map((topic, index) => (
                                        <span key={topic} className={`px-3 py-1.5 rounded-full border ${index === 0 ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}>{topic}</span>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {latest.map((blog) => (
                                    <Link key={blog.id} href={`/blog/${blog.slug}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card hover:border-brand/40 transition-colors">
                                        <div className="aspect-[16/9] bg-muted overflow-hidden">
                                            {blog.ogImage ? (
                                                <img src={blog.ogImage} alt={blog.title} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-muted"><BookOpen className="w-9 h-9 text-muted-foreground/20" /></div>
                                            )}
                                        </div>
                                        <div className="p-6 flex flex-col flex-1">
                                            <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase text-brand">
                                                <span>AI Search</span><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{formatDate(blog.publishedAt)}</span>
                                            </div>
                                            <h3 className="mt-3 text-xl font-bold leading-snug tracking-tight group-hover:text-brand transition-colors line-clamp-3">{blog.title}</h3>
                                            {blog.metaDescription && <p className="mt-3 text-sm leading-6 text-muted-foreground line-clamp-3 flex-1">{blog.metaDescription}</p>}
                                            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground">{readingTime(blog.content)} min read</span>
                                                <span className="font-semibold inline-flex items-center gap-1.5">Read <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" /></span>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </section>

                        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-24">
                            <div className="rounded-2xl border border-border bg-muted/30 p-7 sm:p-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
                                <div>
                                    <p className="text-xs font-bold tracking-[0.16em] uppercase text-brand">AI visibility</p>
                                    <h2 className="mt-2 text-2xl sm:text-3xl font-black tracking-[-0.03em]">Want to know how visible your site is to AI search?</h2>
                                    <p className="mt-3 text-muted-foreground max-w-2xl">Run a free visibility check and see where your site can improve across modern answer engines.</p>
                                </div>
                                <Link href="/free/gso-checker" className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity">
                                    Check your site <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        </section>
                    </>
                )}
            </main>
            <SiteFooter />
        </div>
    );
}
