/**
 * GsoCheckerContent.tsx
 *
 * Drop-in SEO content block for /free/gso-checker.
 * Renders BELOW the existing tool UI, before <SiteFooter />.
 *
 * Usage in page.tsx — add to the bottom of the returned JSX:
 *   1. import GsoCheckerContent from './GsoCheckerContent';
 *   2. <GsoCheckerContent /> just before </div> (closing wrapper)
 *
 * No 'use client' — pure server component.
 */

import Link from 'next/link';
import { ArrowRight, Bot, Eye, BarChart3, TrendingUp, Zap, Check } from 'lucide-react';

// ─── Static data ───────────────────────────────────────────────────────────────

const WHAT_IS = [
    {
        icon: Eye,
        title: 'What is Generative Share of Voice (GSoV)?',
        body: 'GSoV measures how often your brand is mentioned when AI engines answer questions in your category — as a percentage of all brand mentions across those queries. If ChatGPT answers "best project management tool for startups" 100 times and mentions you 20 times, your GSoV is 20%. It\'s the AI-era equivalent of organic share of search.',
    },
    {
        icon: Bot,
        title: 'Which AI engines does this check?',
        body: 'The free check queries ChatGPT (GPT-4o), Claude, and Perplexity — the three AI engines that drive the most AI-influenced purchase decisions in B2B and SaaS. Google AI Overviews tracking is available in OptiAISEO Pro.',
    },
    {
        icon: BarChart3,
        title: 'How is your AI visibility score calculated?',
        body: 'OptiAISEO runs live queries in your product category, measures mention rate, position within the response, sentiment, and context accuracy. The free check gives you a letter grade and a mention rate. The full Pro report shows keyword-level breakdown, competitor gaps, and week-over-week trend.',
    },
];

const HOW_WORKS = [
    {
        num: '01',
        title: 'Enter your domain',
        body: 'No account needed. Enter your website domain and the checker identifies your product category automatically based on your homepage content.',
    },
    {
        num: '02',
        title: 'Live AI queries run',
        body: 'OptiAISEO sends queries to ChatGPT, Claude, and Perplexity in your product category — the same queries your prospects are asking right now. No simulation, no cached data.',
    },
    {
        num: '03',
        title: 'Brand mentions analysed',
        body: 'Each response is parsed for brand mentions, position, competitor co-mentions, and sentiment. Your GSoV score is calculated from the mention rate across all queries.',
    },
    {
        num: '04',
        title: 'Grade and next steps',
        body: 'You receive a letter grade (A–F), your mention rate percentage, and a preview of the category-level AI landscape. Upgrade to Pro to unlock keyword-by-keyword breakdown and fix recommendations.',
    },
];

const COMPARISON = [
    { feature: 'Price', us: 'Free (no card)', manual: 'Your time — hours/week', brandwatch: 'From $1,000+/mo' },
    { feature: 'AI engines covered', us: 'ChatGPT, Claude, Perplexity', manual: 'Whatever you remember to check', brandwatch: 'Limited AI coverage' },
    { feature: 'Live query data', us: '✓ Real queries, not estimates', manual: '⚠ Depends on effort', brandwatch: '⚠ Varies by plan' },
    { feature: 'Competitor comparison', us: '✓ Included in Pro', manual: '✗ Manual, error-prone', brandwatch: '✓ Yes' },
    { feature: 'Weekly tracking', us: '✓ Pro — automated', manual: '✗ Not scalable', brandwatch: '✓ Yes' },
    { feature: 'Fix recommendations', us: '✓ Pro — actionable steps', manual: '✗ You figure it out', brandwatch: '✗ Monitoring only' },
    { feature: 'GitHub PR auto-fix', us: '✓ Pro — code fix PRs', manual: '✗ Not available', brandwatch: '✗ Not available' },
];

const USE_CASES = [
    {
        label: 'SaaS companies',
        body: 'Your Google ranking is irrelevant when a prospect asks ChatGPT "which tool should I use." Track your AI share of voice before your competitors realise it matters.',
    },
    {
        label: 'Marketing agencies',
        body: 'Add AI visibility reporting to every client retainer. The free check gives you an instant answer. Pro gives you the weekly trend data clients will pay to track.',
    },
    {
        label: 'E-commerce brands',
        body: 'AI engines are increasingly used for product discovery. Know whether ChatGPT recommends your product category — and what it says about your brand when it does.',
    },
    {
        label: 'B2B teams',
        body: 'Every enterprise buyer now uses AI to build vendor shortlists before ever visiting your website. Your GSoV score is your first impression — and most teams don\'t know theirs.',
    },
];

const FAQS = [
    {
        q: 'What is an AI visibility checker?',
        a: 'An AI visibility checker measures how often and how prominently your brand appears in AI-generated responses across engines like ChatGPT, Claude, Perplexity, and Google AI Overviews. Unlike traditional rank tracking (which measures position in blue-link results), AI visibility tracking measures your Generative Share of Voice — how frequently AI recommends you when users ask questions in your category.',
    },
    {
        q: 'Does ChatGPT mention my brand?',
        a: 'This free checker answers exactly that question. Enter your domain and it runs live queries to ChatGPT, Claude, and Perplexity in your product category — then shows you whether and how often your brand appears in the responses. Most brands are shocked by their score: AI engines have strong preferences built from training data, and many well-known brands have near-zero AI visibility.',
    },
    {
        q: 'How do I improve my AI visibility score?',
        a: 'AI visibility improves through three mechanisms: (1) getting mentioned in authoritative third-party content (press, review sites, comparison pages) that AI engines are trained on, (2) having clear, structured brand facts on your own website that AI can extract accurately, and (3) generating comparison and use-case content that directly answers the queries your prospects ask AI. OptiAISEO Pro\'s fix recommendations tell you exactly which of these gaps applies to your brand.',
    },
    {
        q: 'How is GSoV different from SEO rank tracking?',
        a: 'Traditional rank tracking measures your position in Google\'s ten blue links for a set of keywords. GSoV measures how often your brand is mentioned in AI-generated summaries and answers — which have no fixed "positions" and are weighted very differently from traditional search results. A brand can rank #1 on Google for a keyword and have zero AI visibility for the same query — and vice versa.',
    },
    {
        q: 'How often should I check my AI visibility?',
        a: 'AI engine outputs change as their underlying models are updated and as the content they\'re trained on shifts. For accurate trend data, weekly tracking is the minimum. The free checker gives you a point-in-time snapshot. OptiAISEO Pro runs automated weekly queries and shows you week-over-week GSoV movement so you can correlate content changes to visibility gains.',
    },
];

