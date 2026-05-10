/**
 * RedditSeoContent.tsx
 *
 * Drop-in SEO content block for /free/reddit-seo.
 * Renders BELOW the existing tool results section.
 *
 * Usage in page.tsx:
 *   1. import RedditSeoContent from './RedditSeoContent';
 *   2. Add <RedditSeoContent /> at the bottom of the returned JSX,
 *      before the closing </div> of min-h-screen wrapper.
 *
 * No 'use client' — pure server component.
 * Matches the orange accent (#f97316 / orange-500) the page already uses.
 */

import Link from 'next/link';
import { ArrowRight, TrendingUp, Search, MessageCircle, BarChart3, Zap, Check } from 'lucide-react';

// ─── Static data ───────────────────────────────────────────────────────────────

const WHAT_IS_BLOCKS = [
    {
        icon: MessageCircle,
        title: 'Why Reddit ranks on Google',
        body: 'Google boosted Reddit in its 2024 Helpful Content Update, giving Reddit threads top-3 positions for thousands of comparison, recommendation, and "best of" queries. Reddit isn\'t just a community — it\'s now one of the highest-authority domains in Google\'s index for informational and commercial intent queries.',
    },
    {
        icon: TrendingUp,
        title: 'What is a Reddit SEO opportunity?',
        body: 'A Reddit SEO opportunity is a subreddit thread that already ranks on Google\'s first page — but where your brand isn\'t mentioned, where competitors are, or where the top comment recommends a product you compete with. These threads are already getting traffic. Your job is to get mentioned in them.',
    },
    {
        icon: BarChart3,
        title: 'How this tool finds opportunities',
        body: 'Enter a keyword and the tool surfaces Reddit threads ranking for that term on Google, shows you the estimated traffic each thread receives, and flags whether your brand or a competitor is mentioned. You get a prioritised list of threads to engage with — or create content about.',
    },
];

const STEPS = [
    {
        num: '01',
        title: 'Enter a target keyword',
        body: 'Use any keyword your prospects might search. Category terms ("best CRM for startups"), comparison queries ("HubSpot vs Salesforce"), or problem-led queries ("how to track sales pipeline") all return strong Reddit signals.',
    },
    {
        num: '02',
        title: 'See Reddit threads ranking on Google',
        body: 'The tool returns threads from Reddit that Google has ranked on page one for your keyword — along with their current ranking position and estimated monthly traffic volume from organic search.',
    },
    {
        num: '03',
        title: 'Identify brand and competitor mentions',
        body: 'Each result is flagged: is your brand mentioned? Is a competitor mentioned? A thread ranking in the top 3 where a competitor is mentioned but you aren\'t is your highest-priority opportunity.',
    },
    {
        num: '04',
        title: 'Engage or create content',
        body: 'Two tactics: (1) engage authentically in the thread if it\'s recent and active, (2) create a blog post or landing page that targets the same keyword with more depth than the Reddit thread — so your page eventually displaces it in search results.',
    },
];

const COMPARISON = [
    { feature: 'Price', us: 'Free — no account needed', atp: 'From $9/month', manual: 'Your time — hours' },
    { feature: 'Reddit-specific results', us: '✓ Reddit threads only', atp: '✗ General question data', manual: '⚠ If you know where to look' },
    { feature: 'Google ranking position shown', us: '✓ Yes — for each thread', atp: '✗ No', manual: '✗ Manual check required' },
    { feature: 'Brand mention detection', us: '✓ Yes — yours + competitors', atp: '✗ No', manual: '✗ Manual check required' },
    { feature: 'Estimated traffic per thread', us: '✓ Yes', atp: '✗ No', manual: '✗ No' },
    { feature: 'Subreddit identified', us: '✓ Yes', atp: '✗ No', manual: '✓ If you check manually' },
];

const USE_CASES = [
    {
        label: 'SaaS & B2B companies',
        body: 'Your category has dozens of "best [tool] for [use case]" threads ranking on Google. Find the ones where competitors are recommended and you aren\'t — then create better content to outrank them.',
    },
    {
        label: 'Content marketers',
        body: 'Use Reddit thread titles as content briefs. Threads that rank on Google answer real questions with real search volume. Every high-ranking thread is proof of a content gap worth filling.',
    },
    {
        label: 'SEO agencies',
        body: 'Add Reddit SEO to your monthly content strategy for every client. The tool identifies the threads driving actual Google traffic — not just subreddit popularity — so your content targets the right opportunities.',
    },
    {
        label: 'E-commerce brands',
        body: 'Product recommendation threads on subreddits like r/BuyItForLife, r/frugal, and category-specific communities rank for high-intent queries. Find threads where you should be mentioned but aren\'t.',
    },
];

