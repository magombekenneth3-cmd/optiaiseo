import { notFound } from "next/navigation";
import Link from "next/link";

import { Metadata } from "next";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
    "h1","h2","h3","h4","h5","h6",
    "p","br","hr","blockquote","pre","code",
    "ul","ol","li","dl","dt","dd",
    "table","thead","tbody","tr","th","td","caption",
    "strong","em","b","i","u","s","del","ins","sup","sub",
    "a","img","figure","figcaption","picture","source",
    "div","span","section","article","aside","header","footer","main",
    "details","summary","mark","time",
];

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
        a:       ["href","title","target","rel"],
        img:     ["src","alt","width","height","loading","decoding"],
        td:      ["colspan","rowspan"],
        th:      ["colspan","rowspan","scope"],
        time:    ["datetime"],
        "*":     ["class","id","aria-label","aria-hidden","role","tabindex"],
    },
    allowedSchemes:     ["https","http","mailto"],
    disallowedTagsMode: "discard",
};

function sanitize(html: string): string {
    return sanitizeHtml(html, SANITIZE_OPTS);
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

interface Props {
    params: Promise<{ slug: string }>;
}

async function getBlogBySlug(slug: string) {
    return prisma.blog.findFirst({
        where: { slug, status: "PUBLISHED" },
        include: {
            site: {
                select: { domain: true, authorName: true },
            },
        },
    });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const blog = await getBlogBySlug(slug);
    if (!blog) return { title: "Not Found" };

    const isEditorial = blog.isEditorial;
    const canonical = isEditorial
        ? `${SITE_URL}/blog/${blog.slug}`
        : `https://${blog.site.domain}/blog/${blog.slug}`;

    // Index editorial posts and any blog served on our domain.
    // Only noindex user-generated content hosted on external domains.
    const shouldIndex = isEditorial || blog.site.domain === "optiaiseo.online";

    return {
        title: blog.title,
        description: blog.metaDescription ?? undefined,
        alternates: { canonical },
        robots: shouldIndex ? undefined : { index: false, follow: false },
        openGraph: {
            title: blog.title,
            description: blog.metaDescription ?? undefined,
            type: "article",
            url: canonical,
            ...(blog.ogImage ? { images: [{ url: blog.ogImage }] } : {}),
        },
        twitter: {
            card: "summary_large_image",
            title: blog.title,
            description: blog.metaDescription ?? undefined,
        },
    };
}

export default async function PublicBlogPage({ params }: Props) {
    const { slug } = await params;
    const blog = await getBlogBySlug(slug);
    if (!blog) notFound();

    const isEditorial = blog.isEditorial;
    const canonical = isEditorial
        ? `${SITE_URL}/blog/${blog.slug}`
        : `https://${blog.site.domain}/blog/${blog.slug}`;

    const authorName = isEditorial ? "OptiAISEO" : (blog.site.authorName ?? blog.site.domain);
    const authorUrl  = isEditorial ? SITE_URL     : `https://${blog.site.domain}`;
    const publisherName = isEditorial ? "OptiAISEO" : blog.site.domain;
    const publisherUrl  = isEditorial ? SITE_URL    : `https://${blog.site.domain}`;

    const articleSchema = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: blog.title,
        description: blog.metaDescription ?? undefined,
        url: canonical,
        ...(blog.ogImage ? { image: blog.ogImage } : {}),
        ...(blog.publishedAt ? { datePublished: blog.publishedAt.toISOString() } : {}),
        dateModified: blog.updatedAt.toISOString(),
        author: {
            "@type": isEditorial ? "Organization" : "Person",
            name: authorName,
            url: authorUrl,
        },
        publisher: {
            "@type": "Organization",
            name: publisherName,
            url: publisherUrl,
        },
        mainEntityOfPage: {
            "@type": "WebPage",
            "@id": canonical,
        },
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
            />
            {blog.schemaMarkup && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: (() => {
                            try {
                                return JSON.stringify(JSON.parse(blog.schemaMarkup!));
                            } catch {
                                return "";
                            }
                        })(),
                    }}
                />
            )}
            <main className="max-w-3xl mx-auto px-4 py-12">
                {blog.ogImage && (
                    <div className="relative w-full mb-8" style={{ maxHeight: "24rem" }}>
                        <Image
                            src={blog.ogImage}
                            alt={blog.title}
                            width={1200}
                            height={630}
                            className="w-full rounded-xl object-cover max-h-96"
                            unoptimized
                            priority
                        />
                    </div>
                )}
                <header className="mb-8">
                    <h1 className="text-3xl font-bold leading-tight mb-3">{blog.title}</h1>
                    {blog.metaDescription && (
                        <p className="text-muted-foreground text-lg">{blog.metaDescription}</p>
                    )}
                    <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                        <span itemProp="author" itemScope itemType="https://schema.org/Person">
                            By{" "}
                            <a href={authorUrl} rel="author" itemProp="name" className="underline-offset-2 hover:underline">
                                {authorName}
                            </a>
                        </span>
                        {blog.publishedAt && (
                            <>
                                <span>·</span>
                                <time dateTime={blog.publishedAt.toISOString()}>
                                    {blog.publishedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                                </time>
                            </>
                        )}
                    </div>
                </header>
                <article
                    className="prose prose-neutral dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: sanitize(blog.content) }}
                />
                {blog.interactiveWidget && (
                    <div className="mt-10" dangerouslySetInnerHTML={{ __html: sanitize(blog.interactiveWidget) }} />
                )}

                {/* Internal cross-links — passes PageRank to comparison hub, guides, and free tools */}
                <nav aria-label="Related resources" className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-800">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Related resources</p>
                    <div className="flex flex-wrap gap-2">
                        <Link href="/vs" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            📊 SEO Tool Comparisons
                        </Link>
                        <Link href="/guide" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            📚 SEO &amp; AEO Guide Hub
                        </Link>
                        <Link href="/aeo-guide" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            🤖 AEO Guide Hub
                        </Link>
                        <Link href="/free/seo-checker" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            🔍 Free SEO Audit
                        </Link>
                        <Link href="/free/gso-checker" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            🧠 Free AI Visibility Check
                        </Link>
                        <Link href="/blog" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 hover:border-green-500 hover:text-green-600 transition-colors">
                            ← All posts
                        </Link>
                    </div>
                </nav>
            </main>
        </>
    );
}

export const revalidate = 3600;
