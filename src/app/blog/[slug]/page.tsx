import { notFound } from "next/navigation";
import Link from "next/link";
import { Metadata } from "next";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
    "h1","h2","h3","h4","h5","h6","p","br","hr","blockquote","pre","code",
    "ul","ol","li","dl","dt","dd","table","thead","tbody","tr","th","td","caption",
    "strong","em","b","i","u","s","del","ins","sup","sub","a","img","figure","figcaption",
    "picture","source","div","span","section","article","aside","header","footer","main",
    "details","summary","mark","time",
];

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
        a: ["href","title","target","rel"],
        img: ["src","alt","width","height","loading","decoding"],
        td: ["colspan","rowspan"], th: ["colspan","rowspan","scope"],
        time: ["datetime"],
        "*": ["class","id","aria-label","aria-hidden","role","tabindex"],
    },
    allowedSchemes: ["https","http","mailto"],
    disallowedTagsMode: "discard",
};

function sanitize(html: string) {
    return sanitizeHtml(html, SANITIZE_OPTS);
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

interface Props { params: Promise<{ slug: string }> }

async function getBlogBySlug(slug: string) {
    return prisma.blog.findFirst({
        where: { slug, status: "PUBLISHED" },
        include: { site: { select: { domain: true, authorName: true } } },
    });
}

function readingTime(html: string) {
    const words = html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
}

function slugify(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function prepareContent(html: string) {
    const clean = sanitize(html);
    const headings: { id: string; text: string }[] = [];
    const seen = new Map<string, number>();
    const content = clean.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
        const text = inner.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
        if (!text) return match;
        const base = slugify(text) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count ? `${base}-${count + 1}` : base;
        headings.push({ id, text });
        return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
    });
    return { content, headings };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const blog = await getBlogBySlug(slug);
    if (!blog) return { title: "Not Found" };

    const isEditorial = blog.isEditorial;
    const canonical = isEditorial ? `${SITE_URL}/blog/${blog.slug}` : `https://${blog.site.domain}/blog/${blog.slug}`;
    const shouldIndex = isEditorial || blog.site.domain === "optiaiseo.online";

    return {
        title: blog.title,
        description: blog.metaDescription ?? undefined,
        alternates: { canonical },
        robots: shouldIndex ? undefined : { index: false, follow: false },
        openGraph: {
            title: blog.title, description: blog.metaDescription ?? undefined, type: "article", url: canonical,
            ...(blog.ogImage ? { images: [{ url: blog.ogImage }] } : {}),
        },
        twitter: { card: "summary_large_image", title: blog.title, description: blog.metaDescription ?? undefined },
    };
}

