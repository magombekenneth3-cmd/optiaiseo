/**
 * src/app/vs/page.tsx  — UPDATED VERSION
 *
 * Changes from original:
 *  • Added editorial intro section above the card grid (150w, primary KW in first 100w)
 *  • Added a 5-tool × 5-feature summary comparison table
 *  • Added a "Why teams switch to OptiAISEO" feature highlight section
 *  • Added 4 FAQs below the card grid using the same <details> pattern as UseCasePage
 *  • Added an internal links strip
 *
 * All original card grid, nav, footer, metadata — completely unchanged.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Best Ahrefs Alternative 2026 — OptiAISEO vs Ahrefs, Semrush & More",
  description: "Looking for a cheaper Ahrefs alternative? Compare OptiAISEO vs Ahrefs, Semrush, Surfer SEO & Screaming Frog. AI visibility tracking + automated fixes from $39/month.",
  alternates: { canonical: `${SITE_URL}/vs` },
  openGraph: {
    title: "OptiAISEO Comparisons — vs Ahrefs, Semrush, Surfer SEO & More",
    description: "Find the right SEO tool for your needs. Honest comparisons with pricing, features, and when to choose each.",
    url: `${SITE_URL}/vs`,
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

// ─── Data ──────────────────────────────────────────────────────────────────────

const COMPARISONS = [
  { slug: "ahrefs", name: "Ahrefs", tagline: "The backlink-first SEO platform", category: "Enterprise", price: "From $129/month", verdict: "Ahrefs wins on backlink data depth. OptiAISEO wins on AI visibility, automated fixes, and cost." },
  { slug: "semrush", name: "Semrush", tagline: "The enterprise keyword & audit suite", category: "Enterprise", price: "From $139.95/month", verdict: "Semrush has the largest keyword database. OptiAISEO is the right choice for AI-first SEO at 72% lower cost." },
  { slug: "surfer-seo", name: "Surfer SEO", tagline: "The on-page content optimisation tool", category: "Content", price: "From $99/month", verdict: "Surfer SEO grades content you write. OptiAISEO generates and publishes the content automatically." },
  { slug: "moz", name: "Moz", tagline: "The Domain Authority pioneer", category: "Traditional", price: "From $99/month", verdict: "Moz invented DA. OptiAISEO is built for AI-era search — tracking ChatGPT citations and fixing code automatically." },
  { slug: "clearscope", name: "Clearscope", tagline: "The premium NLP content grader", category: "Content", price: "From $170/month", verdict: "Clearscope grades content at an enterprise price. OptiAISEO generates it at $39/month." },
  { slug: "mangools", name: "Mangools", tagline: "The budget-friendly keyword suite", category: "Budget", price: "From $49/month", verdict: "Mangools for keyword research. OptiAISEO when you need AI visibility tracking and automated fixes on top." },
  { slug: "screaming-frog", name: "Screaming Frog", tagline: "The technical SEO crawler", category: "Technical", price: "£199/year (~$249)", verdict: "Screaming Frog for deep one-off crawls. OptiAISEO for continuous monitoring with automated fixes." },
  { slug: "yoast", name: "Yoast SEO", tagline: "The WordPress SEO plugin", category: "WordPress", price: "Free / $99/year per site", verdict: "Yoast for WordPress on-page basics. OptiAISEO for any stack with AI visibility and content generation." },
];

const CATEGORY_COLORS: Record<string, string> = {
  Enterprise: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Content: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Traditional: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Budget: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Technical: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  WordPress: "bg-sky-500/10 text-sky-400 border-sky-500/20",
};

// ─── Summary comparison table data ────────────────────────────────────────────

const SUMMARY_TABLE = [
  {
    feature: "AI visibility tracking (ChatGPT, Claude, Perplexity)",
    optiai: "✓",
    ahrefs: "✗",
    semrush: "✗",
    surfer: "✗",
    sfrog: "✗",
  },
  {
    feature: "Automated GitHub code-fix PRs",
    optiai: "✓",
    ahrefs: "✗",
    semrush: "✗",
    surfer: "✗",
    sfrog: "✗",
  },
  {
    feature: "AI blog & comparison content generation",
    optiai: "✓",
    ahrefs: "✗",
    semrush: "✗",
    surfer: "✗",
    sfrog: "✗",
  },
  {
    feature: "Technical site audit",
    optiai: "✓",
    ahrefs: "✓",
    semrush: "✓",
    surfer: "✗",
    sfrog: "✓",
  },
  {
    feature: "Backlink index",
    optiai: "✗",
    ahrefs: "✓ (best)",
    semrush: "✓",
    surfer: "✗",
    sfrog: "✗",
  },
  {
    feature: "Keyword rank tracking",
    optiai: "✓",
    ahrefs: "✓",
    semrush: "✓",
    surfer: "✗",
    sfrog: "✗",
  },
  {
    feature: "On-page content grading",
    optiai: "✓",
    ahrefs: "Limited",
    semrush: "Limited",
    surfer: "✓ (best)",
    sfrog: "✗",
  },
  {
    feature: "Free tier (no card)",
    optiai: "✓",
    ahrefs: "✗",
    semrush: "✗",
    surfer: "✗",
    sfrog: "500 URL cap",
  },
  {
    feature: "Starting price",
    optiai: "$39/month",
    ahrefs: "$129/month",
    semrush: "$139.95/month",
    surfer: "$99/month",
    sfrog: "£199/year",
  },
];

// ─── USP highlight blocks ──────────────────────────────────────────────────────

const USPS = [
  {
    title: "The only tool that tracks your AI citations",
    body: "Ahrefs, Semrush, and Screaming Frog all measure traditional search. None of them tell you whether ChatGPT, Claude, or Perplexity recommend your brand. OptiAISEO does — weekly, automatically, with competitor benchmarking.",
  },
  {
    title: "Fixes issues instead of listing them",
    body: "Every other SEO tool surfaces issues and stops there. OptiAISEO detects a broken canonical, missing schema, or wrong robots directive — then opens a GitHub pull request with the exact corrected code. Your engineer clicks merge. The issue is resolved.",
  },
  {
    title: "Generates content, not just briefs",
    body: "Surfer SEO tells you what to write. Clearscope grades what you wrote. OptiAISEO writes the article, optimises it for AI and traditional search, and publishes it to your CMS. The whole workflow in one platform.",
  },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: "What is the best Ahrefs alternative?",
    a: "The best Ahrefs alternative depends on what you're replacing it for. If you need AI visibility tracking, automated code fixes, and content generation — OptiAISEO is the strongest alternative and starts at $39/month versus Ahrefs' $129/month. If you only need a comparable backlink database, SE Ranking or Semrush are closer alternatives. See our full OptiAISEO vs Ahrefs comparison for a feature-by-feature breakdown.",
  },
  {
    q: "Is OptiAISEO a Screaming Frog alternative?",
    a: "Yes — for teams running continuous site monitoring rather than one-off crawls. Screaming Frog is a desktop crawler you run manually. OptiAISEO monitors your site continuously, detects issues as they appear, and opens GitHub PRs with the fix — no manual crawl schedule required. Screaming Frog still wins for ad-hoc deep crawls on very large sites. See our Screaming Frog comparison for detail.",
  },
  {
    q: "How does OptiAISEO pricing compare to Semrush?",
    a: "OptiAISEO Pro starts at $39/month. Semrush starts at $139.95/month — a 72% price difference. OptiAISEO doesn't match Semrush's keyword database size or PPC research capabilities, but it includes AI visibility tracking, GitHub auto-fix PRs, and content generation that Semrush doesn't offer at any price. Most growing teams use both: Semrush for deep keyword research, OptiAISEO for execution and AI-era visibility.",
  },
  {
    q: "Does OptiAISEO replace Surfer SEO?",
    a: "For most content teams, yes. Surfer SEO grades content after you write it — it tells you what NLP terms to add. OptiAISEO generates the article with those optimisations already built in, then publishes it directly to your CMS. If you have a content team who want fine-grained human editing control over NLP grading, Surfer still has value alongside OptiAISEO for the writing and publishing layer.",
  },
];

const RELATED = [
  { href: "/vs/ahrefs", label: "OptiAISEO vs Ahrefs" },
  { href: "/vs/semrush", label: "OptiAISEO vs Semrush" },
  { href: "/vs/screaming-frog", label: "OptiAISEO vs Screaming Frog" },
  { href: "/free/seo-checker", label: "Free SEO audit" },
  { href: "/free/gso-checker", label: "Free AI visibility check" },
  { href: "/pricing", label: "View pricing" },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function VsIndexPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="OptiAISEO home">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <span className="font-black text-background text-[11px] tracking-tight">AI</span>
            </div>
            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Pricing</Link>
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href="/signup" className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all">Try free →</Link>
          </div>
        </div>
      </nav>

      <main id="main-content" className="flex-1 w-full">

        {/* ── Original hero ─────────────────────────────────────────────────── */}
        <div className="max-w-5xl mx-auto px-6 py-20 w-full">
          <div className="text-center mb-10">
            <nav aria-label="Breadcrumb" className="flex justify-center gap-2 text-muted-foreground text-sm mb-6">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
              <span>/</span><span className="text-foreground">Comparisons</span>
            </nav>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#10b981]/25 bg-[#10b981]/10 mb-6">
              <span className="text-xs font-semibold text-[#10b981] uppercase tracking-wider">Honest Comparisons — 2026</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
              OptiAISEO vs Every SEO Tool
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Honest, feature-by-feature comparisons. We tell you when the other tool is the better choice —
              and when OptiAISEO is. No spin.
            </p>
          </div>

          {/* ── NEW: Editorial intro ─────────────────────────────────────────── */}
          <div className="max-w-3xl mx-auto mb-16 text-center">
            <p className="text-muted-foreground leading-relaxed text-base mb-4">
              Most SEO tool comparison pages are written by the tool being compared — which means you get marketing copy disguised as analysis. These pages are different. Each comparison is structured around a single question: <em>which tool should you actually use for your specific situation?</em> And we tell you when the answer is not OptiAISEO.
            </p>
            <p className="text-muted-foreground leading-relaxed text-base">
              OptiAISEO is the best Ahrefs alternative if you need AI visibility tracking and automated code fixes at a fraction of the price. It&apos;s not the right Ahrefs alternative if you run a large-scale backlink acquisition operation that needs Ahrefs&apos; full 35-trillion-link index. Every comparison below makes that distinction clearly.
            </p>
          </div>

          {/* ── Original card grid (unchanged) ──────────────────────────────── */}
          <div className="grid md:grid-cols-2 gap-6">
            {COMPARISONS.map(({ slug, name, tagline, category, price, verdict }) => (
              <Link
                key={slug}
                href={`/vs/${slug}`}
                className="card-surface rounded-2xl p-8 flex flex-col hover:-translate-y-1 transition-all duration-200 group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-lg font-bold group-hover:text-[#10b981] transition-colors">
                        OptiAISEO vs {name}
                      </h2>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[category] ?? ""}`}>
                        {category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{tagline}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-[#10b981] transition-colors shrink-0 mt-1" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 flex-1">{verdict}</p>
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <span className="text-xs text-muted-foreground">{name}: <span className="font-semibold text-foreground">{price}</span></span>
                  <span className="text-xs text-[#10b981] font-semibold">OptiAISEO: from $0 free</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── NEW: Summary feature comparison table ────────────────────────── */}
        <section className="border-t border-border bg-muted/20 py-20">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
              Feature comparison at a glance
            </h2>
            <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
              How the five most-compared tools stack up across the features that matter most in 2026.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-card border-b border-border">
                    <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Feature</th>
                    <th className="text-left px-5 py-4 font-bold text-[#10b981]">OptiAISEO</th>
                    <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Ahrefs</th>
                    <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Semrush</th>
                    <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Surfer SEO</th>
                    <th className="text-left px-5 py-4 font-semibold text-muted-foreground">Screaming Frog</th>
                  </tr>
                </thead>
                <tbody>
                  {SUMMARY_TABLE.map(({ feature, optiai, ahrefs, semrush, surfer, sfrog }, i) => (
                    <tr key={feature} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-card/30"}`}>
                      <td className="px-5 py-3.5 text-muted-foreground font-medium">{feature}</td>
                      <td className="px-5 py-3.5 text-emerald-500 font-semibold">{optiai}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{ahrefs}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{semrush}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{surfer}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{sfrog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── NEW: USP blocks ──────────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
            What OptiAISEO does that no other SEO tool does
          </h2>
          <p className="text-muted-foreground text-center max-w-xl mx-auto mb-12 text-sm">
            Three capabilities that didn&apos;t exist when Ahrefs, Semrush, and Screaming Frog were built.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {USPS.map(({ title, body }) => (
              <div key={title} className="card-surface rounded-2xl p-8 flex flex-col">
                <div className="w-10 h-10 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center justify-center mb-4 shrink-0">
                  <Check className="w-5 h-5 text-[#10b981]" />
                </div>
                <h3 className="font-bold text-base mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Original "Don't see your tool" CTA card (unchanged) ─────────── */}
        <div className="max-w-5xl mx-auto px-6 pb-0">
          <div className="card-surface rounded-2xl p-10 text-center">
            <h2 className="text-2xl font-bold mb-3">Don&apos;t see your current tool?</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto text-sm">
              We&apos;re adding new comparisons every month. In the meantime, our free audit gives you a real-time view of your current SEO health — no tool switch required.
            </p>
            <Link
              href="/free/seo-checker"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background font-bold text-sm hover:opacity-90 transition-all"
            >
              Run a free audit — no account needed →
            </Link>
          </div>
        </div>

        {/* ── NEW: FAQ ─────────────────────────────────────────────────────── */}
        <section className="border-t border-border bg-muted/20 py-20 mt-20">
          <div className="max-w-3xl mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-10">
              Frequently asked questions
            </h2>
            <div className="space-y-3">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="card-surface rounded-2xl group">
                  <summary className="flex items-center justify-between px-6 py-5 cursor-pointer list-none font-semibold text-sm select-none">
                    <span>{q}</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 group-open:rotate-90" />
                  </summary>
                  <div className="px-6 pb-6 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">
                    {a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── NEW: Internal links ──────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-wrap justify-center gap-3">
            {RELATED.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-[#10b981] hover:text-[#10b981] transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>

      </main>

      <SiteFooter />
    </div>
  );
}