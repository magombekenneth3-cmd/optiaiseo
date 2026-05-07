import type { Metadata } from "next";
import Link from "next/link";
import AEO_PAGES from "@/data/aeo-pages.json";

interface AeoPage {
  slug: string;
  title: string;
  keyword: string;
  intent: string;
}

export const metadata: Metadata = {
  title: "AEO Guides – Answer Engine Optimization Hub (2026)",
  description:
    "Browse 60+ AEO guides covering how to rank in ChatGPT, Perplexity, and Google AI Overviews. Updated for 2026.",
  alternates: {
    canonical:
      (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online") + "/aeo-guide",
  },
};

const INTENT_META: Record<string, { label: string; color: string; description: string }> = {
  definition: { label: "Definitions",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20",     description: "Understand the core concepts" },
  comparison: { label: "Comparisons",       color: "bg-orange-500/10 text-orange-400 border-orange-500/20", description: "AEO vs SEO vs GEO — head-to-head" },
  howto:      { label: "How-To Guides",     color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", description: "Step-by-step implementation" },
  tools:      { label: "Tool Reviews",      color: "bg-violet-500/10 text-violet-400 border-violet-500/20", description: "Best platforms for AI search" },
  advanced:   { label: "Advanced Strategy", color: "bg-red-500/10 text-red-400 border-red-500/20",         description: "Expert-level tactics and research" },
};

const INTENT_ORDER = ["definition", "howto", "comparison", "tools", "advanced"] as const;

export default function AeoGuideIndexPage() {
  const pages = AEO_PAGES as AeoPage[];

  return (
    <main className="max-w-5xl mx-auto px-4 py-12 text-foreground">
      <header className="mb-10 text-center">
        <span className="inline-flex mb-3 px-3 py-1 rounded-full text-xs font-bold uppercase bg-violet-500/10 text-violet-400 border border-violet-500/20">
          AEO Knowledge Base
        </span>
        <h1 className="text-4xl font-extrabold tracking-tight mb-3">
          Answer Engine Optimization Guides
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          {pages.length} practical guides on ranking in ChatGPT, Perplexity, Google AI Overviews, and every major AI search engine — updated for 2026.
        </p>
      </header>

      {/* Groups by intent */}
      {INTENT_ORDER.map((intent) => {
        const group = pages.filter((p) => p.intent === intent);
        if (!group.length) return null;
        const meta = INTENT_META[intent];
        return (
          <section key={intent} className="mb-12">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-xl font-bold">{meta.label}</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${meta.color}`}>
                {group.length} guides
              </span>
              <span className="text-sm text-muted-foreground hidden sm:block">{meta.description}</span>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/aeo-guide/${p.slug}`}
                    className="flex flex-col gap-1.5 p-4 rounded-xl border border-border bg-card hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group h-full"
                  >
                    <span className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors leading-snug">
                      {p.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{p.keyword}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* CTA */}
      <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-8 text-center">
        <h2 className="text-2xl font-extrabold mb-2">Audit Your AEO Score Now</h2>
        <p className="text-muted-foreground text-sm mb-5 max-w-md mx-auto">
          Find out how often ChatGPT, Perplexity, and Google AI Overviews cite your brand. Free AEO audit — no credit card required.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-bold text-sm shadow-lg shadow-violet-500/20 hover:opacity-90 transition-all"
        >
          Start Free AEO Audit →
        </Link>
      </section>
    </main>
  );
}
