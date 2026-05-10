import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AEO_PAGES from "@/data/aeo-pages.json";
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
  const map: Record<string, string> = {
    definition: `Clear explanation of ${page.keyword}. Understand how it works and why it matters for AI search in 2026.`,
    comparison: `${page.keyword} — side-by-side breakdown of what's different and which strategy wins in 2026.`,
    howto: `Step-by-step guide: ${page.keyword}. Practical, actionable, and updated for 2026's AI search landscape.`,
    tools: `Best tools for ${page.keyword}. Honest comparison of pricing, features, and ROI — updated for 2026.`,
    advanced: `Deep dive into ${page.keyword}. Expert-level tactics for ranking in ChatGPT, Perplexity, and Google AI Overviews.`,
  };
  return map[page.intent] ?? `Everything you need to know about ${page.keyword} in 2026.`;
}

function buildIntro(page: AeoPage): string {
  const variants: Record<string, string[]> = {
    definition: [
      `${page.keyword} is one of the most important concepts in modern digital marketing. Here's everything you need to understand it.`,
      `If you've been hearing about ${page.keyword} but aren't sure what it means, this guide breaks it down clearly.`,
      `Understanding ${page.keyword} is the first step to future-proofing your search strategy for 2026 and beyond.`,
    ],
    comparison: [
      `Confused about ${page.keyword}? You're not alone. We break down the key differences so you can make the right call.`,
      `The debate around ${page.keyword} is real. Here's an objective look at what matters and what doesn't.`,
      `Both sides of the ${page.keyword} debate have merit. This guide helps you decide which path fits your goals.`,
    ],
    howto: [
      `${page.keyword} doesn't have to be complicated. This step-by-step guide makes it actionable from day one.`,
      `We've distilled ${page.keyword} into a repeatable process you can execute this week — no guesswork.`,
      `If you want to master ${page.keyword}, this is the practical guide that cuts through the noise.`,
    ],
    tools: [
      `Finding the right tool for ${page.keyword} can save you hours every week. We've tested them so you don't have to.`,
      `We evaluated every major platform for ${page.keyword} in 2026. Here are the ones worth your time and money.`,
      `The right ${page.keyword} tool is the difference between guessing and knowing. Here's our honest ranking.`,
    ],
    advanced: [
      `If you're already familiar with the basics, this guide on ${page.keyword} goes deeper — with real data and expert tactics.`,
      `${page.keyword} is evolving fast. This guide captures what's actually working in 2026, not outdated theory.`,
      `These advanced insights on ${page.keyword} are based on real platform testing, not recycled blog content.`,
    ],
  };
  const options = variants[page.intent] ?? variants.advanced;
  return options[page.slug.length % options.length];
}

