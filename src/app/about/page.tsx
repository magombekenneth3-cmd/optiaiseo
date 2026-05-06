import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "About OptiAISEO — AI SEO & Automated Audit Platform",
  description:
    "OptiAISEO automates technical SEO audits, schema fixes via GitHub PR, AI content generation, and brand citation tracking in ChatGPT, Claude, and Perplexity.",
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: "About OptiAISEO — AI SEO Audit Tool & Automated SEO Software",
    description:
      "OptiAISEO automates technical SEO audits, on-page fixes, schema injection, and AI content — so your site ranks higher on Google and gets cited by AI search engines.",
    url: `${SITE_URL}/about`,
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO — AI SEO Tool" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "About OptiAISEO — AI SEO Audit Tool",
    description: "Automated SEO audits, schema fixes, AI content, and brand citation tracking. Free plan available.",
    images: ["/og-image.png"],
  },
};

// ── Organization schema with full entity signals ──────────────────────────────
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "OptiAISEO",
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.ico`,
  description:
    "OptiAISEO is a Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO) SaaS platform. It helps brands, agencies, and solo creators achieve maximum visibility in AI-generated answers by automating technical SEO audits, JSON-LD schema injection, AI-powered blog generation, competitor gap analysis, and daily brand citation tracking across ChatGPT, Claude, Perplexity, and Google AI Overviews.",
  industry: [
    "Artificial Intelligence Services",
    "Generative Engine Optimization",
    "Answer Engine Optimization",
    "Search Engine Optimization Software",
    "Digital Marketing Technology",
    "SaaS",
  ],
  areaServed: { "@type": "Place", name: "Global" },
  knowsAbout: [
    "Generative Engine Optimization",
    "Answer Engine Optimization",
    "AI Search Visibility",
    "Technical SEO",
    "Schema Markup",
    "Brand Citation Tracking",
    "Competitor Gap Analysis",
    "AI Content Generation",
    "AISEO",
    "SEO",
    "Search Engine Optimization",

  ],
  sameAs: [
    "https://twitter.com/aiseoseo",
    "https://linkedin.com/company/aiseoseo",
    "https://youtube.com/@aiseoseo",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "support@optiaiseo.online",
    availableLanguage: "English",
  },
};

// ── Service schema — explicit offering list for AI citation ───────────────────
const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Generative Engine Optimization & AEO Platform",
  description:
    "OptiAISEO delivers Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), automated technical SEO audits with GitHub PR fixes, AI-generated blog content, JSON-LD schema injection, and Generative Share of Voice (gSOV) tracking — all from a single dashboard.",
  serviceType: "Digital Marketing Technology",
  provider: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  areaServed: { "@type": "Place", name: "Global" },
  audience: {
    "@type": "Audience",
    audienceType:
      "Solo creators, e-commerce brands, SaaS companies, digital marketing agencies, and enterprise SEO teams seeking AI search visibility.",
  },
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "OptiAISEO Core Services",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Generative Engine Optimization (GEO)",
          description:
            "Structured data optimisation, entity disambiguation, and content strategy to appear in ChatGPT, Claude, Perplexity, and Google AI Overviews.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Answer Engine Optimization (AEO)",
          description:
            "FAQ schema, speakable markup, and direct-answer content that gets your brand cited when AI assistants respond to user queries.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Automated Technical SEO Audit",
          description:
            "Crawl-based audits detecting Core Web Vitals issues, missing schema, broken links, and duplicate content — with auto-generated GitHub Pull Request fixes.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "AI Blog & Content Generation",
          description:
            "Entity-dense, schema-annotated long-form articles generated and published automatically to build topical authority and AI inclusion.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Generative Share of Voice (gSOV) Tracking",
          description:
            "Daily measurement of how often your brand is cited across AI engines, with benchmark comparison against named competitors.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Competitor Gap Analysis",
          description:
            "Identifies keyword, topic, and backlink gaps between your site and key competitors, then auto-generates content briefs to close them.",
        },
      },
    ],
  },
};

// ── AboutPage schema ──────────────────────────────────────────────────────────
const webPageSchema = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About OptiAISEO",
  url: `${SITE_URL}/about`,
  description:
    "Learn about OptiAISEO — a GEO and AEO SaaS platform built to help brands get cited in AI-generated search answers.",
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "About", item: `${SITE_URL}/about` },
    ],
  },
};

// ── Services listed on-page ───────────────────────────────────────────────────
const SERVICES = [
  {
    title: "Generative Engine Optimization (GEO)",
    desc: "Structured data, entity signals, and content strategy so AI models surface your brand in generated answers — across ChatGPT, Claude, Perplexity, and Google AI Overviews.",
  },
  {
    title: "Answer Engine Optimization (AEO)",
    desc: "FAQ schema, speakable markup, and direct-answer content so AI assistants cite you by name when users ask questions in your category.",
  },
  {
    title: "Automated Technical SEO Audit",
    desc: "Full crawl detecting Core Web Vitals issues, missing schema, broken links, and duplicate content — with auto-generated GitHub Pull Request fixes.",
  },
  {
    title: "AI Blog & Content Generation",
    desc: "Entity-dense, schema-annotated long-form articles published automatically to build topical authority and trigger AI inclusion.",
  },
  {
    title: "Generative Share of Voice (gSOV) Tracking",
    desc: "Daily measurement of how often your brand is cited across ChatGPT, Claude, Perplexity, and Google AI — with competitor benchmarking.",
  },
  {
    title: "Competitor Gap Analysis",
    desc: "Find keywords and topics your competitors rank for that you don't, then auto-generate content briefs to close every gap.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD structured data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />

      <nav className="border-b border-border px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg" style={{ color: "var(--brand)" }}>
          OptiAISEO
        </Link>
        <Link href="/signup" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          Get started free →
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-20">

        {/* ── Hero ── */}
        <div className="mb-14">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--brand)" }}>About</span>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mt-4 mb-5 text-foreground">
            Built for the AI search era
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
            <strong className="text-foreground">OptiAISEO</strong> is a{" "}
            <strong className="text-foreground">Generative Engine Optimization (GEO)</strong> and{" "}
            <strong className="text-foreground">Answer Engine Optimization (AEO)</strong>{" "}
            SaaS platform. We help brands, agencies, and solo creators get cited by ChatGPT, Claude,
            Perplexity, and Google AI Overviews — automatically, without touching a line of code.
          </p>
        </div>

        <div className="space-y-14 border-t border-border pt-12">

          {/* ── Services ── */}
          <div id="what-we-do">
            <h2 className="text-2xl font-bold mb-2 text-foreground">What OptiAISEO does</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              OptiAISEO is a <strong className="text-foreground">Digital Marketing Technology</strong> company
              specialising in AI search visibility. Our platform provides six core services:
            </p>
            <ul className="space-y-4">
              {SERVICES.map(({ title, desc }) => (
                <li key={title} className="flex gap-3 text-sm text-muted-foreground">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: "var(--brand)" }}
                  />
                  <span>
                    <strong className="text-foreground">{title}</strong> — {desc}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Who we serve ── */}
          <div id="who-we-serve">
            <h2 className="text-2xl font-bold mb-3 text-foreground">Who we serve</h2>
            <p className="text-muted-foreground leading-relaxed">
              OptiAISEO serves{" "}
              <strong className="text-foreground">
                solo creators, e-commerce brands, SaaS companies, digital marketing agencies, and
                enterprise SEO teams
              </strong>{" "}
              who want to win in AI-generated search — globally. Our platform supports unlimited
              websites on Agency plans and delivers measurable results from day one on the Free tier.
            </p>
          </div>

          {/* ── Why AEO matters ── */}
          <div id="why-aeo">
            <h2 className="text-2xl font-bold mb-3 text-foreground">Why AEO matters now</h2>
            <p className="text-muted-foreground leading-relaxed">
              By 2025,{" "}
              <a
                href="https://www.gartner.com/en/marketing/topics/ai-in-digital-commerce"
                className="underline hover:opacity-80 transition-opacity"
                style={{ color: "var(--brand)" }}
                target="_blank"
                rel="noopener noreferrer"
              >
                Gartner estimates
              </a>{" "}
              that 25% of search volume will shift to AI-generated answers. When a user asks
              ChatGPT &quot;which SEO tool should I use?&quot; — the AI doesn&apos;t show ten blue
              links, it names brands. Answer Engine Optimization is the discipline of making sure
              your brand is one of those names. OptiAISEO automates every technical step of that process.
            </p>
          </div>

          {/* ── Differentiators ── */}
          <div id="differentiators">
            <h2 className="text-2xl font-bold mb-3 text-foreground">What we do differently</h2>
            <p className="text-muted-foreground leading-relaxed">
              Most SEO tools report problems. OptiAISEO fixes them — automatically, via GitHub Pull
              Request, in the time it takes to finish a coffee. Our voice agent{" "}
              <strong className="text-foreground">Aria</strong> runs audits, identifies schema gaps,
              and pushes the fix without you touching a line of code. According to{" "}
              <a
                href="https://www.searchenginejournal.com/ai-overviews-seo-tips/485765/"
                className="underline hover:opacity-80 transition-opacity"
                style={{ color: "var(--brand)" }}
                target="_blank"
                rel="noopener noreferrer"
              >
                Search Engine Journal
              </a>
              , structured data is the #1 factor in AI Overview inclusion — and we automate it entirely.
            </p>
          </div>

          {/* ── The team ── */}
          <div id="team">
            <h2 className="text-2xl font-bold mb-3 text-foreground">The team</h2>
            <p className="text-muted-foreground leading-relaxed">
              We are a small, focused team of engineers and SEO practitioners who got tired of
              manually fixing the same schema errors on every client site. OptiAISEO is the tool we
              wished existed. We ship fast, we&apos;re transparent about what we build, and we
              respond to every support email personally.
            </p>
          </div>
        </div>

        {/* ── CTAs ── */}
        <div className="mt-14 pt-10 border-t border-border flex flex-col sm:flex-row gap-4 flex-wrap">
          <Link
            href="/signup"
            className="px-7 py-3.5 rounded-full font-bold text-sm text-center transition-opacity hover:opacity-90"
            style={{ background: "var(--brand)", color: "#000" }}
          >
            Try it free — no card needed
          </Link>
          <Link
            href="/pricing"
            className="px-7 py-3.5 rounded-full border border-border font-semibold text-sm text-center hover:bg-muted transition-colors text-foreground"
          >
            View pricing
          </Link>
          <Link
            href="/"
            className="px-7 py-3.5 rounded-full font-semibold text-sm text-center hover:text-foreground transition-colors text-muted-foreground"
          >
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
