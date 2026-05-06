import { Metadata } from "next";
import { Brain, RefreshCw, Target, BarChart2, AlertCircle, Calendar } from "lucide-react";

const METHODOLOGY_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: "AEO Methodology — How We Measure AI Search Visibility | OptiAISEO",
    description: "Our methodology for measuring AEO (Answer Engine Optimisation) scores: which AI engines we query, query templates, citation detection, accuracy validation, and known limitations.",
    alternates: { canonical: `${METHODOLOGY_SITE_URL}/methodology` },
    openGraph: {
        title: "AEO Methodology — How We Measure AI Search Visibility | OptiAISEO",
        description: "Our methodology for measuring AEO scores: AI engines queried, citation detection, accuracy validation, and known limitations.",
        url: `${METHODOLOGY_SITE_URL}/methodology`,
        siteName: "OptiAISEO",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO AEO Methodology" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "AEO Methodology — How We Measure AI Search Visibility | OptiAISEO",
        description: "Our methodology for measuring AEO scores: AI engines queried, citation detection, and accuracy validation.",
        images: ["/og-image.png"],
    },
};

const METHODOLOGY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "name": "AEO Methodology - How We Measure AI Search Visibility | OptiAISEO",
  "url": "https://www.optiaiseo.online/methodology",
  "description": "Our methodology for measuring AEO scores: AI engines queried, citation detection, and accuracy validation.",
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

