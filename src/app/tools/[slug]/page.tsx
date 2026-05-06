import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import KEYWORDS from "@/data/keywords.json";
import SiteFooter from "@/components/marketing/SiteFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Keyword {
  slug: string;
  keyword: string;
  title: string;
  intent: string;
  region: string;
  regionCode: string;
}

interface Tool {
  name: string;
  description: string;
  price: string;
  badge?: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Static params — pre-renders all 100 pages at build time
// ---------------------------------------------------------------------------

export async function generateStaticParams() {
  return (KEYWORDS as Keyword[]).map((k) => ({ slug: k.slug }));
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = (KEYWORDS as Keyword[]).find((k) => k.slug === slug);
  if (!page) return { title: "Not Found" };

  const description = buildDescription(page);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online";

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

// ---------------------------------------------------------------------------
// Tool catalogue — expanded by intent
// ---------------------------------------------------------------------------

const ALL_TOOLS: Tool[] = [
  // Free
  { name: "Google Search Console", description: "Official free tool for monitoring search performance, indexing issues, and keyword data.", price: "Free forever", badge: "Official", href: "https://search.google.com/search-console" },
  { name: "Google Analytics 4", description: "Free web analytics platform. Track organic traffic, conversions, and user behaviour.", price: "Free forever", badge: "Official", href: "https://analytics.google.com" },
  { name: "Ubersuggest Free", description: "Neil Patel's tool provides 3 free daily searches for keywords, backlinks, and site audits.", price: "Free (3/day)", href: "https://app.neilpatel.com/en/ubersuggest" },
  { name: "AnswerThePublic", description: "Visualises the questions and queries people search around any keyword. Great for content ideation.", price: "Free (limited)", href: "https://answerthepublic.com" },
  { name: "Ahrefs Webmaster Tools", description: "Free version of Ahrefs for your own site. Crawl issues, backlinks, and keyword data.", price: "Free for site owners", badge: "Top Pick", href: "https://ahrefs.com/webmaster-tools" },
  { name: "Screaming Frog (Free)", description: "Crawl up to 500 URLs free. Find broken links, duplicate titles, and redirect chains.", price: "Free up to 500 URLs", href: "https://www.screamingfrog.co.uk/seo-spider" },
  { name: "Keyword Surfer Extension", description: "Chrome extension showing monthly search volumes directly in Google results.", price: "Free", href: "https://surferseo.com/keyword-surfer-extension" },
  { name: "SEOquake Extension", description: "Free Chrome extension. Shows SEO metrics (DA, backlinks, index status) on any SERP.", price: "Free", href: "https://www.seoquake.com" },

  // Cheap / Affordable
  { name: "SE Ranking", description: "Full-suite SEO platform with rank tracking, site audit, backlink monitor, and keyword research. Most affordable professional option.", price: "From $4/mo", badge: "Best Value", href: "https://seranking.com" },
  { name: "Mangools (KWFinder)", description: "Beginner-friendly keyword research, SERP analysis, and rank tracking. Clean UI and accurate data.", price: "From $29/mo", href: "https://mangools.com" },
  { name: "Ubersuggest Pro", description: "Paid tier unlocks unlimited searches, competitor tracking, and content ideas. Excellent value.", price: "From $12/mo", href: "https://app.neilpatel.com" },
  { name: "Serpstat", description: "All-in-one SEO platform covering keywords, backlinks, site audits, and PPC research.", price: "From $59/mo", href: "https://serpstat.com" },
  { name: "Morningscore", description: "Gamified SEO tool with rank tracking, site health scoring, and actionable missions.", price: "From $49/mo", href: "https://morningscore.io" },
  { name: "DinoRANK", description: "Budget-friendly rank tracker with semantic SEO features. Popular in Spanish-speaking markets.", price: "From €19/mo", href: "https://dinorank.com" },

  // Best / Pro
  { name: "OptiAISEO", description: "AI-native SEO platform combining AEO, GEO, technical audits, and content strategy in one dashboard.", price: "From $29/mo", badge: "AI-First", href: "https://www.optiaiseo.online" },
  { name: "Semrush", description: "Industry-leading SEO suite. 55+ tools covering keyword research, site audit, content, and competitive intelligence.", price: "From $139/mo", href: "https://www.semrush.com" },
  { name: "Ahrefs", description: "Best backlink database in the industry. Excellent for keyword research and competitor gap analysis.", price: "From $129/mo", href: "https://ahrefs.com" },
  { name: "Moz Pro", description: "Trusted SEO platform with DA/PA scoring, keyword research, and link building tools.", price: "From $99/mo", href: "https://moz.com/pro" },
  { name: "Surfer SEO", description: "On-page content optimiser that benchmarks your content against top-ranking pages in real time.", price: "From $89/mo", href: "https://surferseo.com" },
  { name: "Clearscope", description: "Premium content optimisation platform used by enterprise SEO teams. Excellent for scaling content.", price: "From $189/mo", href: "https://www.clearscope.io" },

  // AI
  { name: "OptiAISEO", description: "Purpose-built for AI search: AEO audits, GEO tracking, citation monitoring, and AI-generated fix recommendations.", price: "From $29/mo", badge: "AI-First", href: "https://www.optiaiseo.online" },
  { name: "MarketMuse", description: "AI content strategy platform. Automates content briefs, gap analysis, and topical authority scoring.", price: "From $149/mo", href: "https://www.marketmuse.com" },
  { name: "Frase.io", description: "AI content brief and optimisation tool. Generates SERP-driven outlines in minutes.", price: "From $45/mo", href: "https://www.frase.io" },
  { name: "NeuronWriter", description: "NLP-powered content editor with semantic optimisation and competitor analysis.", price: "From $23/mo", badge: "Best Value AI", href: "https://neuronwriter.com" },
  { name: "Perplexity Pages", description: "Leverage Perplexity AI to create citation-rich content that appears in AI-generated answers.", price: "From $20/mo", href: "https://www.perplexity.ai" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTools(intent: string): Tool[] {
  const map: Record<string, string[]> = {
    free: ["Google Search Console", "Google Analytics 4", "Ubersuggest Free", "AnswerThePublic", "Ahrefs Webmaster Tools", "Screaming Frog (Free)", "Keyword Surfer Extension", "SEOquake Extension"],
    cheap: ["SE Ranking", "Mangools (KWFinder)", "Ubersuggest Pro", "Serpstat", "Morningscore", "OptiAISEO"],
    best: ["OptiAISEO", "Semrush", "Ahrefs", "Moz Pro", "Surfer SEO", "SE Ranking"],
    alternative: ["OptiAISEO", "SE Ranking", "Mangools (KWFinder)", "Serpstat", "Ubersuggest Pro", "Morningscore"],
    ai: ["OptiAISEO", "MarketMuse", "Frase.io", "NeuronWriter", "Perplexity Pages", "Surfer SEO"],
  };
  const names = map[intent] ?? map["best"];
  return names
    .map((name) => ALL_TOOLS.find((t) => t.name === name))
    .filter((t): t is Tool => t !== undefined);
}

function buildIntro(page: Keyword): string {
  const intros: Record<string, string[]> = {
    free: [
      `Finding quality ${page.keyword} doesn't have to cost a penny. We've tested dozens of tools so you don't have to.`,
      `If you're in ${page.region || "the market"} and working with a tight budget, these ${page.keyword} deliver real value at zero cost.`,
      `We evaluated every major ${page.keyword} available in 2026. Here are the ones actually worth your time.`,
    ],
    cheap: [
      `You don't need to spend hundreds to rank well. These ${page.keyword} deliver enterprise-level insights at a fraction of the price.`,
      `If you're operating in ${page.region || "a budget-conscious market"}, these affordable options give you the features that matter most.`,
      `After testing 30+ tools, we found that the best ${page.keyword} don't cost a fortune. Here's what we recommend.`,
    ],
    best: [
      `Choosing the right ${page.keyword} is one of the most important decisions for your online growth strategy.`,
      `We benchmarked the top ${page.keyword} across accuracy, usability, and ROI so you can make the right call.`,
      `Whether you're a solo founder or running an agency${page.region ? ` in ${page.region}` : ""}, these tools will help you move faster.`,
    ],
    alternative: [
      `Looking for a ${page.keyword}? You're not alone. Thousands of teams switch every month — and the options have never been better.`,
      `The best ${page.keyword} doesn't just cost less — it needs to match your workflow, team size, and reporting requirements.`,
      `We compared 20+ alternatives so you don't have to spend weeks testing tools that won't fit your needs.`,
    ],
    ai: [
      `AI is reshaping search. The best ${page.keyword} now helps you rank not just in Google, but in ChatGPT, Perplexity, and Google AI Overviews.`,
      `We tested every major ${page.keyword} to see which ones actually improve AI search visibility — not just keyword rankings.`,
      `The teams winning in 2026 are using ${page.keyword} to dominate generative search. Here's what's working.`,
    ],
  };
  const options = intros[page.intent] ?? intros["best"];
  return options[Math.abs(page.slug.length) % options.length];
}

function buildDescription(page: Keyword): string {
  const regionSuffix = page.region && page.region !== "Global" ? ` Optimised for ${page.region}.` : "";
  return `Discover the best ${page.keyword} in 2026. Honest comparison of pricing, features, and ROI.${regionSuffix} Updated monthly.`;
}

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
  const tools = getTools(page.intent);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: page.title,
        description: buildDescription(page),
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
        numberOfItems: tools.length,
        itemListElement: tools.map((tool, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "SoftwareApplication",
            name: tool.name,
            description: tool.description,
            offers: { "@type": "Offer", price: tool.price },
            url: tool.href,
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

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = (KEYWORDS as Keyword[]).find((k) => k.slug === slug);
  if (!page) notFound();

  const tools = getTools(page.intent);
  const related = getRelated(page);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online";
  const intro = buildIntro(page);

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
          <p className="text-muted-foreground text-lg leading-relaxed">{intro}</p>
        </header>

        {/* Tool list */}
        <section aria-label="Tool list" className="space-y-4 mb-12">
          <h2 className="text-xl font-bold text-foreground">
            Top {tools.length} {intentLabel[page.intent] ?? "Picks"} for {page.keyword}
          </h2>
          <ol className="space-y-4">
            {tools.map((tool, i) => (
              <li
                key={tool.name}
                className="relative flex gap-4 p-5 rounded-2xl border border-border bg-card hover:border-violet-500/30 transition-colors group"
              >
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
                  <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
                  <a
                    href={tool.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                    aria-label={`Visit ${tool.name}`}
                  >
                    Visit {tool.name} →
                  </a>
                </div>
              </li>
            ))}
          </ol>
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
