import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AEO_PAGES from "@/data/aeo-pages.json";
import { AEO_CONTENT } from "@/data/aeo-content";
import SiteFooter from "@/components/marketing/SiteFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";

// Types

interface AeoPage {
  slug: string;
  title: string;
  keyword: string;
  intent: string;
}

interface Section {
  heading: string;
  body: string;
}

interface Faq {
  q: string;
  a: string;
}

// Static params

export async function generateStaticParams() {
  return (AEO_PAGES as AeoPage[]).map((p) => ({ slug: p.slug }));
}

// Metadata

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = (AEO_PAGES as AeoPage[]).find((p) => p.slug === slug);
  if (!page) return { title: "Not Found" };

  const description = buildDescription(page);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online";

  return {
    title: page.title,
    description,
    alternates: { canonical: `${siteUrl}/aeo-guide/${page.slug}` },
    openGraph: { title: page.title, description, url: `${siteUrl}/aeo-guide/${page.slug}`, type: "article", images: [{ url: "/og-image.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: page.title, description, images: ["/og-image.png"] },
  };
}


function buildDescription(page: AeoPage): string {
  const content = AEO_CONTENT[page.slug];
  if (content) {
    // First 160 chars of the intro makes an accurate meta description
    return content.intro.length > 157 ? content.intro.slice(0, 157) + "..." : content.intro;
  }
  const map: Record<string, string> = {
    definition: `Clear explanation of ${page.keyword}. Understand how it works and why it matters for AI search in 2026.`,
    comparison: `${page.keyword} — side-by-side breakdown of what's different and which strategy wins in 2026.`,
    howto: `Step-by-step guide: ${page.keyword}. Practical, actionable, and updated for 2026's AI search landscape.`,
    tools: `Best tools for ${page.keyword}. Honest comparison of pricing, features, and ROI — updated for 2026.`,
    advanced: `Deep dive into ${page.keyword}. Expert-level tactics for ranking in ChatGPT, Perplexity, and Google AI Overviews.`,
  };
  return map[page.intent] ?? `Everything you need to know about ${page.keyword} in 2026.`;
}

function buildSchema(page: AeoPage, sections: Section[], faqs: Faq[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": page.intent === "howto" ? "HowTo" : "Article",
        headline: page.title,
        description: buildDescription(page),
        url: `${siteUrl}/aeo-guide/${page.slug}`,
        datePublished: "2026-01-01",
        dateModified: new Date().toISOString().split("T")[0],
        publisher: { "@type": "Organization", name: "OptiAISEO", url: siteUrl },
        ...(page.intent === "howto" && {
          step: sections.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.heading, text: s.body })),
        }),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          { "@type": "ListItem", position: 2, name: "AEO Guides", item: `${siteUrl}/aeo-guide` },
          { "@type": "ListItem", position: 3, name: page.title, item: `${siteUrl}/aeo-guide/${page.slug}` },
        ],
      },
    ],
  };
}

function getRelated(current: AeoPage, count = 6): AeoPage[] {
  return (AEO_PAGES as AeoPage[])
    .filter((p) => p.slug !== current.slug)
    .sort((a, b) => (a.intent === current.intent ? -1 : 1) - (b.intent === current.intent ? -1 : 1))
    .slice(0, count);
}

const INTENT_LABEL: Record<string, string> = {
  definition: "Definition",
  comparison: "Comparison",
  howto: "How-To Guide",
  tools: "Tool Review",
  advanced: "Advanced Strategy",
};

const INTENT_COLOR: Record<string, string> = {
  definition: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  comparison: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  howto: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  tools: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  advanced: "bg-red-500/10 text-red-400 border-red-500/20",
};

// Page component

export default async function AeoGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = (AEO_PAGES as AeoPage[]).find((p) => p.slug === slug);
  if (!page) notFound();

  const pageContent = AEO_CONTENT[slug];
  if (!pageContent) notFound();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online";
  const sections = pageContent.sections;
  const faqs = pageContent.faqs;
  const related = getRelated(page);
  const intro = pageContent.intro;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildSchema(page, sections, faqs, siteUrl)) }}
      />

      <MarketingNav />

      <main className="max-w-3xl mx-auto px-4 py-12 text-foreground">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6 flex items-center gap-2 flex-wrap">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <Link href="/aeo-guide" className="hover:text-foreground transition-colors">AEO Guides</Link>
          <span>/</span>
          <span className="text-foreground truncate">{page.title}</span>
        </nav>

        {/* Header */}
        <header className="mb-10">
          <span className={`inline-flex mb-3 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${INTENT_COLOR[page.intent] ?? INTENT_COLOR.advanced}`}>
            {INTENT_LABEL[page.intent] ?? page.intent}
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight tracking-tight mb-4">
            {page.title}
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">{intro}</p>
        </header>

        {/* Content sections */}
        <article className="space-y-8 mb-12">
          {sections.map((section, i) => (
            <section key={i}>
              <h2 className="text-xl font-bold text-foreground mb-3">{section.heading}</h2>
              <p className="text-muted-foreground leading-relaxed">{section.body}</p>
            </section>
          ))}
        </article>

        {/* FAQ */}
        <section className="mb-12 border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-card">
            <h2 className="text-lg font-bold text-foreground">Frequently Asked Questions</h2>
          </div>
          <div className="divide-y divide-border">
            {faqs.map((faq, i) => (
              <div key={i} className="px-6 py-5">
                <h3 className="font-semibold text-foreground mb-2 text-sm">{faq.q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6 mb-12 text-center">
          <p className="text-sm font-semibold text-violet-300 mb-1">Start tracking your AI Search visibility today</p>
          <h2 className="text-xl font-extrabold text-foreground mb-3">Try OptiAISEO Free</h2>
          <p className="text-muted-foreground text-sm mb-5 max-w-sm mx-auto">
            AEO audits, AI Share of Voice tracking, schema generation, and one-click fixes — all in one dashboard.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-bold text-sm shadow-lg shadow-violet-500/20 hover:opacity-90 transition-all"
          >
            Start Free → No Credit Card
          </Link>
        </section>

        {/* See also — cross-cluster links */}
        <section className="mb-8 p-5 rounded-2xl border border-border bg-card">
          <h2 className="text-sm font-bold text-foreground mb-3">Also useful</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/guide" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">SEO &amp; AEO Guides</Link>
            <Link href="/tools" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">SEO Tool Comparisons</Link>
            <Link href="/guide/robots-txt-ai-search" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">Robots.txt for AI Search</Link>
            <Link href="/guide/seo-vs-aeo-vs-geo" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">SEO vs AEO vs GEO</Link>
          </div>
        </section>

        {/* Related guides */}
        <section aria-label="Related AEO guides" className="mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4">Related AEO Guides</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {related.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/aeo-guide/${p.slug}`}
                  className="flex items-start gap-2 p-3 rounded-xl border border-border hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group text-sm"
                >
                  <span className="mt-0.5 text-violet-400 font-bold shrink-0">→</span>
                  <span className="text-muted-foreground group-hover:text-foreground transition-colors leading-snug">
                    {p.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="border-t border-border pt-6 text-xs text-muted-foreground flex flex-wrap gap-4 justify-between">
          <span>Last updated: {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
          <Link href="/aeo-guide" className="hover:text-foreground transition-colors">← All AEO Guides</Link>
        </footer>
      </main>

      <SiteFooter />
    </>
  );
}
