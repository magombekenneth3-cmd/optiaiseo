import type { Metadata } from "next";
import Link from "next/link";
import KEYWORDS from "@/data/keywords.json";

export const metadata: Metadata = {
  title: "SEO Tool Guides by Region & Intent – 2026",
  description:
    "Browse 100+ curated SEO tool guides by region, pricing, and intent. Find the best free, cheap, and AI-powered SEO tools for your market.",
  alternates: {
    canonical:
      (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online") +
      "/tools",
  },
};

interface Keyword {
  slug: string;
  keyword: string;
  title: string;
  intent: string;
  region: string;
  regionCode: string;
}

const INTENT_META: Record<string, { label: string; color: string }> = {
  free:        { label: "Free",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  cheap:       { label: "Budget",      color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  best:        { label: "Top Rated",   color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  alternative: { label: "Alternative", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  ai:          { label: "AI-Powered",  color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
};

const ALL_INTENTS = ["free", "cheap", "best", "alternative", "ai"] as const;
const ALL_REGIONS = Array.from(
  new Set((KEYWORDS as Keyword[]).map((k) => k.region).filter(Boolean))
).sort();

const TOOLS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "SEO Tool Guides by Region & Intent | OptiAISEO",
  "url": "https://www.optiaiseo.online/tools",
  "description": "Browse 100+ curated SEO tool guides by region, pricing, and intent.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://www.optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.optiaiseo.online/logo.png"
    }
  }
};

export default function ToolsIndexPage() {
  const keywords = KEYWORDS as Keyword[];

  return (
    
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(TOOLS_SCHEMA) }} />
<main className="max-w-5xl mx-auto px-4 py-12 text-foreground">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-3">
          SEO Tool Guides
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          {keywords.length} curated guides comparing the best free, cheap, and
          AI-powered SEO tools — sorted by region and intent.
        </p>
      </header>

      {/* By intent */}
      {ALL_INTENTS.map((intent) => {
        const group = keywords.filter((k) => k.intent === intent);
        if (!group.length) return null;
        const meta = INTENT_META[intent];
        return (
          <section key={intent} className="mb-12">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${meta.color}`}
              >
                {meta.label}
              </span>
              {meta.label} SEO Tools
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.map((k) => (
                <li key={k.slug}>
                  <Link
                    href={`/tools/${k.slug}`}
                    className="flex flex-col gap-1 p-4 rounded-xl border border-border bg-card hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group h-full"
                  >
                    <span className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors leading-snug">
                      {k.title}
                    </span>
                    {k.region && k.region !== "Global" && (
                      <span className="text-[11px] text-muted-foreground">
                        {k.region}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* By region */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Browse by Region</h2>
        <ul className="flex flex-wrap gap-3">
          {ALL_REGIONS.map((region) => (
            <li key={region}>
              <span className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground">
                {region} ({keywords.filter((k) => k.region === region).length})
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-8 text-center">
        <h2 className="text-2xl font-extrabold mb-2">
          The AI SEO Platform Built for 2026
        </h2>
        <p className="text-muted-foreground text-sm mb-5 max-w-md mx-auto">
          AEO audits, GEO tracking, AI-powered fixes, and technical site health
          — all in one dashboard.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-bold text-sm shadow-lg shadow-violet-500/20 hover:opacity-90 transition-all"
        >
          Start Free → No Credit Card
        </Link>
      </section>
    </main>
      </>
  );
}
