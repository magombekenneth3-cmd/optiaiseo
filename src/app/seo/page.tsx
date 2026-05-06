import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
const PAGE_URL = `${SITE_URL}/seo`;
const TITLE = "What Is SEO? Complete Guide for 2026 | OptiAISEO";
const DESC = "Learn what SEO is, how it works, and how to rank higher on Google in 2026. Step-by-step SEO guide for beginners and advanced users.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: PAGE_URL },
  robots: { index: true, follow: true },
  keywords: [
    "what is SEO",
    "SEO meaning",
    "how SEO works",
    "SEO guide 2026",
    "technical SEO",
    "on page SEO",
    "off page SEO",
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
    name: "What Is SEO?",
    url: PAGE_URL,
    description: DESC,
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "SEO Guide", item: PAGE_URL },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: TITLE,
    description: DESC,
    url: PAGE_URL,
    datePublished: "2026-01-01",
    dateModified: new Date().toISOString().split("T")[0],
    author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Optimize a Website for SEO in 2026",
    description: "Step-by-step guide to ranking higher in Google.",
    step: [
      { "@type": "HowToStep", position: 1, name: "Run a Technical SEO Audit", text: "Crawl your site for broken links, missing meta tags, slow Core Web Vitals, and schema errors." },
      { "@type": "HowToStep", position: 2, name: "Fix On-Page Signals", text: "Optimize title tags, meta descriptions, H1s, and internal links." },
      { "@type": "HowToStep", position: 3, name: "Implement Schema Markup", text: "Add JSON-LD schemas to earn rich results." },
      { "@type": "HowToStep", position: 4, name: "Build Topical Authority", text: "Create content clusters around your niche." },
      { "@type": "HowToStep", position: 5, name: "Earn Backlinks", text: "Get links from relevant high-authority sites." },
      { "@type": "HowToStep", position: 6, name: "Track Rankings", text: "Monitor keyword positions and improve weak pages." },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is SEO?",
        acceptedAnswer: { "@type": "Answer", text: "SEO is the process of improving a website's visibility in search engines by optimizing content, technical structure, and authority signals." },
      },
      {
        "@type": "Question",
        name: "How long does SEO take?",
        acceptedAnswer: { "@type": "Answer", text: "SEO typically takes 3–6 months to show results, depending on competition and site authority." },
      },
      {
        "@type": "Question",
        name: "What are Core Web Vitals?",
        acceptedAnswer: { "@type": "Answer", text: "Google's UX metrics: LCP (load speed <2.5s), INP (responsiveness <200ms), CLS (layout stability <0.1). Pages passing all three earn a ranking advantage." },
      },
      {
        "@type": "Question",
        name: "What is technical SEO?",
        acceptedAnswer: { "@type": "Answer", text: "Technical SEO covers crawlability, HTTPS, sitemaps, structured data, canonical tags, hreflang, and Core Web Vitals optimization." },
      },
      {
        "@type": "Question",
        name: "Does AI help with SEO?",
        acceptedAnswer: { "@type": "Answer", text: "Yes — AI accelerates audits, scales content production, detects cannibalization, predicts traffic opportunity, and monitors competitors. OptiAISEO automates all of these in one platform." },
      },
      {
        "@type": "Question",
        name: "What is keyword cannibalization?",
        acceptedAnswer: { "@type": "Answer", text: "When multiple pages compete for the same keyword, splitting ranking signals. Fix by merging pages, adding canonical tags, or strengthening internal links to the primary page." },
      },
      {
        "@type": "Question",
        name: "How do I measure SEO success?",
        acceptedAnswer: { "@type": "Answer", text: "Track organic clicks, impressions, and average position in Google Search Console. Monitor rankings weekly. Measure conversions from organic traffic." },
      },
      {
        "@type": "Question",
        name: "What is the difference between on-page and off-page SEO?",
        acceptedAnswer: { "@type": "Answer", text: "On-page SEO is what you optimize within your site — titles, content, schema, internal links. Off-page SEO covers external signals like backlinks that build domain authority." },
      },
    ],
  },
];

const PILLARS = [
  { icon: "🔧", title: "Technical SEO", desc: "Crawlability, Core Web Vitals, HTTPS, sitemaps, hreflang, structured data." },
  { icon: "📄", title: "On-Page SEO", desc: "Title tags, heading hierarchy, meta descriptions, internal linking, content depth." },
  { icon: "🔗", title: "Off-Page SEO", desc: "Backlink building, digital PR, brand mentions, social authority signals." },
  { icon: "✍️", title: "Content SEO", desc: "Topical clusters, keyword research, intent matching, entity optimization." },
  { icon: "📱", title: "Mobile SEO", desc: "Mobile-first indexing, responsive design, touch usability." },
  { icon: "⚡", title: "Speed & CWV", desc: "LCP < 2.5s · INP < 200ms · CLS < 0.1 — pass Google's Page Experience thresholds." },
];

