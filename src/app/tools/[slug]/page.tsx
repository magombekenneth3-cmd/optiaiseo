import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import KEYWORDS from "@/data/keywords.json";
import SiteFooter from "@/components/marketing/SiteFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";

// Types

interface ToolEntry {
  name: string;
  description: string;
  price: string;
  badge?: string;
  href: string;
  why: string;
  verdict: string;
  score: number;
  pros: string[];
  cons: string[];
}

interface FaqItem {
  q: string;
  a: string;
}

interface Keyword {
  slug: string;
  keyword: string;
  title: string;
  intent: string;
  region: string;
  regionCode: string;
  intro: string;
  marketContext: string;
  tools: ToolEntry[];
  faq: FaqItem[];
  comparisonCriteria: string[];
  verdict: string;
}

export async function generateStaticParams() {
  return (KEYWORDS as Keyword[]).map((k) => ({ slug: k.slug }));
}

// Metadata

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = (KEYWORDS as Keyword[]).find((k) => k.slug === slug);
  if (!page) return { title: "Not Found" };

  const description = `Discover the best ${page.keyword} in 2026. Honest comparison of pricing, features, and ROI.${page.region && page.region !== "Global" ? ` Optimised for ${page.region}.` : ""} Updated monthly.`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online";

  return {
    title: page.title,
    description,
    alternates: { canonical: `${siteUrl}/tools/${page.slug}` },
    openGraph: {
      title: page.title,
      description,
      url: `${siteUrl}/tools/${page.slug}`,
      type: "article",
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description,
      images: ["/og-image.png"],
    },
  };
}

// Helpers

function getRelated(current: Keyword, count = 6): Keyword[] {
  return (KEYWORDS as Keyword[])
    .filter((k) => k.slug !== current.slug)
    .sort((a, b) => {
      const aScore =
        (a.intent === current.intent ? 2 : 0) +
        (a.region === current.region ? 1 : 0);
      const bScore =
        (b.intent === current.intent ? 2 : 0) +
        (b.region === current.region ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, count);
}

function buildSchema(page: Keyword, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: page.title,
        description: `Discover the best ${page.keyword} in 2026.`,
        url: `${siteUrl}/tools/${page.slug}`,
        datePublished: "2026-01-01",
        dateModified: new Date().toISOString().split("T")[0],
        publisher: {
          "@type": "Organization",
          name: "OptiAISEO",
          url: siteUrl,
        },
      },
      {
        "@type": "ItemList",
        name: page.title,
        numberOfItems: page.tools.length,
        itemListElement: page.tools.map((tool, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "SoftwareApplication",
            name: tool.name,
            description: tool.why,
            offers: { "@type": "Offer", price: tool.price },
            url: tool.href,
          },
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.a,
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          { "@type": "ListItem", position: 2, name: "SEO Tools", item: `${siteUrl}/tools` },
          { "@type": "ListItem", position: 3, name: page.title, item: `${siteUrl}/tools/${page.slug}` },
        ],
      },
    ],
  };
}

