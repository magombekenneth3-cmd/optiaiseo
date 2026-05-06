import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
const PAGE_URL = `${SITE_URL}/pseo`;
const TITLE = "What Is Programmatic SEO (pSEO)? Complete Guide 2026 | OptiAISEO";
const DESC = "Learn what programmatic SEO is, how it works, and how to scale to thousands of pages in 2026. Real examples, templates, and step-by-step playbook.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: PAGE_URL },
  robots: { index: true, follow: true },
  keywords: [
    "programmatic SEO",
    "pSEO",
    "what is programmatic SEO",
    "programmatic SEO examples",
    "pSEO guide 2026",
    "scale SEO pages",
    "long-tail SEO strategy",
  ],
  openGraph: {
    title: TITLE,
    description: DESC,
    url: PAGE_URL,
    type: "article",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
    images: ["/og-image.png"],
  },
};

const schemas = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "What Is Programmatic SEO (pSEO)?",
    url: PAGE_URL,
    description: DESC,
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "pSEO Guide", item: PAGE_URL },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: TITLE,
    description: DESC,
    url: PAGE_URL,
    datePublished: "2024-09-01",
    dateModified: new Date().toISOString().split("T")[0],
    author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Build a Programmatic SEO Site",
    description: "Step-by-step guide to deploying pSEO at scale.",
    step: [
      { "@type": "HowToStep", position: 1, name: "Identify a Keyword Pattern", text: "Find a repeatable query pattern — e.g., '[Service] in [City]' or 'Best [Tool] for [Use Case]'." },
      { "@type": "HowToStep", position: 2, name: "Build a Data Source", text: "Create a spreadsheet or database with rows for every variation (cities, tools, niches)." },
      { "@type": "HowToStep", position: 3, name: "Design a Page Template", text: "Build a single page template with placeholder slots for each data variable." },
      { "@type": "HowToStep", position: 4, name: "Generate the Pages", text: "Use a CMS or Next.js dynamic routing to auto-generate one page per data row." },
      { "@type": "HowToStep", position: 5, name: "Add Unique Content Per Page", text: "Ensure each page has unique headings, descriptions, and at least one differentiating fact to avoid duplicate content penalties." },
      { "@type": "HowToStep", position: 6, name: "Monitor & Prune", text: "After 6 months, identify pages with zero traffic and either improve or de-index them." },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Programmatic SEO (pSEO)?",
        acceptedAnswer: { "@type": "Answer", text: "Programmatic SEO is the process of generating thousands of unique landing pages from a single template and a structured data source, targeting long-tail keyword patterns at scale." },
      },
      {
        "@type": "Question",
        name: "What are examples of pSEO?",
        acceptedAnswer: { "@type": "Answer", text: "Zapier's 50,000+ integration pages ('Connect X to Y'), Airbnb's location pages ('Rentals in [City]'), Nomad List's city comparison pages, and G2's product review pages." },
      },
      {
        "@type": "Question",
        name: "Does Google penalize programmatic SEO?",
        acceptedAnswer: { "@type": "Answer", text: "Only if the pages are thin, duplicate, or provide no real value. Google's Helpful Content system rewards depth. Ensure each pSEO page has unique data, genuine differentiators, and relevant schema markup." },
      },
      {
        "@type": "Question",
        name: "What is the difference between pSEO and blogging?",
        acceptedAnswer: { "@type": "Answer", text: "Blogging targets broad, editorial keywords one post at a time. pSEO targets long-tail, high-intent keyword patterns at scale — hundreds or thousands of variations simultaneously, often with data-driven content." },
      },
      {
        "@type": "Question",
        name: "How do I avoid duplicate content with programmatic SEO?",
        acceptedAnswer: { "@type": "Answer", text: "Include at least one unique data point per page. Use canonical tags correctly. Ensure templates produce meaningfully different headings and descriptions for each variation. Avoid identical paragraphs." },
      },
      {
        "@type": "Question",
        name: "How do I find keyword patterns for pSEO?",
        acceptedAnswer: { "@type": "Answer", text: "Look for search queries with a repetitive structure and high search volume at the pattern level: '[Product] vs [Product]', '[Service] in [Location]', 'Best [Category] for [Persona]'." },
      },
    ],
  },
];

