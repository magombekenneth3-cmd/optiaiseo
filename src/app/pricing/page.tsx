import type { Metadata } from "next";
import SiteFooter from "@/components/marketing/SiteFooter";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Plus } from "lucide-react";
import PricingClient from "./PricingClient";

export const metadata: Metadata = {
  title: "OptiAISEO Pricing — Start Free, Scale as You Grow",
  description: "Start free and scale as you grow. OptiAISEO plans for solo founders, agencies, and SaaS teams. No hidden fees. Cancel anytime.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "OptiAISEO Pricing — Start Free, Scale as You Grow",
    description: "Start free and scale as you grow. OptiAISEO plans for solo founders, agencies, and SaaS teams. No hidden fees. Cancel anytime.",
    url: "/pricing",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OptiAISEO Pricing — Start Free, Scale as You Grow",
    description: "Start free and scale as you grow. OptiAISEO plans for solo founders, agencies, and SaaS teams. No hidden fees. Cancel anytime.",
    images: ["/og-image.png"],
  },
};


const PLANS = [
    {
        name: "Free",
        slug: "free",
        price: { monthly: 0, annual: 0 },
        credits: 50,
        desc: "Explore the platform with no commitment. No credit card needed.",
        features: [
            "50 credits / month",
            "1 website",
            "5 audits / month",
            "3 AI blog posts / month",
            "5 AEO checks / month",
            "Google Search Console",
            "Basic AI visibility check",
        ],
        cta: "Start for free",
        ctaHref: "/signup",
        highlight: false,
        badge: null as string | null,
    },
    {
        name: "Starter",
        slug: "starter",
        price: { monthly: 19, annual: 15 },
        credits: 150,
        desc: "For solo creators and small sites ready to grow in AI search.",
        features: [
            "150 credits / month",
            "3 websites",
            "15 audits / month",
            "30 AI blog posts / month",
            "10 AEO checks / month",
            "Google Search Console",
            "Ubersuggest keyword data",
            "On-page optimisation",
            "Rank tracking",
            "Competitor tracking (2 per site)",
        ],
        cta: "Start Starter trial",
        ctaHref: "/signup?plan=starter",
        highlight: false,
        badge: "New" as string | null,
    },
    {
        name: "Pro",
        slug: "pro",
        price: { monthly: 49, annual: 39 },
        credits: 500,
        desc: "Full automation for growing teams who want to win in AI search.",
        features: [
            "500 credits / month",
            "10 websites",
            "30 audits / month",
            "Unlimited AI blog posts",
            "50 AEO checks / month",
            "Everything in Starter",
            "Ahrefs backlink data",
            "GitHub auto-fix PRs",
            "GSoV tracking across 4 AI engines",
            "Competitor gap analysis",
            "Client portal",
            "Developer API",
            "Aria voice agent",
        ],
        cta: "Start Pro trial — connect your site free",
        ctaHref: "/signup?plan=pro",
        highlight: true,
        badge: "Most popular" as string | null,
    },
    {
        name: "Agency",
        slug: "agency",
        price: { monthly: 149, annual: 119 },
        credits: 2000,
        desc: "For agencies managing multiple clients at scale.",
        features: [
            "2,000 credits / month",
            "Unlimited websites",
            "300 audits / month",
            "Unlimited AI blog posts",
            "100 AEO checks / month",
            "Everything in Pro",
            "White-label PDF exports",
            "Priority support",
            "Client portal",
            "Developer API",
        ],
        cta: "Start Agency trial",
        ctaHref: "/signup?plan=agency",
        highlight: false,
        badge: "Agencies" as string | null,
    },
] as const;

const FEATURE_ROWS = [
    { label: "Monthly credits",        free: "50",        starter: "150",       pro: "500",        agency: "2,000" },
    { label: "Websites",               free: "1",         starter: "3",         pro: "10",         agency: "Unlimited" },
    { label: "Audits / month",         free: "5",         starter: "15",        pro: "30",         agency: "300" },
    { label: "AI blog posts / month",  free: "3",         starter: "30",        pro: "Unlimited",  agency: "Unlimited" },
    { label: "AEO checks / month",     free: "5",         starter: "10",        pro: "50",         agency: "100" },
    { label: "Keyword tracking",       free: "10",        starter: "100",       pro: "500",        agency: "Unlimited" },
    { label: "Competitors per site",   free: false,       starter: "2",         pro: "5",          agency: "Unlimited" },
    { label: "Google Search Console",  free: true,        starter: true,        pro: true,         agency: true },
    { label: "Ubersuggest data",       free: false,       starter: true,        pro: true,         agency: true },
    { label: "On-page optimisation",   free: false,       starter: true,        pro: true,         agency: true },
    { label: "Rank tracking",          free: false,       starter: true,        pro: true,         agency: true },
    { label: "Ahrefs backlinks",       free: false,       starter: false,       pro: true,         agency: true },
    { label: "GitHub auto-fix PRs",    free: false,       starter: false,       pro: true,         agency: true },
    { label: "GSoV (4 AI engines)",    free: false,       starter: false,       pro: true,         agency: true },
    { label: "Aria voice agent",       free: false,       starter: false,       pro: true,         agency: true },
    { label: "Client portal",          free: false,       starter: false,       pro: true,         agency: true },
    { label: "Developer API",          free: false,       starter: false,       pro: true,         agency: true },
    { label: "White-label exports",    free: false,       starter: false,       pro: false,        agency: true },
    { label: "Priority support",       free: false,       starter: false,       pro: false,        agency: true },
] as const;

