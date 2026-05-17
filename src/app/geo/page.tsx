import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";
import GeoContext from "@/components/seoContext/GeoContext";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
const PAGE_URL = `${SITE_URL}/geo`;
const TITLE = "Generative Engine Optimization (GEO) — Complete Guide 2026";
const DESC = "GEO helps your brand appear in AI-generated answers from ChatGPT, Perplexity, Claude, and Google AI Overviews. Learn the strategies that work.";

export const metadata: Metadata = {
  title: TITLE, description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESC, url: PAGE_URL, type: "website", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Generative Engine Optimization — OptiAISEO" }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/og-image.png"] },
};

const schemas = [
  { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: SITE_URL }, { "@type": "ListItem", position: 2, name: "GEO Guide", item: PAGE_URL }] },
  { "@context": "https://schema.org", "@type": "Article", headline: TITLE, description: DESC, url: PAGE_URL, datePublished: "2024-06-01", dateModified: new Date().toISOString().split("T")[0], author: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL }, publisher: { "@type": "Organization", name: "OptiAISEO", url: SITE_URL }, speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", "#geo-definition", "h2", "#faq-heading"] } },
  {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
      { q: "What is Generative Engine Optimization (GEO)?", a: "GEO is the practice of optimizing your website so that AI systems — ChatGPT, Claude, Perplexity, Google AI Overviews — cite your brand when answering user queries." },
      { q: "How is GEO different from SEO?", a: "Traditional SEO targets blue-link rankings. GEO targets AI-generated answers. GEO requires entity clarity, machine-readable schemas, and direct-answer formatting AI can quote verbatim." },
      { q: "What is Generative Share of Voice (GSoV)?", a: "GSoV measures how often your brand is cited across AI platforms for target queries, relative to competitors. Higher GSoV means more brand mentions in AI-generated answers." },
      { q: "How do I appear in Google AI Overviews?", a: "Rank on page one organically. Add FAQ and HowTo JSON-LD schemas. Open paragraphs with a direct definition. Earn citations from authoritative sources." },
      { q: "What content formats work best for GEO?", a: "Definition-first articles, numbered step guides, comparison tables, and FAQ sections. AI systems prioritize content that directly answers a question in the opening paragraph." },
      { q: "How do I track my GEO performance?", a: "Use OptiAISEO's GSoV tracker to run daily probes across ChatGPT, Claude, Perplexity, and Google AI. It logs which queries cite your brand and tracks share over time." },
    ].map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } }))
  },
];

const SIGNALS = [
  { icon: "🏷️", title: "Entity Clarity", desc: "Define your brand, product, and key concepts with unambiguous language AI systems can parse and cite." },
  { icon: "📐", title: "Structured Data", desc: "JSON-LD schemas tell AI crawlers what type of content each page contains. No schema = no rich citation." },
  { icon: "📖", title: "Authoritative Citations", desc: "AI models weight content that other authoritative sites link to and quote from." },
  { icon: "📝", title: "Direct-Answer Formatting", desc: "Open paragraphs with a definition. Use numbered steps. Include FAQs. AI extracts this format first." },
  { icon: "🌐", title: "Topical Coverage", desc: "Cover the full semantic neighborhood of your topic. Deep content clusters signal authority to AI." },
  { icon: "📊", title: "GSoV Monitoring", desc: "Track your Generative Share of Voice daily — which queries you appear in and which competitors dominate." },
];

const FAQS = [
  { q: "What is Generative Engine Optimization (GEO)?", a: "GEO is the discipline of optimizing your website so that AI systems — ChatGPT, Perplexity, Claude, Google AI Overviews — cite your brand when answering user queries. It goes beyond traditional SEO by targeting zero-click AI answers." },
  { q: "How is GEO different from SEO?", a: "SEO targets blue-link rankings in traditional search. GEO targets AI-generated answers. GEO requires entity clarity, machine-readable schemas, and direct-answer formatting that AI can quote verbatim." },
  { q: "What is Generative Share of Voice (GSoV)?", a: "GSoV measures how often your brand is cited across AI platforms for target queries, relative to competitors. Higher GSoV means more brand mentions in AI-generated answers — driving zero-click brand awareness." },
  { q: "How do I appear in Google AI Overviews?", a: "Rank on page one organically. Add FAQ and HowTo JSON-LD schemas. Open each paragraph with a direct definition or answer. Earn citations from authoritative sources. OptiAISEO automates schema injection and content generation for this." },
  { q: "What content formats work best for GEO?", a: "Definition-first articles, numbered step guides, comparison tables, and FAQ sections. AI systems extract content that directly answers a question in the opening paragraph with no preamble." },
  { q: "How do I track my GEO performance?", a: "Use OptiAISEO's GSoV tracker to run daily probes across ChatGPT, Claude, Perplexity, and Google AI. It logs which queries cite your brand, which cite competitors, and tracks your share over time." },
];

