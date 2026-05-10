/**
 * SeoCheckerContent.tsx  —  v2 (SEO-hardened)
 *
 * Improvements over v1:
 *  1. Exact-match keyword heading + subhead
 *  2. "What is an SEO audit?" informational-intent section
 *  3. Competitor limitations section (narrative, not just table)
 *  4. Example audit report (structured text mockup)
 *  5. Keyword variations woven through headings + FAQs
 *
 * Drop-in below existing tool UI, before <SiteFooter />.
 * Pure server component — zero JS weight.
 */

import Link from 'next/link';
import {
    Check,
    ArrowRight,
    Zap,
    Shield,
    Clock,
    FileSearch,
    Code2,
    BarChart3,
    Globe,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    MinusCircle,
} from 'lucide-react';

// ─── Static data ───────────────────────────────────────────────────────────────

const CHECKS = [
    {
        icon: FileSearch,
        title: 'On-page analysis',
        body: 'Title tags, meta descriptions, heading hierarchy (H1–H6), keyword placement, image alt text, and internal anchor text — every on-page signal scored and explained.',
    },
    {
        icon: Code2,
        title: 'Technical SEO',
        body: 'Canonical tags, robots directives, Core Web Vitals flags, crawlability, structured data presence, HTTPS enforcement, and mobile usability — all checked automatically.',
    },
    {
        icon: Globe,
        title: 'Indexability signals',
        body: 'Whether Google can find, crawl, and index your page. Identifies noindex tags, blocked resources in robots.txt, redirect chains, and sitemap conflicts.',
    },
    {
        icon: BarChart3,
        title: 'Content quality signals',
        body: 'Thin content detection, duplicate title/description flags, content length relative to intent, and readability scoring — so you know exactly why a page underperforms.',
    },
    {
        icon: Shield,
        title: 'Security & trust signals',
        body: 'HTTPS validity, mixed-content warnings, missing security headers, and Core Web Vitals thresholds — signals Google uses to assess page experience.',
    },
    {
        icon: Clock,
        title: 'Prioritised fix list',
        body: 'Issues ranked by SEO impact, not volume. You see which three fixes will move rankings fastest — not a wall of warnings sorted by severity alone.',
    },
];

const STEPS = [
    {
        num: '01',
        title: 'Enter any URL',
        body: 'Paste your homepage, a landing page, or a blog post — the checker runs on any publicly accessible URL. No account, no install.',
    },
    {
        num: '02',
        title: 'Audit runs in real time',
        body: 'OptiAISEO crawls the page, evaluates on-page signals, technical health, indexability, and content quality. Results stream back in under 15 seconds.',
    },
    {
        num: '03',
        title: 'Get a shareable report',
        body: 'Your report lives at a unique URL you can share with your team or client immediately. No export required — the link is the deliverable.',
    },
];

const COMPARISON = [
    { feature: 'Price', us: 'Free — no card needed', sfrog: '£199/year licence', sitebulb: 'From $139.99/year' },
    { feature: 'Setup required', us: 'None — runs in browser', sfrog: 'Windows/Mac desktop app', sitebulb: 'Desktop app install' },
    { feature: 'Result speed', us: '< 15 seconds', sfrog: 'Minutes (full crawl)', sitebulb: 'Minutes (full crawl)' },
    { feature: 'Shareable report link', us: '✓ Instant', sfrog: '✗ Export only', sitebulb: '✗ Export only' },
    { feature: 'AI visibility tracking', us: '✓ Included in Pro', sfrog: '✗ Not available', sitebulb: '✗ Not available' },
    { feature: 'Auto GitHub fix PRs', us: '✓ Included in Pro', sfrog: '✗ Not available', sitebulb: '✗ Not available' },
    { feature: 'AI content generation', us: '✓ Included in Pro', sfrog: '✗ Not available', sitebulb: '✗ Not available' },
    { feature: 'No login for quick audit', us: '✓ Always', sfrog: '✗ Requires install', sitebulb: '✗ Requires install' },
];