const FAQS = [
    {
        q: "What are credits and how do they work?",
        a: "Credits are consumed when you run compute-heavy actions: a full site audit costs 10 credits, an AEO check costs 5, blog generation costs 15, and competitor analysis costs 8. Quick SEO checks are always free. Credits reset on your billing date each month.",
    },
    {
        q: "Can I buy extra credits if I run out?",
        a: "Yes. Credit packs ($9 for 50 credits) can be purchased any time from your billing dashboard. They stack on top of your monthly allotment and never expire.",
    },
    {
        q: "Will my existing Pro or Agency price change?",
        a: "No. Existing subscribers are grandfathered on their current price. The new $49 Pro and $149 Agency prices apply only to new subscriptions.",
    },
    {
        q: "Is there a free trial on paid plans?",
        a: "Yes — all paid plans include a 7-day free trial. You can connect your site and run real audits before your card is charged.",
    },
    {
        q: "Can I switch plans at any time?",
        a: "Absolutely. Upgrades take effect immediately and are prorated. Downgrades take effect at the end of your current billing period.",
    },
    {
        q: "What happens to my data if I cancel?",
        a: "Your data is retained for 30 days after cancellation so you can export it. After that it is permanently deleted.",
    },
];

const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
    })),
};

export default function PublicPricingPage() {
    return (
        <div className="min-h-screen bg-background flex flex-col">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />

            <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
                            <span className="font-black text-background text-[11px] tracking-tight">Opti</span>
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                        </div>
                    </Link>
                    <div className="flex items-center gap-4">
                        <Link href="/free/seo-checker" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">Free tools</Link>
                        <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">Log in</Link>
                        <Link href="/signup" className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90">Get started free</Link>
                    </div>
                </div>
            </nav>

            <main className="flex-1 w-full">
                <section className="max-w-7xl mx-auto px-6 pt-24 pb-6 text-center">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6">
                        Simple, transparent SEO tool pricing
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
                        Start free with 5 SEO audits per month. Upgrade only when you need more automation, sites, or scale.
                    </p>
                </section>

                {/* ── Competitive context ──────────────────────────────────────────── */}
                <section className="max-w-4xl mx-auto px-6 pb-8">
                    <div className="card-surface rounded-2xl p-6 border-l-4 border-[#10b981]">
                        <p className="text-xs font-bold uppercase tracking-widest text-[#10b981] mb-4">Why teams switch to OptiAISEO</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="text-left pb-3 font-semibold text-muted-foreground">Tool</th>
                                        <th className="text-left pb-3 font-semibold text-muted-foreground">Entry price</th>
                                        <th className="text-left pb-3 font-semibold text-muted-foreground">Fixes issues automatically?</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {[
                                        { tool: "Ahrefs Standard",        price: "$249/month",      fixes: "✗ Identifies only" },
                                        { tool: "Semrush Guru",           price: "$249.95/month",   fixes: "✗ Identifies only" },
                                        { tool: "SEO Site Checkup Pro",   price: "$109/month",      fixes: "✗ Monitors only" },
                                        { tool: "Surfer SEO",             price: "$99/month",       fixes: "✗ Grades only" },
                                        { tool: "OptiAISEO Pro",          price: "$49/month",       fixes: "✓ Identifies AND fixes" },
                                    ].map(({ tool, price, fixes }) => (
                                        <tr key={tool} className={tool.startsWith("OptiAISEO") ? "font-semibold" : ""}>
                                            <td className={`py-2.5 ${tool.startsWith("OptiAISEO") ? "text-[#10b981]" : "text-muted-foreground"}`}>{tool}</td>
                                            <td className={`py-2.5 ${tool.startsWith("OptiAISEO") ? "text-[#10b981]" : "text-muted-foreground"}`}>{price}</td>
                                            <td className={`py-2.5 ${fixes.startsWith("✓") ? "text-emerald-500" : "text-rose-400"}`}>{fixes}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-muted-foreground mt-4">The only tool in this list that writes and publishes the fix — not just the report.</p>
                    </div>
                </section>

                <PricingClient plans={PLANS} featureRows={[...FEATURE_ROWS]} faqs={FAQS} />

                {/* ── What credits actually buy you ────────────────────────────────── */}
                <section className="max-w-5xl mx-auto px-6 py-16">
                    <div className="text-center mb-10">
                        <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">What does that actually get you?</h2>
                        <p className="text-muted-foreground max-w-xl mx-auto text-sm">
                            Credits are used for compute-heavy actions. Here&apos;s what each plan delivers in plain English.
                        </p>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-border">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="bg-card border-b border-border">
                                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">What you want to do</th>
                                    <th className="text-center px-4 py-4 font-semibold text-muted-foreground">Free</th>
                                    <th className="text-center px-4 py-4 font-semibold text-muted-foreground">Starter</th>
                                    <th className="text-center px-4 py-4 font-bold">Pro</th>
                                    <th className="text-center px-4 py-4 font-semibold text-muted-foreground">Agency</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { action: "Run a full site audit",          cost: 10, free: 50, starter: 150, pro: 500, agency: 2000 },
                                    { action: "Check AI citation score (AEO)",  cost: 5,  free: 50, starter: 150, pro: 500, agency: 2000 },
                                    { action: "Generate a blog post",           cost: 15, free: 50, starter: 150, pro: 500, agency: 2000 },
                                    { action: "Analyse a competitor",           cost: 8,  free: 50, starter: 150, pro: 500, agency: 2000 },
                                    { action: "Open a GitHub fix PR",           cost: 3,  free: 50, starter: 150, pro: 500, agency: 2000 },
                                ].map(({ action, cost, free, starter, pro, agency }, i) => (
                                    <tr key={action} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-card/30"}`}>
                                        <td className="px-6 py-4 font-medium">
                                            {action}
                                            <span className="ml-2 text-xs text-muted-foreground font-normal">({cost} credits)</span>
                                        </td>
                                        <td className="px-4 py-4 text-center text-muted-foreground">{Math.floor(free / cost)}×/mo</td>
                                        <td className="px-4 py-4 text-center text-muted-foreground">{Math.floor(starter / cost)}×/mo</td>
                                        <td className="px-4 py-4 text-center font-semibold text-[#10b981]">
                                            {cost === 15 ? "Unlimited" : `${Math.floor(pro / cost)}×/mo`}
                                        </td>
                                        <td className="px-4 py-4 text-center text-muted-foreground">
                                            {cost <= 5 ? "Unlimited" : `${Math.floor(agency / cost)}×/mo`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-center text-xs text-muted-foreground mt-4">
                        Pro plan has unlimited AI blog posts regardless of credit count. Quick SEO checks are always free and never use credits.
                    </p>
                </section>

                <section className="border-y border-border bg-muted/30">
                    <div className="max-w-7xl mx-auto px-6 py-16 flex flex-col md:flex-row items-center justify-between gap-8">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                                <Plus className="w-5 h-5 text-brand" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold mb-1">Need extra credits?</h2>
                                <p className="text-muted-foreground text-sm max-w-lg">
                                    Credit packs top up your balance instantly — no plan change needed. Perfect for
                                    one-off campaigns or busy months. Credits stack on top of your monthly allotment
                                    and never expire.
                                </p>
                            </div>
                        </div>
                        <div className="shrink-0 card-surface ring-1 ring-border p-6 rounded-2xl flex flex-col items-center gap-3 min-w-[200px]">
                            <span className="text-3xl font-black">$9</span>
                            <span className="text-sm text-muted-foreground font-medium">50 credits · one-time</span>
                            <Link
                                href="/dashboard/billing?action=buy-credits"
                                className="w-full py-2 rounded-xl border border-border hover:bg-accent font-semibold text-sm text-center transition-all"
                            >
                                Buy credit pack
                            </Link>
                        </div>
                    </div>
                </section>

                <div className="flex flex-wrap items-center justify-center gap-6 py-6 text-sm text-muted-foreground">
                    {["No credit card to start", "Cancel anytime", "7-day trial on all paid plans", "Data stays yours"].map((item) => (
                        <span key={item} className="flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-brand" />
                            {item}
                        </span>
                    ))}
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
