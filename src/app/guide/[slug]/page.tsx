import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";
import { NavAuthSection } from "@/components/marketing/NavAuthSection";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

// Each slug targets a specific low-competition long-tail query.

import { GUIDES } from "@/data/guides";

export function generateStaticParams() {
  return Object.keys(GUIDES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) return { title: "Not Found" };
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `${SITE_URL}/guide/${slug}` },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url: `${SITE_URL}/guide/${slug}`,
      type: "article",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = GUIDES[slug];
  if (!guide) notFound();

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.h1,
    description: guide.description,
    url: `${SITE_URL}/guide/${slug}`,
    datePublished: "2026-01-01",
    dateModified: new Date().toISOString().split("T")[0],
    author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guide` },
      { "@type": "ListItem", position: 3, name: guide.h1, item: `${SITE_URL}/guide/${slug}` },
    ],
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Nav */}
      <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <span className="font-black text-background text-[11px] tracking-tight">AI</span>
            </div>
            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Pricing</Link>
            <NavAuthSection ctaText="Try free →" ctaHref="/signup" />
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <Link href="/guide" className="hover:text-foreground transition-colors">Guides</Link>
          <span>/</span>
          <span className="text-foreground truncate">{guide.h1}</span>
        </nav>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#10b981]/25 bg-[#10b981]/10 mb-4">
            <span className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">Guide · Updated 2026</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-4 leading-tight">{guide.h1}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{guide.intro}</p>
        </div>

        {/* Sections */}
        <div className="space-y-10 mb-14">
          {guide.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-xl font-bold mb-3">{s.heading}</h2>
              <p className="text-muted-foreground leading-relaxed text-base">{s.body}</p>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="card-surface rounded-2xl p-8 text-center mb-14">
          <p className="text-sm text-muted-foreground mb-4">Ready to put this into practice?</p>
          <Link
            href="/free/seo-checker"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#10b981] text-white font-bold text-sm hover:opacity-90 transition-all"
          >
            {guide.cta} →
          </Link>
          <p className="text-xs text-muted-foreground mt-3">No account required</p>
        </div>

        {/* FAQs */}
        <section className="mb-14">
          <h2 id="faq-heading" className="text-2xl font-bold mb-6">Frequently asked questions</h2>
          <div className="space-y-3">
            {guide.faqs.map(({ q, a }) => (
              <details key={q} className="card-surface rounded-2xl group">
                <summary className="flex items-center justify-between px-6 py-5 cursor-pointer list-none font-semibold text-sm select-none">
                  <span>{q}</span>
                  <span className="text-muted-foreground ml-4 shrink-0 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">{a}</div>
              </details>
            ))}
          </div>
        </section>

        {/* Related */}
        <section>
          <h2 className="text-base font-semibold mb-4 text-muted-foreground">Related guides</h2>
          <div className="flex flex-wrap gap-2">
            {guide.related.map(({ href, label }) => (
              <Link key={href} href={href} className="text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </section>

        {/* Cross-hub nav — pushes PageRank to comparison cluster, free tools, and blog */}
        <nav aria-label="More resources" className="mt-8 pt-6 border-t border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">More resources</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/vs" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              📊 SEO Tool Comparisons
            </Link>
            <Link href="/blog" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              📝 SEO Blog
            </Link>
            <Link href="/aeo-guide" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              🤖 AEO Guide Hub
            </Link>
            <Link href="/free/seo-checker" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              🔍 Free SEO Audit
            </Link>
            <Link href="/free/gso-checker" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              🧠 Free AI Visibility Check
            </Link>
            <Link href="/case-studies" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors">
              📈 Case Studies
            </Link>
          </div>
        </nav>
      </main>

      <SiteFooter />
    </div>
  );
}