const RELATED = [
    { href: '/aio', label: 'AIO: AI optimization guide' },
    { href: '/geo', label: 'GEO: generative engine optimization' },
    { href: '/free/seo-checker', label: 'Free SEO audit tool' },
    { href: '/for-saas', label: 'For SaaS companies' },
    { href: '/for-agencies', label: 'For agencies' },
    { href: '/pricing', label: 'View pricing' },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function GsoCheckerContent() {
    return (
        <div className="border-t border-border mt-12">

            {/* ── 1. What is this / Three concept cards ────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-5xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        What is AI visibility — and why does it matter in 2026?
                    </h2>
                    <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12 text-sm leading-relaxed">
                        Over 50% of B2B buying journeys now start with an AI engine query rather than a Google search. Your AI visibility score is the new homepage first impression — and most brands have no idea what theirs is.
                    </p>
                    <div className="grid md:grid-cols-3 gap-6">
                        {WHAT_IS.map(({ icon: Icon, title, body }) => (
                            <div key={title} className="card-surface rounded-2xl p-8 flex flex-col">
                                <div className="w-10 h-10 rounded-xl bg-[color:var(--brand)]/10 border border-[color:var(--brand)]/20 flex items-center justify-center mb-4 shrink-0">
                                    <Icon className="w-5 h-5 text-[color:var(--brand)]" />
                                </div>
                                <h3 className="font-bold text-base mb-3">{title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 2. How it works ──────────────────────────────────────────────────── */}
            <section className="max-w-4xl mx-auto px-6 py-20">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
                    How the free AI visibility checker works
                </h2>
                <div className="space-y-4">
                    {HOW_WORKS.map(({ num, title, body }) => (
                        <div key={num} className="card-surface rounded-xl p-6 flex items-start gap-6">
                            <span className="text-4xl font-black text-[color:var(--brand)]/15 shrink-0 leading-none">{num}</span>
                            <div>
                                <h3 className="font-bold text-base mb-2">{title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── 3. Comparison table ──────────────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        OptiAISEO vs manual tracking vs Brandwatch
                    </h2>
                    <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
                        You can track AI mentions manually or with enterprise monitoring tools. Here&apos;s the honest comparison.
                    </p>
                    <div className="overflow-x-auto rounded-2xl border border-border">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-card border-b border-border">
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Feature</th>
                                    <th className="text-left px-6 py-4 font-bold text-[color:var(--brand)]">OptiAISEO</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Manual tracking</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Brandwatch</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON.map(({ feature, us, manual, brandwatch }, i) => (
                                    <tr key={feature} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-card/30'}`}>
                                        <td className="px-6 py-4 text-muted-foreground font-medium">{feature}</td>
                                        <td className="px-6 py-4 text-emerald-500 font-semibold">{us}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{manual}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{brandwatch}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* ── 4. Who it's for ──────────────────────────────────────────────────── */}
            <section className="max-w-5xl mx-auto px-6 py-20">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
                    Who needs an AI visibility checker
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                    {USE_CASES.map(({ label, body }) => (
                        <div key={label} className="card-surface rounded-2xl p-8 flex items-start gap-4">
                            <div className="w-8 h-8 rounded-lg bg-[color:var(--brand)]/10 border border-[color:var(--brand)]/20 flex items-center justify-center shrink-0 mt-0.5">
                                <Check className="w-4 h-4 text-[color:var(--brand)]" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base mb-2">{label}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── 5. FAQ ───────────────────────────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
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

            {/* ── 6. CTA banner ────────────────────────────────────────────────────── */}
            <section className="bg-foreground text-background py-20">
                <div className="max-w-3xl mx-auto px-6 text-center">
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
                        Track your AI score weekly, not once
                    </h2>
                    <p className="text-background/60 mb-8 max-w-xl mx-auto text-sm leading-relaxed">
                        A one-time check tells you where you stand today. OptiAISEO Pro tracks your GSoV every week, shows competitor movement, and tells you exactly what content to create to improve your AI citation rate.
                    </p>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#10b981] text-white font-bold text-base hover:opacity-90 transition-all active:scale-95"
                    >
                        <Zap className="w-5 h-5" />
                        Start free — no credit card
                    </Link>
                </div>
            </section>

            {/* ── 7. Related links ─────────────────────────────────────────────────── */}
            <section className="max-w-5xl mx-auto px-6 py-10">
                <div className="flex flex-wrap justify-center gap-3">
                    {RELATED.map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            className="text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-[color:var(--brand)] hover:text-[color:var(--brand)] transition-colors"
                        >
                            {label}
                        </Link>
                    ))}
                </div>
            </section>

        </div>
    );
}