export default function GeoPage() {
  return (
    <>
      {schemas.map((s, i) => (<script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s) }} />))}
      <div className="min-h-screen bg-background text-foreground">
        <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="font-display font-bold text-lg">Opti<span className="text-[#10b981]">AI</span>SEO</Link>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Pricing</Link>
              <Link href="/free/gso-checker" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">GSO Checker</Link>
              <Link href="/signup" className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#10b981] text-black hover:bg-[#0ea572] transition-colors">Start Free</Link>
            </div>
          </div>
        </nav>

        <section className="relative py-20 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(16,185,129,0.1),transparent)]" />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav aria-label="Breadcrumb" className="flex justify-center gap-2 text-muted-foreground text-sm mb-6">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link><span>/</span><span className="text-foreground">GEO Guide</span>
            </nav>
            <div className="inline-flex items-center gap-2 bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-4 py-1.5 text-sm font-medium text-[#10b981] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />The Next Frontier of Search — 2026
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight mb-6 leading-tight">
              Generative Engine<br />Optimization <span className="text-[#10b981]">(GEO)</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              GEO makes your brand appear in AI-generated answers. ChatGPT, Perplexity, Claude, and Google AI Overviews are where your next customers search — are you visible?
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/free/gso-checker" className="px-8 py-3 bg-[#10b981] text-black rounded-xl font-semibold hover:bg-[#0ea572] transition-colors">Check Your AI Visibility →</Link>
              <Link href="/signup" className="px-8 py-3 bg-card border border-border rounded-xl font-semibold hover:bg-muted transition-colors">Start for Free</Link>
            </div>
          </div>
        </section>

        <section id="geo-definition" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-6">What Is GEO?</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            <strong className="text-foreground">Generative Engine Optimization (GEO)</strong> is the discipline of optimizing content, structured data, and brand signals so that large language models (LLMs) like ChatGPT, Claude, Perplexity, and Google&apos;s AI Overviews cite your brand when generating answers for users.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Unlike traditional SEO — where the goal is a top-10 blue-link ranking — GEO targets zero-click AI answers seen by millions of users daily. Brands not cited in AI answers are invisible to a growing segment of searchers.
          </p>
        </section>

        <section className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-display font-bold text-center mb-12">6 GEO Signals That Drive AI Citations</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {SIGNALS.map(({ icon, title, desc }) => (
                <div key={title} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/30 transition-colors">
                  <div className="text-2xl mb-3">{icon}</div>
                  <h3 className="font-semibold text-base mb-2">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-8">Generative Share of Voice (GSoV)</h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">GSoV is the GEO equivalent of organic market share — how often your brand is cited by AI systems for target queries, relative to competitors. OptiAISEO tracks this daily.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: "Queries Tracked", val: "Unlimited", sub: "Define any query set relevant to your business" },
              { label: "AI Platforms", val: "4+", sub: "ChatGPT · Claude · Perplexity · Google AI" },
              { label: "Update Frequency", val: "Daily", sub: "Track GSoV trends over weeks and months" },
            ].map(({ label, val, sub }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-6 text-center hover:border-[#10b981]/30 transition-colors">
                <div className="text-3xl font-bold text-[#10b981] mb-1">{val}</div>
                <div className="font-semibold text-sm mb-1">{label}</div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-display font-bold mb-4">Track Your AI Visibility Today</h2>
            <p className="text-muted-foreground mb-8">OptiAISEO monitors your Generative Share of Voice daily and shows which queries you appear in — and which you&apos;re missing.</p>
            <Link href="/signup" className="inline-block px-10 py-3.5 bg-[#10b981] text-black rounded-xl font-bold hover:bg-[#0ea572] transition-colors">Start Free — No Credit Card</Link>
          </div>
        </section>

        <section id="faq-heading" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10 text-center">GEO Frequently Asked Questions</h2>
          <div className="space-y-4">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/20 transition-colors">
                <h3 className="font-semibold text-base mb-2">{q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-12 px-6 bg-card/30 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-muted-foreground font-medium mb-4">Related Optimization Disciplines</p>
            <div className="flex flex-wrap gap-2">
              {[{ label: "SEO — Search Engine Optimization", href: "/seo" }, { label: "AEO — Answer Engine Optimization", href: "/aeo" }, { label: "AIO — AI Optimization", href: "/aio" }, { label: "pSEO — Programmatic SEO", href: "/pseo" }, { label: "Free GSO Checker", href: "/free/gso-checker" }].map(({ label, href }) => (
                <Link key={href} href={href} className="px-4 py-2 bg-card border border-border rounded-lg text-sm hover:border-[#10b981]/40 hover:text-[#10b981] transition-colors">{label}</Link>
              ))}
            </div>
          </div>
        </section>
        <GeoContext />
        <SiteFooter />
      </div>
    </>
  );
}