const STEPS = [
  { n: 1, t: "Identify a Keyword Pattern", d: "Find a repeatable query structure — '[Service] in [City]', 'Best [Tool] for [Use Case]', '[Brand] vs [Competitor]'. The pattern should have high combined volume." },
  { n: 2, t: "Build a Data Source", d: "Create a spreadsheet or database with one row per variation. Each row becomes one page. Minimum viable columns: title variable, slug, and 1–2 differentiating facts." },
  { n: 3, t: "Design a Page Template", d: "Build a single template with placeholder slots. Use Next.js dynamic routes or your CMS. The template must produce a semantically unique H1 for every variation." },
  { n: 4, t: "Generate the Pages", d: "Deploy pages programmatically. Each slug maps to one data row. Add FAQPage and BreadcrumbList JSON-LD schema to every page for AEO coverage." },
  { n: 5, t: "Add Unique Content Per Page", d: "Each page needs at least one genuinely unique element — local statistics, custom table row, unique CTA. Thin clones trigger Google's Helpful Content system." },
  { n: 6, t: "Monitor & Prune", d: "After 6 months, identify pages with zero impressions in GSC. Consolidate or de-index. Double down on top performers with internal links and additional content." },
];

const EXAMPLES = [
  { brand: "Zapier", pattern: "Connect [App A] to [App B]", pages: "50,000+" },
  { brand: "Airbnb", pattern: "Rentals in [City, Region]", pages: "100,000+" },
  { brand: "Nomad List", pattern: "Best cities for [Persona]", pages: "1,000+" },
  { brand: "G2", pattern: "[Software] Reviews & Alternatives", pages: "80,000+" },
  { brand: "OptiAISEO", pattern: "[Competitor] Alternative", pages: "20+" },
];

const FAQS = [
  { q: "What is Programmatic SEO (pSEO)?", a: "Programmatic SEO is the process of generating thousands of unique landing pages from a single template and a structured data source, targeting long-tail keyword patterns at scale — without writing each page manually." },
  { q: "What are examples of pSEO?", a: "Zapier's 50,000+ integration pages ('Connect X to Y'), Airbnb's location pages ('Rentals in [City]'), Nomad List's city comparison pages, and G2's product review pages are the canonical pSEO examples." },
  { q: "Does Google penalize programmatic SEO?", a: "Only if pages are thin, duplicate, or provide no real value. Google's Helpful Content system rewards depth. Ensure each page has unique data, genuine differentiators, and relevant schema markup to avoid penalties." },
  { q: "What is the difference between pSEO and blogging?", a: "Blogging targets broad editorial keywords one post at a time. pSEO targets long-tail keyword patterns at scale — hundreds or thousands of variations simultaneously, usually with structured, data-driven content." },
  { q: "How do I avoid duplicate content with pSEO?", a: "Include at least one unique data point per page. Ensure templates produce different headings and descriptions per variation. Use canonical tags correctly. Avoid identical paragraphs duplicated verbatim across pages." },
  { q: "How do I find keyword patterns for pSEO?", a: "Look for queries with a repetitive structure and high aggregate volume: '[Product] vs [Product]', '[Service] in [Location]', 'Best [Category] for [Persona]'. OptiAISEO's Keyword Discovery tool surfaces pSEO-ready patterns." },
];

const RELATED = [
  { label: "SEO — Search Engine Optimization", href: "/seo" },
  { label: "GEO — Generative Engine Optimization", href: "/geo" },
  { label: "AEO — Answer Engine Optimization", href: "/aeo" },
  { label: "AIO — AI Optimization", href: "/aio" },
  { label: "Free SEO Audit Tool", href: "/free/seo-checker" },
];