const COMPETITOR_LIMITATIONS = [
    {
        tool: 'Screaming Frog',
        icon: '🐸',
        limitations: [
            'Requires Windows or macOS desktop install — no browser-based access',
            'Free version hard-capped at 500 URLs; anything larger needs a £199/year licence',
            'Produces raw CSV exports, not shareable links — every client deliverable needs manual formatting',
            'No AI-powered fix generation, no automated pull requests, no content suggestions',
            'A full crawl takes minutes; there is no single-page "quick check" mode',
        ],
    },
    {
        tool: 'Sitebulb',
        icon: '💡',
        limitations: [
            'Desktop-only (Windows/Mac) with no cloud or browser option',
            'Starts at $139.99/year — there is no meaningful free tier for real audits',
            'Reports are exported files, not live URLs you can hand to a client in seconds',
            'Crawl speed is limited by your local machine and internet connection',
            'No AI features, no automated fix PRs, no AI visibility tracking',
        ],
    },
];

// Example report data — representative, not real
const EXAMPLE_REPORT = {
    url: 'example-saas.com/pricing',
    score: 61,
    checks: [
        { category: 'Title tag', status: 'warn', detail: 'Title is 78 chars — truncated in SERPs above 60. Rewrite to ≤ 60 chars.' },
        { category: 'Meta description', status: 'fail', detail: 'Missing. Google will auto-generate a snippet, usually poorly. Add a 120–155 char description.' },
        { category: 'H1 tag', status: 'pass', detail: 'One H1 found: "Plans & Pricing". Matches page intent.' },
        { category: 'Canonical tag', status: 'pass', detail: 'Self-referencing canonical present. No duplicate content risk.' },
        { category: 'Core Web Vitals — LCP', status: 'fail', detail: 'LCP estimated at 4.1 s (threshold: 2.5 s). Largest element: hero image. Compress and add fetchpriority="high".' },
        { category: 'Structured data', status: 'warn', detail: 'No Product or PriceSpec schema found. Adding JSON-LD can trigger rich results for pricing pages.' },
        { category: 'Mobile usability', status: 'pass', detail: 'Viewport meta present. No tap-target or font-size issues detected.' },
        { category: 'HTTPS', status: 'pass', detail: 'Valid TLS certificate. No mixed-content warnings.' },
        { category: 'Internal links', status: 'warn', detail: '0 internal links on this page. Add links to /features and /docs to distribute page authority.' },
        { category: 'Image alt text', status: 'fail', detail: '3 of 5 images missing alt attributes. Add descriptive alt text for accessibility and image SEO.' },
    ],
    topFixes: [
        'Add meta description (120–155 chars) — immediate SERP click-through improvement',
        'Compress hero image and add fetchpriority="high" — fixes LCP failure',
        'Add alt text to 3 images — accessibility + indexability win',
    ],
};