export default async function PublicBlogPage({ params }: Props) {
    const { slug } = await params;
    const blog = await getBlogBySlug(slug);
    if (!blog) notFound();

    const isEditorial = blog.isEditorial;
    const canonical = isEditorial ? `${SITE_URL}/blog/${blog.slug}` : `https://${blog.site.domain}/blog/${blog.slug}`;
    const authorName = isEditorial ? "OptiAISEO" : (blog.site.authorName ?? blog.site.domain);
    const authorUrl = isEditorial ? SITE_URL : `https://${blog.site.domain}`;
    const publisherName = isEditorial ? "OptiAISEO" : blog.site.domain;
    const publisherUrl = isEditorial ? SITE_URL : `https://${blog.site.domain}`;
    const { content, headings } = prepareContent(blog.content);
    const articleReadTime = readingTime(blog.content);

    const articleSchema = {
        "@context": "https://schema.org", "@type": "Article", headline: blog.title,
        description: blog.metaDescription ?? undefined, url: canonical,
        ...(blog.ogImage ? { image: blog.ogImage } : {}),
        ...(blog.publishedAt ? { datePublished: blog.publishedAt.toISOString() } : {}),
        dateModified: blog.updatedAt.toISOString(),
        author: { "@type": isEditorial ? "Organization" : "Person", name: authorName, url: authorUrl },
        publisher: { "@type": "Organization", name: publisherName, url: publisherUrl },
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    };

    const toc = headings.filter((heading) => heading.text && heading.id);

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
            {blog.schemaMarkup && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: (() => { try { return JSON.stringify(JSON.parse(blog.schemaMarkup!)); } catch { return ""; } })() }} />}

            <main className="min-h-screen bg-background text-foreground">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12">
                    <Link href="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Back to insights
                    </Link>
                </div>

                <header className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-12 text-center">
                    <div className="text-xs font-bold tracking-[0.16em] uppercase text-brand">AI Search · Insights</div>
                    <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-black tracking-[-0.045em] leading-[1.03]">{blog.title}</h1>
                    {blog.metaDescription && <p className="mt-6 text-lg sm:text-xl leading-8 text-muted-foreground max-w-3xl mx-auto">{blog.metaDescription}</p>}
                    <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        <span>By <a href={authorUrl} rel="author" className="text-foreground font-medium hover:underline underline-offset-4">{authorName}</a></span>
                        {blog.publishedAt && <><span className="text-border">•</span><time dateTime={blog.publishedAt.toISOString()}>{blog.publishedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</time></>}
                        <span className="text-border">•</span><span className="inline-flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5" />{articleReadTime} min read</span>
                    </div>
                </header>

                {blog.ogImage && (
                    <div className="max-w-6xl mx-auto px-4 sm:px-6">
                        <div className="relative aspect-[16/8] overflow-hidden rounded-2xl border border-border bg-muted">
                            <Image src={blog.ogImage} alt={blog.title} fill sizes="(max-width: 768px) 100vw, 1200px" className="object-cover" unoptimized priority />
                        </div>
                    </div>
                )}

                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 grid lg:grid-cols-[minmax(0,760px)_260px] gap-12 xl:gap-20 justify-center">
                    <div>
                        {toc.length > 0 && (
                            <div className="lg:hidden mb-8 rounded-xl border border-border bg-card p-5">
                                <p className="text-xs font-bold tracking-[0.14em] uppercase text-muted-foreground mb-3">On this page</p>
                                <div className="space-y-2">
                                    {toc.map((item) => <a key={item.id} href={`#${item.id}`} className="block text-sm text-muted-foreground hover:text-foreground transition-colors">{item.text}</a>)}
                                </div>
                            </div>
                        )}

                        <div className="mb-9 rounded-xl border border-border bg-muted/30 p-5 sm:p-6">
                            <p className="text-xs font-bold tracking-[0.14em] uppercase text-brand">Key takeaway</p>
                            <p className="mt-2 text-base sm:text-lg leading-7 text-foreground">Use the evidence in this article as a practical starting point, then validate the recommendations against your own site, search data, and audience.</p>
                        </div>

                        <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:tracking-[-0.025em] prose-headings:font-bold prose-h2:text-3xl prose-h2:mt-14 prose-h2:mb-5 prose-h3:text-2xl prose-h3:mt-10 prose-p:text-[18px] prose-p:leading-[1.8] prose-p:text-foreground/90 prose-li:text-[17px] prose-li:leading-8 prose-a:text-brand prose-a:font-medium prose-img:rounded-xl prose-img:border prose-img:border-border prose-blockquote:border-brand prose-blockquote:bg-muted/30 prose-blockquote:rounded-r-xl prose-blockquote:py-1" dangerouslySetInnerHTML={{ __html: content }} />
                        {blog.interactiveWidget && <div className="mt-12" dangerouslySetInnerHTML={{ __html: sanitize(blog.interactiveWidget) }} />}

                        <section className="mt-16 rounded-2xl border border-border bg-muted/30 p-7 sm:p-9">
                            <p className="text-xs font-bold tracking-[0.14em] uppercase text-brand">AI visibility</p>
                            <h2 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">See how AI search understands your website.</h2>
                            <p className="mt-3 text-muted-foreground leading-7 max-w-2xl">Run a free check across AI visibility signals and identify opportunities to improve your presence.</p>
                            <Link href="/free/gso-checker" className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity">Check your site <ArrowRight className="w-4 h-4" /></Link>
                        </section>

                        <nav aria-label="Related resources" className="mt-12 pt-8 border-t border-border">
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-4">Explore more</p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <Link href="/guide" className="rounded-xl border border-border p-4 text-sm font-semibold hover:border-brand/50 transition-colors">SEO & AEO Guide Hub <ArrowRight className="inline w-4 h-4 ml-1" /></Link>
                                <Link href="/aeo-guide" className="rounded-xl border border-border p-4 text-sm font-semibold hover:border-brand/50 transition-colors">AEO Guide Hub <ArrowRight className="inline w-4 h-4 ml-1" /></Link>
                                <Link href="/free/seo-checker" className="rounded-xl border border-border p-4 text-sm font-semibold hover:border-brand/50 transition-colors">Free SEO Audit <ArrowRight className="inline w-4 h-4 ml-1" /></Link>
                                <Link href="/blog" className="rounded-xl border border-border p-4 text-sm font-semibold hover:border-brand/50 transition-colors">All insights <ArrowRight className="inline w-4 h-4 ml-1" /></Link>
                            </div>
                        </nav>
                    </div>

                    {toc.length > 0 && (
                        <aside className="hidden lg:block">
                            <div className="sticky top-24">
                                <p className="text-xs font-bold tracking-[0.14em] uppercase text-muted-foreground mb-4">On this page</p>
                                <nav className="border-l border-border pl-4 space-y-3">
                                    {toc.map((item) => <a key={item.id} href={`#${item.id}`} className="block text-sm leading-5 text-muted-foreground hover:text-foreground transition-colors">{item.text}</a>)}
                                </nav>
                                <div className="mt-10 rounded-xl border border-border bg-card p-5">
                                    <p className="text-sm font-bold">AI visibility check</p>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Measure how your site appears across modern answer engines.</p>
                                    <Link href="/free/gso-checker" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand">Run free check <ArrowRight className="w-3.5 h-3.5" /></Link>
                                </div>
                            </div>
                        </aside>
                    )}
                </div>
            </main>
        </>
    );
}

export const revalidate = 3600;
