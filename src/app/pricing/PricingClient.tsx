"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Zap, Plus, ArrowRight } from "lucide-react";

type Plan = {
    name: string;
    slug: string;
    price: { monthly: number; annual: number };
    credits: number;
    desc: string;
    features: readonly string[];
    cta: string;
    ctaHref: string;
    highlight: boolean;
    badge: string | null;
};

type FeatureRow = {
    label: string;
    free: string | boolean;
    starter: string | boolean;
    pro: string | boolean;
    agency: string | boolean;
};

type Faq = { q: string; a: string };

interface PricingClientProps {
    plans: readonly Plan[];
    featureRows: FeatureRow[];
    faqs: Faq[];
}

function CellValue({ value }: { value: string | boolean }) {
    if (value === true)  return <Check className="w-4 h-4 text-brand mx-auto" aria-label="Included" />;
    if (value === false) return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" aria-label="Not included" />;
    return <span className="text-sm font-medium">{value}</span>;
}

export default function PricingClient({ plans, featureRows, faqs }: PricingClientProps) {
    const [billingAnnual, setBillingAnnual] = useState(false);
    const [openFaq, setOpenFaq] = useState<number | null>(null);

    const displayPrice = (plan: Plan) => {
        const p = billingAnnual ? plan.price.annual : plan.price.monthly;
        return p === 0 ? "$0" : `${p}`;
    };

    return (
        <>
            {/* Billing toggle */}
            <div className="flex items-center justify-center gap-3 mb-10">
                <span className={`text-sm font-medium transition-colors ${!billingAnnual ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
                <button
                    role="switch"
                    aria-checked={billingAnnual}
                    onClick={() => setBillingAnnual((v) => !v)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring ${billingAnnual ? "bg-brand" : "bg-muted"}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${billingAnnual ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${billingAnnual ? "text-foreground" : "text-muted-foreground"}`}>
                    Annual
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">Save 20%</span>
                </span>
            </div>

            {/* Plan cards */}
            <section className="max-w-7xl mx-auto px-6 pb-24">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`card-surface p-7 flex flex-col relative overflow-hidden hover:-translate-y-1 transition-transform duration-300 ${
                                plan.highlight ? "ring-2 ring-foreground/20" : "ring-1 ring-border"
                            }`}
                        >
                            {plan.badge && (
                                <div className={`absolute top-0 right-0 px-3 py-1 text-[11px] font-bold rounded-bl-lg ${
                                    plan.highlight
                                        ? "bg-foreground text-background"
                                        : "bg-card text-muted-foreground border-l border-b border-border"
                                }`}>
                                    {plan.badge.toUpperCase()}
                                </div>
                            )}

                            <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                            <p className="text-muted-foreground text-xs mb-5 leading-relaxed">{plan.desc}</p>

                            <div className="mb-1">
                                <span className="text-4xl font-black">{displayPrice(plan)}</span>
                                {plan.price.monthly > 0 && (
                                    <span className="text-muted-foreground text-sm"> /mo</span>
                                )}
                            </div>

                            {billingAnnual && plan.price.monthly > 0 ? (
                                <p className="text-[11px] text-brand font-semibold mb-5">Billed annually — 2 months free</p>
                            ) : (
                                <div className="mb-5" />
                            )}

                            <div className="flex items-center gap-1.5 mb-5 text-xs text-muted-foreground">
                                <Zap className="w-3.5 h-3.5 text-brand shrink-0" />
                                <span><strong className="text-foreground">{plan.credits.toLocaleString()}</strong> credits / month</span>
                            </div>

                            <ul className="flex-1 space-y-2.5 mb-7">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2.5">
                                        <Check className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                                        <span className="text-xs leading-relaxed">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <Link
                                href={billingAnnual && plan.price.monthly > 0
                                    ? (plan.ctaHref.includes('?') ? `${plan.ctaHref}&billing=annual` : `${plan.ctaHref}?billing=annual`)
                                    : plan.ctaHref}
                                className={`w-full py-2.5 rounded-xl font-semibold transition-all flex items-center justify-center text-sm ${
                                    plan.highlight
                                        ? "bg-foreground text-background hover:opacity-90"
                                        : "border border-border hover:bg-accent"
                                }`}
                            >
                                {plan.cta}
                            </Link>
                        </div>
                    ))}
                </div>
            </section>

            {/* Feature comparison */}
            <section className="max-w-7xl mx-auto px-6 py-24">
                <h2 className="text-3xl font-black tracking-tight text-center mb-12">Full feature comparison</h2>
                <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted/40">
                                <th className="text-left px-5 py-4 font-semibold text-muted-foreground w-1/3">Feature</th>
                                {plans.map((p) => (
                                    <th key={p.name} className={`px-4 py-4 font-bold text-center ${p.highlight ? "text-foreground" : "text-muted-foreground"}`}>
                                        {p.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {featureRows.map((row, i) => (
                                <tr key={row.label} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                                    <td className="px-5 py-3 text-muted-foreground">{row.label}</td>
                                    <td className="px-4 py-3 text-center"><CellValue value={row.free} /></td>
                                    <td className="px-4 py-3 text-center"><CellValue value={row.starter} /></td>
                                    <td className="px-4 py-3 text-center"><CellValue value={row.pro} /></td>
                                    <td className="px-4 py-3 text-center"><CellValue value={row.agency} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* FAQ accordion */}
            <section className="border-t border-border bg-muted/20">
                <div className="max-w-3xl mx-auto px-6 py-24">
                    <h2 className="text-3xl font-black tracking-tight text-center mb-12">Frequently asked questions</h2>
                    <div className="space-y-3">
                        {faqs.map((faq, i) => (
                            <div key={i} className="card-surface ring-1 ring-border rounded-xl overflow-hidden">
                                <button
                                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                                    className="w-full text-left px-6 py-4 font-semibold text-sm flex items-center justify-between gap-4 hover:bg-accent/50 transition-colors"
                                    aria-expanded={openFaq === i}
                                >
                                    {faq.q}
                                    <span className={`text-muted-foreground transition-transform duration-200 shrink-0 ${openFaq === i ? "rotate-45" : ""}`}>
                                        <Plus className="w-4 h-4" />
                                    </span>
                                </button>
                                {openFaq === i && (
                                    <div className="px-6 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">
                                        {faq.a}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Bottom CTA — rendered client-side alongside toggle */}
            <section className="max-w-7xl mx-auto px-6 py-24 text-center">
                <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-6">
                    Ready to rank in AI search?
                </h2>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
                    Join thousands of sites already using OptiAISEO to win citations in ChatGPT, Perplexity, and Google AI Overviews.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-4">
                    <Link href="/signup" className="px-8 py-3.5 rounded-full bg-foreground text-background font-bold hover:opacity-90 transition-opacity">
                        Start for free
                    </Link>
                    <Link href="/signup?plan=pro" className="px-8 py-3.5 rounded-full border border-border font-bold hover:bg-accent transition-colors">
                        Start Pro trial
                    </Link>
                </div>
            </section>

            {/* Competitor compare strip */}
            <section className="border-t border-border">
                <div className="max-w-7xl mx-auto px-6 py-16 text-center">
                    <p className="text-sm font-semibold text-muted-foreground mb-2">Switching from a competitor?</p>
                    <p className="text-sm text-muted-foreground mb-6 max-w-lg mx-auto">
                        See how OptiAISEO compares on price, AI visibility, and automation:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        {([
                            { slug: "semrush", name: "Semrush" },
                            { slug: "ahrefs", name: "Ahrefs" },
                            { slug: "surfer-seo", name: "Surfer SEO" },
                            { slug: "moz", name: "Moz" },
                            { slug: "clearscope", name: "Clearscope" },
                            { slug: "mangools", name: "Mangools" },
                            { slug: "screaming-frog", name: "Screaming Frog" },
                            { slug: "yoast", name: "Yoast SEO" },
                        ] as const).map(({ slug, name }) => (
                            <Link
                                key={slug}
                                href={`/vs/${slug}`}
                                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors"
                            >
                                vs {name} <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
}