const STEPS = [
  { n: 1, t: "Run a Technical SEO Audit", d: "Use OptiAISEO to crawl your site, identify broken links, missing meta tags, slow Core Web Vitals, and schema errors." },
  { n: 2, t: "Fix On-Page Signals", d: "Optimize title tags, meta descriptions, H1 headings, and internal links for your target keywords." },
  { n: 3, t: "Implement Schema Markup", d: "Add JSON-LD schemas — FAQPage, HowTo, Article — to earn Google rich snippets." },
  { n: 4, t: "Build Topical Authority", d: "Create content clusters covering every sub-topic of your niche at scale using AI generation." },
  { n: 5, t: "Earn Quality Backlinks", d: "Monitor gains and losses in your backlink profile. Reach out for placements on high-DR domains." },
  { n: 6, t: "Track Rankings & Iterate", d: "Monitor keyword positions weekly. Act on cannibalization or decline signals immediately." },
];

const FAQS = [
  { q: "What is SEO?", a: "SEO is the practice of growing organic search traffic by making your website more relevant, authoritative, and technically sound. A page ranking #1 can generate thousands of monthly visitors at zero cost per click." },
  { q: "How long does SEO take to work?", a: "Most websites see measurable improvements in 3–6 months. Competitive industries take longer. Results compound — unlike paid ads, earned rankings continue generating traffic without ongoing spend." },
  { q: "What are Core Web Vitals?", a: "Google's UX metrics: LCP (load speed < 2.5s), INP (responsiveness < 200ms), CLS (layout stability < 0.1). Pages passing all three get a ranking advantage over competitors." },
  { q: "What is technical SEO?", a: "Technical SEO covers site infrastructure: crawlability, HTTPS, sitemaps, structured data (schema.org), canonical tags, hreflang for multi-language sites, and Core Web Vitals optimization." },
  { q: "Does AI help with SEO?", a: "Yes — AI accelerates audits, scales content production, detects cannibalization, predicts traffic opportunity, and monitors competitors. OptiAISEO automates all of these in one platform." },
  { q: "What is keyword cannibalization?", a: "When multiple pages on your site compete for the same keyword, splitting ranking signals. Fix it by merging competing pages, adding canonical tags, or strengthening internal links to the primary page." },
  { q: "How do I measure SEO success?", a: "Track organic clicks, impressions, and average position in Google Search Console. Monitor rankings weekly. Measure conversions from organic traffic. OptiAISEO's monthly PDF report aggregates these automatically." },
  { q: "What is the difference between on-page and off-page SEO?", a: "On-page SEO is what you optimize within your site — titles, content, schema, internal links. Off-page SEO covers external signals like backlinks and brand mentions that build domain authority." },
];

const RELATED = [
  { label: "GEO — Generative Engine Optimization", href: "/geo" },
  { label: "AEO — Answer Engine Optimization", href: "/aeo" },
  { label: "AIO — AI Optimization", href: "/aio" },
  { label: "pSEO — Programmatic SEO", href: "/pseo" },
  { label: "Free SEO Audit Tool", href: "/free/seo-checker" },
  { label: "Free GSO Checker", href: "/free/gso-checker" },
];