export default function PseoPage() {
  return (
    <>
      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />
      ))}

      <div className="min-h-screen bg-background text-foreground">

        {/* ── Nav ── */}
        <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="font-display font-bold text-lg text-foreground">
              Opti<span className="text-[#10b981]">AI</span>SEO
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Pricing</Link>
              <Link href="/free/seo-checker" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Free Audit</Link>
              <Link href="/signup" className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#10b981] text-black hover:bg-[#0ea572] transition-colors">Start Free</Link>
            </div>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="relative py-20 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(16,185,129,0.1),transparent)]" />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav aria-label="Breadcrumb" className="flex justify-center gap-2 text-muted-foreground text-sm mb-6">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
              <span>/</span>
              <span className="text-foreground">pSEO Guide</span>
            </nav>
            <div className="inline-flex items-center gap-2 bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-4 py-1.5 text-sm font-medium text-[#10b981] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
              Scale to 10,000 Pages — 2026 Playbook
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight mb-6 leading-tight">
              What Is <span className="text-[#10b981]">Programmatic</span><br />SEO (pSEO)?
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              One template. Thousands of unique pages. pSEO is how the fastest-growing sites capture long-tail keyword demand at a scale impossible with manual content writing.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/signup" className="px-8 py-3 bg-[#10b981] text-black rounded-xl font-semibold hover:bg-[#0ea572] transition-colors">Find pSEO Opportunities →</Link>
              <Link href="/free/seo-checker" className="px-8 py-3 bg-card border border-border rounded-xl font-semibold hover:bg-muted transition-colors">Free Site Audit</Link>
            </div>
          </div>
        </section>

        {/* ── Definition ── */}
        <section id="pseo-definition" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-6">What Is Programmatic SEO?</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            <strong className="text-foreground">Programmatic SEO (pSEO)</strong> is the strategy of automatically generating large numbers of SEO-optimized landing pages from a single template and structured data. Instead of writing 10 blog posts manually, pSEO creates 10,000 pages targeting long-tail keyword variations — each one unique, indexed, and ranking.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Zapier does it with integration pages. Airbnb does it with location pages. G2 does it with review pages. Every page targets a unique long-tail query while sharing a proven conversion template. The aggregate traffic across thousands of low-volume keywords compounds into millions of monthly visitors.
          </p>
        </section>

        {/* ── How pSEO Works ── */}
        <section id="how-pseo-works" className="py-16 px-6 max-w-4xl mx-auto border-t border-border">
          <h2 className="text-3xl font-display font-bold mb-6">How Programmatic SEO Works</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            pSEO works by identifying a keyword pattern — a query structure that repeats with different variables — and then generating one optimized page for every variable combination. The mechanics are straightforward: a data source (spreadsheet or database), a page template, and a routing layer that maps each data row to a unique URL.
          </p>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            The critical requirement is differentiation. Google&apos;s Helpful Content system penalizes thin clones. Each page must have at least one genuinely unique element — a local statistic, a data-driven comparison row, or a unique CTA — to avoid being treated as duplicate content. Learn how <Link href="/aeo" className="text-[#10b981] hover:underline">answer engine optimization</Link> layers on top to make each page AI-visible too.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            When done correctly, pSEO captures the long tail that manual <Link href="/seo" className="text-[#10b981] hover:underline">SEO</Link> can never reach. A site with 50,000 pages targeting niche queries will outrank a site with 50 blog posts almost every time — not because any individual page is better, but because the aggregate surface area is orders of magnitude larger.
          </p>
        </section>

        {/* ── pSEO vs Blogging ── */}
        <section id="pseo-vs-blogging" className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-display font-bold mb-8">pSEO vs Blogging</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 pr-6 font-semibold text-foreground w-1/3"></th>
                    <th className="text-left py-3 pr-6 font-semibold text-[#10b981]">Programmatic SEO</th>
                    <th className="text-left py-3 font-semibold text-muted-foreground">Blogging</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {[
                    ["Scale", "Thousands of pages", "One post at a time"],
                    ["Keyword type", "Long-tail, high-intent", "Broad, editorial"],
                    ["Content", "Data-driven, structured", "Narrative, editorial"],
                    ["Time to build", "Days (once template done)", "Weeks per post"],
                    ["Risk", "Thin content if done wrong", "Lower duplicate risk"],
                    ["Best for", "Scale & long-tail capture", "Authority & brand topics"],
                  ].map(([label, pseo, blog]) => (
                    <tr key={label} className="border-b border-border/50">
                      <td className="py-3 pr-6 font-medium text-foreground">{label}</td>
                      <td className="py-3 pr-6">{pseo}</td>
                      <td className="py-3">{blog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Real Examples ── */}
        <section className="py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-display font-bold text-center mb-10">Real pSEO Examples</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
                <thead className="bg-card border-b border-border">
                  <tr>
                    {["Brand", "Keyword Pattern", "Estimated Pages"].map(h => (
                      <th key={h} className="px-5 py-3 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {EXAMPLES.map(({ brand, pattern, pages }) => (
                    <tr key={brand} className="hover:bg-card/50 transition-colors">
                      <td className="px-5 py-3 font-semibold">{brand}</td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{pattern}</td>
                      <td className="px-5 py-3 font-bold text-[#10b981]">{pages}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Is pSEO Worth It ── */}
        <section id="is-pseo-worth-it" className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-display font-bold mb-6">Is Programmatic SEO Worth It in 2026?</h2>
            <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
              Yes — but the bar for quality has risen. Google&apos;s 2024–2025 Helpful Content updates decimated low-quality pSEO sites that published identical templated pages with no differentiation. Sites that invested in genuine uniqueness per page saw traffic hold or grow significantly.
            </p>
            <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
              The winners in 2026 combine pSEO scale with AI-generated differentiation — unique stats, dynamic comparisons, and real data per page. This makes each page genuinely useful while maintaining the production speed that makes pSEO worthwhile.
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              For SaaS, local services, marketplaces, and tools directories, pSEO remains the fastest path to significant organic traffic. Pair it with <Link href="/geo" className="text-[#10b981] hover:underline">GEO</Link> and <Link href="/aeo" className="text-[#10b981] hover:underline">AEO</Link> to ensure your pages surface in AI-generated answers too.
            </p>
          </div>
        </section>

        {/* ── HowTo Steps ── */}
        <section className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10">How to Build a pSEO Site: 6-Step Playbook</h2>
          <ol className="space-y-6">
            {STEPS.map(({ n, t, d }) => (
              <li key={n} className="flex gap-5">
                <div className="shrink-0 w-9 h-9 rounded-full bg-[#10b981]/10 border border-[#10b981]/25 flex items-center justify-center text-[#10b981] font-bold text-sm">{n}</div>
                <div>
                  <h3 className="font-semibold text-base mb-1">{t}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── CTA ── */}
        <section className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-display font-bold mb-4">Find Your pSEO Keyword Patterns</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              OptiAISEO&apos;s Keyword Discovery tool identifies repeatable query patterns your site is missing — the foundation of every pSEO strategy.
            </p>
            <Link href="/signup" className="inline-block px-10 py-3.5 bg-[#10b981] text-black rounded-xl font-bold hover:bg-[#0ea572] transition-colors">
              Start Free — No Credit Card
            </Link>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq-heading" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10 text-center">pSEO Frequently Asked Questions</h2>
          <div className="space-y-4">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/20 transition-colors">
                <h3 className="font-semibold text-base mb-2">{q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Related ── */}
        <section className="py-12 px-6 bg-card/30 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-muted-foreground font-medium mb-4">Related Optimization Disciplines</p>
            <div className="flex flex-wrap gap-2">
              {RELATED.map(({ label, href }) => (
                <Link key={href} href={href} className="px-4 py-2 bg-card border border-border rounded-lg text-sm hover:border-[#10b981]/40 hover:text-[#10b981] transition-colors">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </>
  );
}