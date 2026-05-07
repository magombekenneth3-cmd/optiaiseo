import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { GUIDES } from "./[slug]/page";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "SEO & AEO Guides — How to Rank in Google and AI (2026) | OptiAISEO",
  description: "Free expert guides on AEO, GEO, technical SEO, and AI visibility. Learn how to rank in ChatGPT, Perplexity, and Google AI Overviews alongside traditional search.",
  alternates: { canonical: `${SITE_URL}/guide` },
  openGraph: {
    title: "SEO & AEO Guides 2026 | OptiAISEO",
    description: "Free expert guides on AEO, GEO, technical SEO, and getting cited in AI answers.",
    url: `${SITE_URL}/guide`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

const GUIDE_LIST = Object.entries(GUIDES).map(([slug, g]) => ({
  slug,
  title: g.h1,
  description: g.description,
}));

export default function GuideIndexPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "SEO & AEO Guides",
    description: "Free guides on Answer Engine Optimization, Generative Engine Optimization, and technical SEO.",
    url: `${SITE_URL}/guide`,
    publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL },
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <MarketingNav />

      <main className="flex-1 max-w-4xl mx-auto px-6 py-16 w-full">
        <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span>/</span>
          <span className="text-foreground">Guides</span>
        </nav>

        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#10b981]/25 bg-[#10b981]/10 mb-4">
            <span className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">Free Guides · 2026</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-4">SEO & AEO Guides for 2026</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Practical, no-fluff guides on ranking in Google and getting cited in ChatGPT, Claude, and Perplexity. Updated for 2026.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {GUIDE_LIST.map(({ slug, title, description }) => (
            <Link
              key={slug}
              href={`/guide/${slug}`}
              className="card-surface rounded-2xl p-6 flex flex-col hover:-translate-y-0.5 transition-all duration-200 group"
            >
              <h2 className="font-bold text-base mb-2 group-hover:text-[#10b981] transition-colors leading-snug">{title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1 line-clamp-3">{description}</p>
              <span className="text-xs text-[#10b981] font-semibold mt-4">Read guide →</span>
            </Link>
          ))}
        </div>

        {/* Cross-cluster links — topical authority signals */}
        <div className="grid sm:grid-cols-2 gap-4 mt-10">
          <Link
            href="/tools"
            className="card-surface rounded-2xl p-6 flex flex-col gap-2 hover:-translate-y-0.5 transition-all duration-200 group"
          >
            <span className="text-xs font-bold uppercase tracking-wider text-[#10b981]">SEO Tool Guides</span>
            <p className="font-bold text-sm group-hover:text-[#10b981] transition-colors">
              100+ tool comparisons by region &amp; intent →
            </p>
            <p className="text-xs text-muted-foreground">Free, cheap, and AI-powered SEO tools ranked for India, US, UK, and 15+ markets.</p>
          </Link>
          <Link
            href="/aeo-guide"
            className="card-surface rounded-2xl p-6 flex flex-col gap-2 hover:-translate-y-0.5 transition-all duration-200 group"
          >
            <span className="text-xs font-bold uppercase tracking-wider text-violet-400">AEO Deep Dives</span>
            <p className="font-bold text-sm group-hover:text-violet-400 transition-colors">
              60 guides on ranking in AI search →
            </p>
            <p className="text-xs text-muted-foreground">ChatGPT, Perplexity, Google AI Overviews — how to get cited in every AI engine.</p>
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