export default function SeoPage() {
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
              <span className="text-foreground">SEO Guide</span>
            </nav>
            <div className="inline-flex items-center gap-2 bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-4 py-1.5 text-sm font-medium text-[#10b981] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
              Complete Guide — Updated 2026
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight mb-6 leading-tight">
              What Is <span className="text-[#10b981]">Search Engine</span><br />Optimization?
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              SEO is how websites rank on Google and generate free traffic without paying for ads. In this guide, you&apos;ll learn exactly how SEO works in 2026 and how to use it to grow your website.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/free/seo-checker" className="px-8 py-3 bg-[#10b981] text-black rounded-xl font-semibold hover:bg-[#0ea572] transition-colors">
                Free SEO Audit →
              </Link>
              <Link href="/signup" className="px-8 py-3 bg-card border border-border rounded-xl font-semibold hover:bg-muted transition-colors">
                Start for Free
              </Link>
            </div>
          </div>
        </section>

        {/* ── Definition ── */}
        <section id="seo-definition" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-6">SEO Definition</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            <strong className="text-foreground">Search Engine Optimization (SEO)</strong> is the process of improving a website&apos;s organic position in search engine results pages (SERPs). It encompasses three core disciplines: technical improvements, on-page content strategy, and off-page authority building.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            A page ranking #1 for a keyword searched 10,000 times per month generates thousands of visitors indefinitely — at zero cost per click. Top-ranking pages capture roughly 27% of all clicks, making SEO the highest-ROI long-term marketing channel for most businesses.
          </p>
        </section>

        {/* ── How SEO Works ── */}
        <section id="how-seo-works" className="py-16 px-6 max-w-4xl mx-auto border-t border-border">
          <h2 className="text-3xl font-display font-bold mb-6">How SEO Works</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            Search engines crawl the web, index pages, and rank them by relevance and authority. When someone searches a query, Google scores thousands of candidate pages across hundreds of signals — then returns the most useful results.
          </p>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            SEO works by improving your scores on those signals: making your content more relevant (on-page), your site easier to crawl (technical), and your domain more trusted (off-page). All three must work together — strong content with poor technical health will still rank poorly.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Unlike paid search, SEO rankings are earned and persist without ongoing spend. A single well-optimized page can generate consistent traffic for years, compounding in value over time. Learn more about <Link href="/aeo" className="text-[#10b981] hover:underline">answer engine optimization</Link> and <Link href="/pseo" className="text-[#10b981] hover:underline">programmatic SEO</Link> to extend this further.
          </p>
        </section>

        {/* ── Types of SEO ── */}
        <section id="types-of-seo" className="py-16 px-6 max-w-4xl mx-auto border-t border-border">
          <h2 className="text-3xl font-display font-bold mb-6">Types of SEO</h2>
          <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
            SEO is not a single tactic — it&apos;s a system of four distinct disciplines that reinforce each other. Neglecting any one of them creates a ceiling on your ranking potential.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-base mb-2">Technical SEO</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">Ensures search engines can crawl and index your site. Covers HTTPS, sitemaps, Core Web Vitals, canonical tags, and structured data.</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-base mb-2">On-Page SEO</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">Optimizes individual pages for target keywords. Covers title tags, meta descriptions, heading hierarchy, internal links, and content depth.</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-base mb-2">Off-Page SEO</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">Builds domain authority through external signals. Covers <Link href="/aio" className="text-[#10b981] hover:underline">backlink acquisition</Link>, digital PR, and brand mentions.</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-base mb-2">Content SEO</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">Builds topical authority through keyword research, intent matching, content clusters, and entity optimization.</p>
            </div>
          </div>
        </section>

        {/* ── SEO vs Google Ads ── */}
        <section id="seo-vs-ads" className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-display font-bold mb-8">SEO vs Google Ads</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 pr-6 font-semibold text-foreground w-1/3"></th>
                    <th className="text-left py-3 pr-6 font-semibold text-[#10b981]">SEO</th>
                    <th className="text-left py-3 font-semibold text-muted-foreground">Google Ads</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {[
                    ["Cost per click", "Free", "Paid per click"],
                    ["Time to results", "3–6 months", "Immediate"],
                    ["Longevity", "Compounds over time", "Stops when budget does"],
                    ["Trust signals", "High (organic)", "Lower (labelled ad)"],
                    ["Best for", "Long-term growth", "Short-term campaigns"],
                  ].map(([label, seo, ads]) => (
                    <tr key={label} className="border-b border-border/50">
                      <td className="py-3 pr-6 font-medium text-foreground">{label}</td>
                      <td className="py-3 pr-6">{seo}</td>
                      <td className="py-3">{ads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Six Pillars ── */}
        <section className="py-16 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-display font-bold text-center mb-12">The 6 Pillars of SEO</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PILLARS.map(({ icon, title, desc }) => (
                <div key={title} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/30 transition-colors">
                  <div className="text-2xl mb-3">{icon}</div>
                  <h3 className="font-semibold text-base mb-2">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Is SEO Worth It ── */}
        <section id="is-seo-worth-it" className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-display font-bold mb-6">Is SEO Worth It in 2026?</h2>
            <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
              Yes — more than ever. Organic search remains the largest single source of website traffic across almost every industry. With AI-generated content flooding the web, sites that demonstrate real authority and technical excellence are rewarded disproportionately.
            </p>
            <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
              Google&apos;s 2025 core updates heavily weighted E-E-A-T signals (Experience, Expertise, Authoritativeness, Trust). Sites with strong backlink profiles, fast Core Web Vitals, and well-structured schema markup saw rankings hold or improve while thin AI content dropped significantly.
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              The ROI case is simple: paid ads stop working the moment you stop paying. SEO compounds. A page you rank today generates traffic next year. OptiAISEO&apos;s AI-powered audit and fix pipeline makes achieving that compounding growth dramatically faster — see <Link href="/geo" className="text-[#10b981] hover:underline">GEO</Link> and <Link href="/aeo" className="text-[#10b981] hover:underline">AEO</Link> for how AI systems are extending this further.
            </p>
          </div>
        </section>

        {/* ── HowTo Steps ── */}
        <section className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10">How to Do SEO in 2026: Step-by-Step</h2>
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
            <h2 className="text-3xl font-display font-bold mb-4">Automate Your Entire SEO Workflow</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              OptiAISEO handles technical audits, content generation, rank tracking, and backlink monitoring in one autonomous platform.
            </p>
            <Link href="/signup" className="inline-block px-10 py-3.5 bg-[#10b981] text-black rounded-xl font-bold hover:bg-[#0ea572] transition-colors">
              Start Free — No Credit Card
            </Link>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq-heading" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10 text-center">SEO Frequently Asked Questions</h2>
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