const statusConfig = {
    pass: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Pass' },
    warn: { icon: MinusCircle, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Warning' },
    fail: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Fail' },
} as const;

const USE_CASES = [
    {
        label: 'SaaS founders',
        body: 'Audit your marketing site before launch or after every major content push. No engineering overhead — just a URL and a result.',
    },
    {
        label: 'Freelancers & agencies',
        body: 'Drop a shareable report link into every client proposal. Professional, instant, and white-label-ready when you upgrade.',
    },
    {
        label: 'Content teams',
        body: 'Check individual pages before and after publishing. Confirm your H1, meta description, and internal links are correctly set without touching a crawler.',
    },
    {
        label: 'Growth & marketing teams',
        body: 'Run an audit after every CMS migration, template change, or A/B test to catch regressions before they cost you ranking positions.',
    },
];

const FAQS = [
    {
        q: 'Is this SEO audit tool really free?',
        a: 'Yes — the single-page free SEO audit requires no account and no credit card. You enter a URL, the website SEO checker runs, and you get a full scored report with prioritised fixes. OptiAISEO Pro (from $39/month) extends this to continuous monitoring, AI visibility tracking, and automated GitHub fix PRs across your whole site.',
    },
    {
        q: 'What does the free SEO checker actually analyse?',
        a: 'The free SEO analysis covers on-page signals (title, meta, headings, content quality), technical SEO (canonical, robots, Core Web Vitals flags, HTTPS, structured data), indexability (crawlability, sitemap conflicts, redirect chains), and a prioritised fix list ranked by estimated ranking impact.',
    },
    {
        q: 'What is an SEO audit and why do I need one?',
        a: 'An SEO audit is a structured review of your webpage against the signals search engines use to rank content: on-page elements, technical health, content quality, and indexability. You need one because most ranking problems are invisible in normal browsing — a missing canonical tag, a slow LCP score, or a noindex directive left in place after a staging migration can silently suppress your rankings for months. A free website SEO audit surfaces these issues in seconds.',
    },
    {
        q: 'How is this different from Screaming Frog or Sitebulb?',
        a: "Screaming Frog and Sitebulb are desktop crawlers — they require installation, take minutes for a full-site crawl, and produce CSV exports rather than shareable reports. OptiAISEO's free SEO checker runs in your browser on any URL in under 15 seconds, with no install and an instant shareable link. For full-site continuous monitoring with automated fixes, OptiAISEO Pro replaces both tools at a lower annual cost.",
    },
    {
        q: 'How long does the free SEO audit take?',
        a: 'Single-page SEO audits typically complete in 10–20 seconds. The online SEO checker fetches your page, evaluates all signals in parallel, and streams results back in real time — you can watch the score build as each check completes.',
    },
    {
        q: 'How often should I run an SEO audit on my site?',
        a: 'Run a free SEO analysis after any significant change: a new page, a CMS migration, a template update, or a major content edit. For actively managed sites, monthly audits catch slow regressions before they compound. If you ship code frequently, OptiAISEO Pro runs continuous audits automatically and alerts you when a score drops.',
    },
    {
        q: 'Can I audit competitor websites?',
        a: "Yes — you can audit any publicly accessible URL with this free SEO tool. Auditing competitor pages is one of the most effective ways to identify the exact on-page and technical gaps they're exploiting for rankings you're not capturing yet.",
    },
];

const RELATED = [
    { href: '/vs/screaming-frog', label: 'OptiAISEO vs Screaming Frog' },
    { href: '/vs/ahrefs', label: 'OptiAISEO vs Ahrefs' },
    { href: '/free/gso-checker', label: 'Free AI visibility checker' },
    { href: '/for-agencies', label: 'For agencies' },
    { href: '/for-saas', label: 'For SaaS companies' },
    { href: '/pricing', label: 'View pricing' },
];

// Score ring colour
function scoreColor(score: number) {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 50) return 'text-amber-500';
    return 'text-red-500';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function SeoCheckerContent() {
    return (
        <div className="border-t border-border">

            {/* ── 1. Keyword-exact intro ────────────────────────────────────────────── */}
            <section className="max-w-3xl mx-auto px-6 py-20 text-center">
                {/* 
          Primary H2 carries exact-match phrases: "Free SEO Audit Tool" + 
          "Website SEO Checker" so Google can match both head terms. 
        */}
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">
                    Free SEO Audit Tool — Instant Website SEO Checker
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                    Online SEO analysis for any URL · No install · Results in &lt; 15 seconds
                </p>
                <p className="text-muted-foreground leading-relaxed text-base mb-4">
                    OptiAISEO&apos;s free SEO audit tool analyses any webpage in under 15 seconds — no account, no browser extension, no desktop install. You get a scored report covering on-page SEO, technical health, indexability, and content quality, with each issue ranked by the impact it will have on your Google rankings if you fix it.
                </p>
                <p className="text-muted-foreground leading-relaxed text-base">
                    Most free SEO checkers surface a list of warnings and leave you to work out what matters. This online SEO checker tells you which three fixes will move the needle fastest — then links you to the exact documentation to implement them. If you need fixes applied automatically, OptiAISEO Pro opens a GitHub pull request with the corrected code so your engineer just clicks merge.
                </p>
            </section>

            {/* ── 2. What is an SEO audit (informational intent) ───────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-3xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-6">
                        What is an SEO audit — and why does it matter?
                    </h2>
                    <div className="space-y-4 text-muted-foreground leading-relaxed text-base">
                        <p>
                            An <strong className="text-foreground">SEO audit</strong> is a structured review of a webpage or website against the signals search engines use to decide where it ranks: on-page elements (title, headings, content), technical health (speed, crawlability, structured data), content quality, and indexability. Think of it as a health check for your visibility on Google.
                        </p>
                        <p>
                            The reason you need one is that most ranking problems are completely invisible during normal browsing. A <code className="text-xs bg-card px-1.5 py-0.5 rounded border border-border">noindex</code> directive left in place after a staging migration. A canonical tag pointing to the wrong URL. A hero image causing your Largest Contentful Paint to breach Google&apos;s 2.5-second threshold. None of these show up when you visit your site in a browser — but all of them can suppress your rankings for months before anyone notices.
                        </p>
                        <p>
                            A free website SEO audit surfaces these issues in seconds. It gives you a prioritised fix list so you know which change will have the biggest ranking impact — rather than spending a week on cosmetic improvements while a crawl blocker quietly tanks your most important pages.
                        </p>
                        <div className="grid sm:grid-cols-3 gap-4 mt-8">
                            {[
                                { label: 'When to audit', items: ['Before launch', 'After a CMS migration', 'After a template change', 'After any major content edit', 'Monthly for active sites'] },
                                { label: 'What it catches', items: ['Missing meta descriptions', 'Broken canonical tags', 'Core Web Vitals failures', 'Noindex regressions', 'Thin or duplicate content'] },
                                { label: 'What it improves', items: ['Crawl coverage', 'Click-through rates', 'Page experience score', 'Content relevance signals', 'Index rate'] },
                            ].map(({ label, items }) => (
                                <div key={label} className="card-surface rounded-xl p-5">
                                    <p className="font-semibold text-sm mb-3">{label}</p>
                                    <ul className="space-y-1.5">
                                        {items.map(item => (
                                            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <Check className="w-3.5 h-3.5 text-[color:var(--brand)] mt-0.5 shrink-0" />
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 3. What the checker analyses ─────────────────────────────────────── */}
            <section className="py-20">
                <div className="max-w-5xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        What the free SEO checker analyses
                    </h2>
                    <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12 text-sm">
                        Six categories. Every check runs in parallel so results come back in seconds, not minutes.
                    </p>
                    <div className="grid md:grid-cols-3 gap-6">
                        {CHECKS.map(({ icon: Icon, title, body }) => (
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

            {/* ── 4. Example SEO audit report ──────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        Example SEO audit report
                    </h2>
                    <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
                        Here&apos;s what a real website SEO audit looks like. Every check is scored, explained, and ranked by impact — not just listed.
                    </p>

                    {/* Report shell */}
                    <div className="card-surface rounded-2xl border border-border overflow-hidden">
                        {/* Report header */}
                        <div className="px-6 py-5 border-b border-border flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-muted-foreground mb-0.5">Audited URL</p>
                                <p className="font-mono text-sm font-semibold truncate">https://{EXAMPLE_REPORT.url}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <div className={`text-4xl font-black ${scoreColor(EXAMPLE_REPORT.score)}`}>
                                    {EXAMPLE_REPORT.score}
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">SEO score</p>
                                    <p className="text-xs font-semibold text-amber-500">Needs work</p>
                                </div>
                            </div>
                        </div>

                        {/* Score bars */}
                        <div className="px-6 py-4 border-b border-border grid grid-cols-3 gap-4 text-center text-sm">
                            {[
                                { label: 'Pass', count: EXAMPLE_REPORT.checks.filter(c => c.status === 'pass').length, color: 'text-emerald-500' },
                                { label: 'Warning', count: EXAMPLE_REPORT.checks.filter(c => c.status === 'warn').length, color: 'text-amber-500' },
                                { label: 'Fail', count: EXAMPLE_REPORT.checks.filter(c => c.status === 'fail').length, color: 'text-red-500' },
                            ].map(({ label, count, color }) => (
                                <div key={label}>
                                    <p className={`text-2xl font-black ${color}`}>{count}</p>
                                    <p className="text-xs text-muted-foreground">{label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Top fixes callout */}
                        <div className="px-6 py-4 border-b border-border bg-[color:var(--brand)]/5">
                            <p className="text-xs font-bold uppercase tracking-wide text-[color:var(--brand)] mb-3">
                                Top 3 fixes by ranking impact
                            </p>
                            <ol className="space-y-2">
                                {EXAMPLE_REPORT.topFixes.map((fix, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm">
                                        <span className="w-5 h-5 rounded-full bg-[color:var(--brand)] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                            {i + 1}
                                        </span>
                                        <span className="text-foreground">{fix}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>

                        {/* Check rows */}
                        <div className="divide-y divide-border">
                            {EXAMPLE_REPORT.checks.map(({ category, status, detail }) => {
                                const cfg = statusConfig[status as keyof typeof statusConfig];
                                const StatusIcon = cfg.icon;
                                return (
                                    <div key={category} className="px-6 py-4 flex items-start gap-4">
                                        <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                                            <StatusIcon className={`w-4 h-4 ${cfg.color}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="font-semibold text-sm">{category}</p>
                                                <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Demo footer */}
                        <div className="px-6 py-4 border-t border-border bg-card/50 text-center">
                            <p className="text-xs text-muted-foreground">
                                This is a representative example. Run the free SEO audit above to see the real report for your URL.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 5. How it works ──────────────────────────────────────────────────── */}
            <section className="max-w-4xl mx-auto px-6 py-20">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
                    How the free website SEO checker works
                </h2>
                <div className="space-y-4">
                    {STEPS.map(({ num, title, body }) => (
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

            {/* ── 6. Competitor limitations (narrative) ────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        Why Screaming Frog and Sitebulb fall short for quick SEO analysis
                    </h2>
                    <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
                        Both tools are powerful for deep site crawls. But for fast, shareable, single-page SEO audits they have real limitations.
                    </p>
                    <div className="grid md:grid-cols-2 gap-6 mb-10">
                        {COMPETITOR_LIMITATIONS.map(({ tool, icon, limitations }) => (
                            <div key={tool} className="card-surface rounded-2xl p-8">
                                <div className="flex items-center gap-3 mb-5">
                                    <span className="text-2xl">{icon}</span>
                                    <h3 className="font-bold text-base">{tool}</h3>
                                    <span className="ml-auto text-xs text-muted-foreground bg-card px-2 py-1 rounded border border-border">Limitations</span>
                                </div>
                                <ul className="space-y-3">
                                    {limitations.map((item) => (
                                        <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
                                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                    <p className="text-center text-sm text-muted-foreground max-w-2xl mx-auto">
                        These tools are the right choice for scheduled, full-site crawls by technical SEO specialists. But when you need to check a single page right now — before a client call, after a deployment, or to diagnose a traffic drop — a browser-based free SEO audit tool gets the job done in a fraction of the time.
                    </p>
                </div>
            </section>

            {/* ── 7. Comparison table ──────────────────────────────────────────────── */}
            <section className="py-20">
                <div className="max-w-4xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-4">
                        OptiAISEO vs Screaming Frog vs Sitebulb — feature comparison
                    </h2>
                    <p className="text-muted-foreground text-center max-w-xl mx-auto mb-10 text-sm">
                        All three check technical SEO issues. Here&apos;s what makes them different.
                    </p>
                    <div className="overflow-x-auto rounded-2xl border border-border">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-card border-b border-border">
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Feature</th>
                                    <th className="text-left px-6 py-4 font-bold text-[color:var(--brand)]">OptiAISEO (free)</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Screaming Frog</th>
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Sitebulb</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON.map(({ feature, us, sfrog, sitebulb }, i) => (
                                    <tr key={feature} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-card/30'}`}>
                                        <td className="px-6 py-4 text-muted-foreground font-medium">{feature}</td>
                                        <td className="px-6 py-4 text-emerald-500 font-semibold">{us}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{sfrog}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{sitebulb}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-muted-foreground text-center mt-4">
                        Pricing correct as of 2026. Screaming Frog caps its free version at 500 URLs.
                    </p>
                </div>
            </section>

            {/* ── 8. Who it's for ──────────────────────────────────────────────────── */}
            <section className="border-t border-border bg-muted/20 py-20">
                <div className="max-w-5xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
                        Who uses this free SEO audit tool
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
                </div>
            </section>

            {/* ── 9. FAQ ───────────────────────────────────────────────────────────── */}
            <section className="border-t border-border py-20">
                <div className="max-w-3xl mx-auto px-6">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-10">
                        Free SEO audit tool — frequently asked questions
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

            {/* ── 10. CTA banner ───────────────────────────────────────────────────── */}
            <section className="bg-zinc-950 text-white py-20">
                <div className="max-w-3xl mx-auto px-6 text-center">
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
                        Ready to fix issues, not just find them?
                    </h2>
                    <p className="text-white/65 mb-8 max-w-xl mx-auto text-sm leading-relaxed">
                        The free SEO audit shows you what&apos;s broken. OptiAISEO Pro fixes it — automatically opening GitHub PRs with the exact code change, tracking your AI visibility, and generating content that ranks.
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

            {/* ── 11. Internal links ───────────────────────────────────────────────── */}
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