// Page component

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = (KEYWORDS as Keyword[]).find((k) => k.slug === slug);
  if (!page) notFound();

  const related = getRelated(page);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online";

  const intentLabel: Record<string, string> = {
    free: "Free Tools",
    cheap: "Affordable Picks",
    best: "Top Rated",
    alternative: "Best Alternatives",
    ai: "AI-Powered",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildSchema(page, siteUrl)) }}
      />

      <MarketingNav />

      <main className="max-w-3xl mx-auto px-4 py-12 text-foreground">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <Link href="/tools" className="hover:text-foreground transition-colors">SEO Tools</Link>
          <span>/</span>
          <span className="text-foreground truncate">{page.title}</span>
        </nav>

        {/* Header */}
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {intentLabel[page.intent] ?? page.intent}
            </span>
            {page.region && page.region !== "Global" && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {page.region}
              </span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight tracking-tight mb-4">
            {page.title}
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">{page.intro}</p>
        </header>

        {/* Market Context */}
        <section className="mb-10 p-5 rounded-2xl border border-border bg-card">
          <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            Market Context
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{page.marketContext}</p>
        </section>

        {/* Tool list */}
        <section aria-label="Tool list" className="space-y-5 mb-12">
          <h2 className="text-xl font-bold text-foreground">
            Top {page.tools.length} {intentLabel[page.intent] ?? "Picks"} for {page.keyword}
          </h2>
          <ol className="space-y-5">
            {page.tools.map((tool, i) => (
              <li
                key={`${tool.name}-${i}`}
                className="relative p-5 rounded-2xl border border-border bg-card hover:border-violet-500/30 transition-colors group"
              >
                {/* Header row */}
                <div className="flex items-start gap-4 mb-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500/10 text-violet-400 font-black text-sm flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-bold text-foreground text-base">{tool.name}</h3>
                      {tool.badge && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {tool.badge}
                        </span>
                      )}
                      <span className="ml-auto text-sm font-semibold text-muted-foreground">
                        {tool.price}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Why this tool — unique per page */}
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {tool.why}
                </p>

                {/* Pros / Cons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1.5">Pros</div>
                    <ul className="space-y-1">
                      {tool.pros.map((pro) => (
                        <li key={pro} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                          {pro}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-rose-400 mb-1.5">Cons</div>
                    <ul className="space-y-1">
                      {tool.cons.map((con) => (
                        <li key={con} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <span className="text-rose-400 mt-0.5 shrink-0">✗</span>
                          {con}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Verdict */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/10">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-500/10 text-violet-400 font-black text-sm shrink-0">
                    {tool.score}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tool.verdict}</p>
                </div>

                {/* Visit link */}
                <a
                  href={tool.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                  aria-label={`Visit ${tool.name}`}
                >
                  Visit {tool.name} →
                </a>
              </li>
            ))}
          </ol>
        </section>

        {/* Comparison Table */}
        <section className="mb-12">
          <h2 className="text-lg font-bold text-foreground mb-4">Quick Comparison</h2>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="text-left p-3 font-bold text-foreground">Tool</th>
                  <th className="text-left p-3 font-bold text-foreground">Price</th>
                  <th className="text-center p-3 font-bold text-foreground">Score</th>
                  {page.comparisonCriteria.slice(0, 2).map((c) => (
                    <th key={c} className="text-left p-3 font-bold text-foreground hidden sm:table-cell">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.tools.map((tool, i) => (
                  <tr key={`${tool.name}-row-${i}`} className={`border-b border-border/50 ${i === 0 ? "bg-violet-500/5" : ""}`}>
                    <td className="p-3 font-semibold text-foreground">{tool.name}</td>
                    <td className="p-3 text-muted-foreground">{tool.price}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-black ${
                        tool.score >= 9 ? "bg-emerald-500/10 text-emerald-400" :
                        tool.score >= 7 ? "bg-blue-500/10 text-blue-400" :
                        "bg-zinc-500/10 text-zinc-400"
                      }`}>
                        {tool.score}
                      </span>
                    </td>
                    {page.comparisonCriteria.slice(0, 2).map((c) => (
                      <td key={c} className="p-3 text-muted-foreground hidden sm:table-cell">
                        <span className={`inline-flex items-center gap-1 text-xs ${
                          tool.score >= 8 ? "text-emerald-400" : tool.score >= 6 ? "text-blue-400" : "text-zinc-400"
                        }`}>
                          {tool.score >= 8 ? "●●●" : tool.score >= 6 ? "●●○" : "●○○"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Page Verdict */}
        <section className="mb-12 p-6 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/20">
          <h2 className="text-lg font-bold text-foreground mb-2">Our Verdict</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{page.verdict}</p>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-lg font-bold text-foreground mb-4">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {page.faq.map((item, i) => (
              <details key={`faq-${i}`} className="group rounded-2xl border border-border bg-card overflow-hidden">
                <summary className="flex items-center justify-between gap-4 p-4 cursor-pointer text-sm font-bold text-foreground select-none">
                  <span>{item.q}</span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-180 shrink-0">▾</span>
                </summary>
                <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6 mb-12 text-center">
          <p className="text-sm font-semibold text-violet-300 mb-1">Want AI-powered SEO without the enterprise price tag?</p>
          <h2 className="text-xl font-extrabold text-foreground mb-3">Try OptiAISEO Free</h2>
          <p className="text-muted-foreground text-sm mb-5 max-w-sm mx-auto">
            AEO audits, GEO tracking, technical site audits, and AI-generated fixes — all in one dashboard.
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
            <Link href="/aeo-guide" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-violet-500/50 hover:text-violet-400 transition-colors">AEO Deep Dives</Link>
            <Link href="/guide/robots-txt-ai-search" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">Robots.txt for AI Search</Link>
            <Link href="/guide/seo-vs-aeo-vs-geo" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-[#10b981]/50 hover:text-[#10b981] transition-colors">SEO vs AEO vs GEO</Link>
          </div>
        </section>

        {/* Related guides */}
        <section aria-label="Related guides" className="mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4">Related SEO Tool Guides</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {related.map((k) => (
              <li key={k.slug}>
                <Link
                  href={`/tools/${k.slug}`}
                  className="flex items-start gap-2 p-3 rounded-xl border border-border hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group text-sm"
                >
                  <span className="mt-0.5 text-violet-400 font-bold shrink-0">→</span>
                  <span className="text-muted-foreground group-hover:text-foreground transition-colors leading-snug">
                    {k.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Footer meta */}
        <footer className="border-t border-border pt-6 text-xs text-muted-foreground flex flex-wrap gap-4 justify-between items-center">
          <span>Last updated: {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
          <Link href="/tools" className="hover:text-foreground transition-colors">← All SEO Tool Guides</Link>
        </footer>
      </main>

      <SiteFooter />
    </>
  );
}