export default function MethodologyPage() {
    return (
        <div className="min-h-screen bg-background">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(METHODOLOGY_SCHEMA) }} />
            <section className="py-20 px-4 text-center">
                <div className="max-w-3xl mx-auto">
                    <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-6">
                        <Brain className="w-8 h-8 text-violet-400" />
                    </div>
                    <h1 className="text-4xl font-black text-foreground mb-4">AEO Measurement Methodology</h1>
                    <p className="text-lg text-muted-foreground">
                        How OptiAISEO measures your brand&apos;s AI search visibility — the query templates, engines, scoring, cadence, and known limitations.
                    </p>
                </div>
            </section>

            <div className="max-w-4xl mx-auto px-4 pb-20 space-y-8">
                {/* AI Engines */}
                <section className="card-elevated p-6 space-y-5">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Target className="w-5 h-5 text-brand" /> Which AI Engines We Query</h2>
                    <p className="text-sm text-muted-foreground">OptiAISEO queries six AI engines across three tiers (Quick Scan, Standard, Deep Audit):</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Engine</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Model</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Audit Tier</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Queries / Run</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-foreground/80">
                                {[
                                    { engine: "Google Gemini", model: "gemini-2.0-flash", tier: "All tiers", queries: "5 (Quick), 15 (Standard), 30 (Deep)" },
                                    { engine: "Anthropic Claude", model: "claude-3-5-sonnet-20241022", tier: "Standard + Deep", queries: "10 (Standard), 20 (Deep)" },
                                    { engine: "OpenAI ChatGPT", model: "gpt-4o-mini", tier: "Standard + Deep", queries: "10 (Standard), 20 (Deep)" },
                                    { engine: "Google AI Overview", model: "Serper.dev SERP parse", tier: "Deep only", queries: "10 (Direct SERP)" },
                                    { engine: "Perplexity AI", model: "pplx-7b-online", tier: "Deep only", queries: "5 (Deep)" },
                                    { engine: "Microsoft Copilot (Grok)", model: "grok-2", tier: "Deep only", queries: "5 (Deep) — limited availability" },
                                ].map(row => (
                                    <tr key={row.engine}>
                                        <td className="py-2.5 font-medium">{row.engine}</td>
                                        <td className="py-2.5 font-mono text-xs">{row.model}</td>
                                        <td className="py-2.5">{row.tier}</td>
                                        <td className="py-2.5">{row.queries}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Query Templates */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Brain className="w-5 h-5 text-brand" /> Query Template Categories</h2>
                    <p className="text-sm text-muted-foreground">We use 5 intent categories, each with 3 query templates, run against your domain and primary keywords:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                            { cat: "Brand Authority", desc: "\"What is [brand]?\" \"Tell me about [brand]\" \"Who are [brand]?\"", color: "text-blue-400 bg-blue-500/8 border-blue-500/20" },
                            { cat: "Topic Coverage", desc: "\"What is [primary service]?\" \"How does [product category] work?\" \"Best [industry] tools\"", color: "text-emerald-400 bg-emerald-500/8 border-emerald-500/20" },
                            { cat: "FAQ Readiness", desc: "\"How to [key action]?\" \"What is the price of [service]?\" \"Is [brand] safe/legit?\"", color: "text-amber-400 bg-amber-500/8 border-amber-500/20" },
                            { cat: "Competitor Comparison", desc: "\"[Brand] vs [Competitor]\" \"Alternatives to [competitor]\" \"Best [brand category] for [use case]\"", color: "text-violet-400 bg-violet-500/8 border-violet-500/20" },
                            { cat: "How-To Guidance", desc: "\"How to do [brand's key outcome]?\" \"Step-by-step guide for [service]\" \"Tutorial for [primary feature]\"", color: "text-rose-400 bg-rose-500/8 border-rose-500/20" },
                        ].map(cat => (
                            <div key={cat.cat} className={`p-4 rounded-xl border ${cat.color} text-sm`}>
                                <p className="font-bold mb-1">{cat.cat}</p>
                                <p className="text-xs text-muted-foreground italic">{cat.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Citation Detection */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><BarChart2 className="w-5 h-5 text-brand" /> Citation Detection & Scoring</h2>
                    <div className="space-y-3 text-sm text-foreground/80">
                        <div><strong>Clear citation:</strong> Your brand name, domain, or a 5+ word verbatim match from your site content appears in the AI response. Scored as 1.0 (full citation).</div>
                        <div><strong>Ambiguous mention:</strong> A partial brand match, a generic product category name you share, or an indirect reference. Scored as 0.5 (partial) and flagged for review in the report.</div>
                        <div><strong>Not cited:</strong> No brand reference. Scored as 0. Each non-citation triggers a recommendation in the report.</div>
                        <div><strong>Overall AEO score:</strong> (Σ weighted citation scores / total queries) × 100. Deep audits weight citation quality by engine: Google AI Overview citations count double due to higher search traffic exposure.</div>
                    </div>
                </section>

                {/* Update Cadence */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Calendar className="w-5 h-5 text-brand" /> Score Update Cadence</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Plan</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Auto-Refresh Cadence</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Manual Scans / Month</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-foreground/80">
                                <tr><td className="py-2.5">Free</td><td className="py-2.5">Manual only</td><td className="py-2.5">3</td></tr>
                                <tr><td className="py-2.5">Pro</td><td className="py-2.5">Weekly (Monday 08:00 UTC)</td><td className="py-2.5">20</td></tr>
                                <tr><td className="py-2.5">Agency</td><td className="py-2.5">Weekly (Monday 06:00 UTC)</td><td className="py-2.5">Unlimited</td></tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Accuracy validation */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><RefreshCw className="w-5 h-5 text-brand" /> Accuracy Validation</h2>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                        Quarterly, we run our AEO methodology against <strong>20 known brands</strong> (10 well-cited, 10 intentionally uncited) and publish the error rate in our changelog. Our current false-positive rate (brand incorrectly scored as cited) is <strong>&lt; 4%</strong>. False-negative rate (brand cited but missed by our parser) is <strong>&lt; 7%</strong>.
                    </p>
                    <p className="text-sm text-foreground/80">Last validated: <strong>Q1 2026</strong>. Next scheduled validation: <strong>Q2 2026</strong>.</p>
                </section>

                {/* Known Limitations */}
                <section className="card-elevated p-6 space-y-3">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><AlertCircle className="w-5 h-5 text-amber-400" /> Known Limitations</h2>
                    <ul className="space-y-3 text-sm text-foreground/80">
                        {[
                            { title: "Grok API constraints", detail: "Grok (X/Twitter AI) has limited API availability and rate limits. Results may be missing when Grok API is rate-limited or experiencing downtime. We skip Grok gracefully and note it in the report." },
                            { title: "Model update lag", detail: "When AI models receive significant updates (e.g. a new GPT-4 training cutoff), citation patterns can shift within 24–48 hours. Our scores may temporarily over- or under-state visibility immediately after a major model update." },
                            { title: "RAG and real-time search", detail: "Some AI engines (Perplexity, Gemini with grounding) use real-time web search to augment responses. Scores for these engines reflect current indexed content and may differ from engines using only training data." },
                            { title: "Brand name ambiguity", detail: "Brands with generic names (e.g. 'Pipe', 'Beam') may receive false positives when the brand name appears in AI responses for unrelated reasons. We recommend adding a unique brand phrase in site settings to improve detection accuracy." },
                            { title: "Geolocation bias", detail: "All queries are sent from US-based infrastructure. Brands with primarily local or regional presence may score lower than their actual regional visibility. Country-specific AEO scanning is on our roadmap." },
                        ].map(lim => (
                            <li key={lim.title} className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                                <p className="font-semibold text-amber-300 mb-1">{lim.title}</p>
                                <p className="text-muted-foreground text-xs leading-relaxed">{lim.detail}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}