const FAQS = [
    {
        q: 'What is Reddit SEO?',
        a: 'Reddit SEO refers to strategies for getting your brand or content mentioned in Reddit threads that rank on Google — and for creating content that outranks Reddit threads for valuable keywords. Since Google\'s 2024 ranking boost for Reddit content, threads from Reddit now appear on the first page for thousands of high-intent queries. A brand mentioned in these threads benefits from Google traffic without paying for it.',
    },
    {
        q: 'How do I find Reddit SEO opportunities for my business?',
        a: 'Enter your target keywords into this tool. It surfaces Reddit threads that Google has already ranked on page one for those terms, along with their ranking position, estimated traffic, and whether your brand or competitors are mentioned. The highest-priority opportunities are threads with significant traffic where a competitor is mentioned but you aren\'t.',
    },
    {
        q: 'Is it worth engaging on Reddit for SEO?',
        a: 'Yes — but only authentically. Reddit communities penalise promotional content aggressively. The effective approach is to: (1) participate genuinely in discussions related to your product category over time, building karma and credibility, (2) answer questions helpfully where your product is a genuine solution, and (3) create content that targets the same keywords as high-ranking threads, aiming to outrank them in organic search.',
    },
    {
        q: 'How is this different from AnswerThePublic?',
        a: 'AnswerThePublic surfaces question variants around keywords — it shows you what people ask, not where the answers rank. This tool is Reddit-specific: it shows you which Reddit threads are currently ranking on Google\'s first page for your keywords, how much traffic they get, and who\'s mentioned in them. It\'s actionable intelligence, not keyword ideation.',
    },
    {
        q: 'Can I use Reddit data to inform my content strategy?',
        a: 'Absolutely — and this is one of the highest-ROI uses of the tool. Every Reddit thread ranking on Google is proof that Google considers the topic worth ranking. Use the thread titles as content briefs, the top-upvoted comments as angles to address, and the subreddits as distribution channels once your content is published. OptiAISEO Pro can generate a full SEO-optimised article brief from a Reddit thread automatically.',
    },
];

const RELATED = [
    { href: '/free/seo-checker', label: 'Free SEO audit tool' },
    { href: '/free/gso-checker', label: 'Free AI visibility checker' },
    { href: '/for-content', label: 'For content teams' },
    { href: '/for-saas', label: 'For SaaS companies' },
    { href: '/for-agencies', label: 'For agencies' },
    { href: '/pricing', label: 'View pricing' },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function RedditSeoContent() {
    return (
        <div className="border-t border-border mt-12">

            {/* ── 1. What is Reddit SEO ────────────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-5xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        Why Reddit is an untapped SEO channel in 2026
                    </h2>
                    <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12 text-sm leading-relaxed">
                        Reddit content now ranks on Google&apos;s first page for over 10 million keywords. Most brands have no idea which threads in their category are already driving traffic — or whether their competitors are being recommended in them.
                    </p>
                    <div className="grid md:grid-cols-3 gap-6">
                        {WHAT_IS_BLOCKS.map(({ icon: Icon, title, body }) => (
                            <div key={title} className="card-surface rounded-2xl p-8 flex flex-col">
                                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-4 shrink-0">
                                    <Icon className="w-5 h-5 text-orange-400" />
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
                    How to find Reddit SEO opportunities for your business
                </h2>
                <div className="space-y-4">
                    {STEPS.map(({ num, title, body }) => (
                        <div key={num} className="card-surface rounded-xl p-6 flex items-start gap-6">
                            <span className="text-4xl font-black text-orange-400/20 shrink-0 leading-none">{num}</span>
                            <div>
                                <h3 className="font-bold text-base mb-2">{title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── 3. Comparison ────────────────────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        Reddit SEO tool vs AnswerThePublic vs manual research
                    </h2>
                    <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
                        Other tools tell you what people ask. This one shows you which Reddit threads are already ranking and getting traffic for those questions.
                    </p>
                    <div className="overflow-x-auto rounded-2xl border border-border">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-card border-b border-border">
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Feature</th>
                                    <th className="text-left px-6 py-4 font-bold text-orange-400">OptiAISEO (free)</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">AnswerThePublic</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Manual research</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON.map(({ feature, us, atp, manual }, i) => (
                                    <tr key={feature} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-card/30'}`}>
                                        <td className="px-6 py-4 text-muted-foreground font-medium">{feature}</td>
                                        <td className="px-6 py-4 text-emerald-500 font-semibold">{us}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{atp}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{manual}</td>
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
                    Who this Reddit SEO strategy tool is built for
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                    {USE_CASES.map(({ label, body }) => (
                        <div key={label} className="card-surface rounded-2xl p-8 flex items-start gap-4">
                            <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                <Check className="w-4 h-4 text-orange-400" />
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

            {/* ── 6. CTA ───────────────────────────────────────────────────────────── */}
            <section className="bg-zinc-950 text-white py-20">
                <div className="max-w-3xl mx-auto px-6 text-center">
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
                        Turn Reddit signals into content that ranks
                    </h2>
                    <p className="text-white/65 mb-8 max-w-xl mx-auto text-sm leading-relaxed">
                        OptiAISEO Pro takes Reddit opportunity data and generates a full SEO-optimised article brief — complete with target keywords, heading structure, and competitor angle — ready to publish in one click.
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

            {/* ── 7. Related ───────────────────────────────────────────────────────── */}
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