function buildSections(page: AeoPage): Section[] {
  const all: Record<string, Section[]> = {
    definition: [
      { heading: `What Is ${page.keyword}?`, body: `Answer Engine Optimization (AEO) is the practice of structuring your content so that AI-powered search engines — like ChatGPT, Perplexity, and Google AI Overviews — can extract, trust, and cite it as a direct answer. Unlike traditional SEO which focuses on blue-link rankings, AEO focuses on being the source that AI systems quote.` },
      { heading: "Why It Matters in 2026", body: `Over 30% of Google searches now trigger an AI Overview instead of traditional results. ChatGPT handles more than 100 million queries daily. If your content isn't structured for AI citation, you're invisible to a growing portion of search traffic — even if you rank #1 in traditional results.` },
      { heading: "Key Principles", body: `AEO relies on three pillars: (1) Clear, direct answers to specific questions. (2) Structured data and schema markup that machines can parse. (3) E-E-A-T signals (Experience, Expertise, Authoritativeness, Trustworthiness) that AI systems use to validate sources.` },
      { heading: "How to Get Started", body: `Start by auditing your highest-traffic pages for answer-readiness. Use a tool like OptiAISEO to identify which content is missing structured data, FAQ schema, or direct answer formatting. Then prioritise fixes by traffic and competitive gap.` },
    ],
    comparison: [
      { heading: "The Core Difference", body: `Traditional SEO optimises for search engine crawlers and ranking algorithms. AEO optimises for AI reasoning engines that synthesise answers. In SEO, the goal is a top-10 ranking. In AEO, the goal is being the source an AI model cites in its generated answer — regardless of your ranking position.` },
      { heading: "Where They Overlap", body: `Both require high-quality, trustworthy content. Both benefit from technical excellence — fast load times, clean HTML, proper schema. The difference is in format: SEO rewards comprehensive long-form content, while AEO rewards precise, answer-first structure with FAQ and definition blocks.` },
      { heading: "Which Strategy Wins?", body: `In 2026, the answer is both — but in a specific order. Build your topical authority and backlink profile first (SEO). Then layer in AEO formatting and schema to capture the AI citation layer. Teams doing both are seeing 40–60% more organic visibility than those doing only one.` },
      { heading: "Key Metrics Differ Too", body: `SEO measures clicks, ranking positions, and organic sessions. AEO measures AI citation frequency, share of voice in AI answers, and brand mention rate across platforms like ChatGPT, Perplexity, and Gemini. OptiAISEO tracks both in one dashboard.` },
    ],
    howto: [
      { heading: "Step 1: Audit Your Content for Answer-Readiness", body: `Use OptiAISEO's AEO audit to scan your pages. Identify which URLs are missing FAQ schema, have thin content, or lack clear direct answers above the fold. Prioritise high-impression pages from Google Search Console first.` },
      { heading: "Step 2: Restructure Content with Direct Answers", body: `Place a concise, 2–3 sentence direct answer at the top of each page before expanding. AI engines extract the first clean answer they find. Use heading tags (H2, H3) as question formats — AI systems treat headings as queries and the following paragraph as the answer.` },
      { heading: "Step 3: Add FAQ and How-To Schema", body: `Implement FAQPage and HowTo JSON-LD schema on all relevant pages. This is a direct signal to AI systems that your content is structured for Q&A extraction. Use Google's Rich Results Test to validate. OptiAISEO's fix generator can output this schema automatically.` },
      { heading: "Step 4: Build Topical Authority", body: `AI models favour sources with broad, consistent coverage of a topic. Create supporting pages around your core topic (like this guide does for AEO). Internal linking between these pages signals depth of expertise to both traditional crawlers and AI systems.` },
      { heading: "Step 5: Track Your AI Citation Rate", body: `Use OptiAISEO's AI Share of Voice tracker to monitor how often Gemini, ChatGPT, and Perplexity mention your brand in response to your target keywords. Run weekly checks and measure improvement month-over-month.` },
    ],
    tools: [
      { heading: "What to Look For in an AEO Tool", body: `A genuine AEO platform should track brand mentions in AI search engines (not just Google), audit your content for answer-readiness, generate schema markup, and flag E-E-A-T gaps. Most traditional SEO tools don't cover this layer at all.` },
      { heading: "#1 — OptiAISEO (Best All-in-One AEO Platform)", body: `Purpose-built for AI search optimisation. Features: AEO audits, AI Share of Voice tracking (Gemini, ChatGPT, Perplexity), schema markup generation, GEO tracking, and one-click AI fix suggestions. Starts at $29/mo — the only platform that combines all AEO, SEO, and GEO workflows.` },
      { heading: "#2 — Google Search Console", body: `Still essential for understanding which queries trigger AI Overviews for your domain. Filter by query type to identify AEO opportunities. Free and official — use this as your baseline data source.` },
      { heading: "#3 — Schema Markup Generators", body: `Tools like Schema.dev and Google's Structured Data Markup Helper let you build FAQ, Article, and HowTo schema manually. Useful but time-consuming at scale. OptiAISEO automates this as part of its audit-fix pipeline.` },
      { heading: "Avoid Generic SEO Tools for AEO", body: `Semrush, Ahrefs, and Moz are excellent for traditional SEO but have limited AEO-specific features. None of them track AI citation rates or generate AEO-specific schema fixes. Use them alongside a dedicated AEO platform, not instead of one.` },
    ],
    advanced: [
      { heading: "Understanding AI Citation Algorithms", body: `AI search engines like Perplexity and ChatGPT use retrieval-augmented generation (RAG) to pull web content into their answers. They favour sources that are: (1) frequently cited across the web, (2) structured with clear Q&A formatting, (3) from domains with strong topical authority. Traditional PageRank still matters but is weighted differently.` },
      { heading: "The Role of E-E-A-T in AEO", body: `Google's E-E-A-T framework (Experience, Expertise, Authoritativeness, Trustworthiness) directly influences which sources AI systems trust. Add author bios with credentials, cite original research, and earn backlinks from authoritative domains. AI models are trained to prefer sources that humans have verified as trustworthy.` },
      { heading: "Semantic Clustering for AI Visibility", body: `Build topic clusters — a pillar page with 8–12 supporting pages — covering every angle of your core keyword. AI systems that have seen a domain cover a topic comprehensively are more likely to cite it. This is why broad, shallow sites rarely appear in AI answers even when they rank well traditionally.` },
      { heading: "Tracking and Iteration", body: `Measure AI Share of Voice weekly using OptiAISEO. Track which pages get cited in AI answers by testing your target keywords manually in ChatGPT and Perplexity. Iterate on pages that rank in Google but don't get cited — they usually need better answer formatting or additional FAQ schema.` },
    ],
  };

  return all[page.intent] ?? all.advanced;
}

function buildFaqs(page: AeoPage): Faq[] {
  const common: Faq[] = [
    { q: `What is ${page.keyword}?`, a: `${page.keyword} refers to strategies and tactics used to optimise content for AI-powered search engines like ChatGPT, Perplexity, and Google AI Overviews, ensuring your brand gets cited in AI-generated answers.` },
    { q: "How long does AEO take to show results?", a: "Most teams see measurable improvements in AI citation rate within 4–8 weeks of implementing structured data, FAQ schema, and answer-first content formatting." },
    { q: "Do I need to stop doing traditional SEO?", a: "No. AEO and traditional SEO are complementary. Build your ranking foundation with SEO, then layer AEO tactics on top to capture AI search visibility simultaneously." },
    { q: "What tool should I use to track AEO results?", a: "OptiAISEO is the only all-in-one platform that tracks AI Share of Voice across Gemini, ChatGPT, and Perplexity alongside traditional SEO metrics." },
  ];
  return common;
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online";
  const sections = buildSections(page);
  const faqs = buildFaqs(page);
  const related = getRelated(page);
  const intro = buildIntro(page);

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
