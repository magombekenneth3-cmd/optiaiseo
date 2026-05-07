import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { getLeaderboardIndex } from "@/lib/leaderboard";
import type { Niche } from "@/lib/leaderboard";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
    title: `AI Visibility Leaderboard ${new Date().getFullYear()} — Most AI-Cited Websites by Industry`,
    description:
        "Which websites appear most often when ChatGPT, Perplexity, and Google AI answer questions? The OptiAISEO AI Visibility Leaderboard ranks sites by generative share of voice across all major AI engines.",
    alternates: { canonical: `${SITE_URL}/leaderboard` },
    openGraph: {
        title: "AI Visibility Leaderboard — Most AI-Cited Websites by Industry",
        description: "See which websites dominate AI search results in your industry. Updated weekly from live ChatGPT, Perplexity, and Google AIO data.",
        type: "website",
        images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
};

const GRADE_COLOR: Record<string, string> = {
    A: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    B: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    C: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    D: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    F: "text-red-400 bg-red-500/10 border-red-500/20",
};

const NICHE_ICONS: Record<Niche, string> = {
    saas:      "⚙️",
    ecommerce: "🛍️",
    local:     "📍",
    agency:    "🎯",
    blog:      "✍️",
    other:     "🌐",
};

export default async function LeaderboardIndexPage() {
    const index = await getLeaderboardIndex();
    const year  = new Date().getFullYear();
    const month = new Date().toLocaleString("en-US", { month: "long" });

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
                    <div className="flex items-center gap-3">
                        <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">Log in</Link>
                        <Link href="/signup" className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all">
                            Check your score →
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="flex-1 max-w-5xl mx-auto px-6 py-20 w-full">
                <nav aria-label="Breadcrumb" className="mb-10">
                    <ol className="flex items-center gap-2 text-xs text-muted-foreground">
                        <li><Link href="/" className="hover:text-foreground transition-colors">Home</Link></li>
                        <li aria-hidden>/</li>
                        <li>AI Visibility Leaderboard</li>
                    </ol>
                </nav>

                <div className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand/25 bg-brand/10 mb-6">
                        <span className="text-xs font-semibold text-brand uppercase tracking-wider">
                            Updated weekly · {month} {year}
                        </span>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6 leading-tight">
                        AI Visibility Leaderboard
                    </h1>
                    <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        Which websites appear most when ChatGPT, Perplexity, Claude, and Google AI
                        answer questions? Ranked by <strong>Generative Share of Voice</strong> —
                        the metric that matters in the AI search era.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            {index.totalSitesAcrossAllNiches.toLocaleString()}+ sites tracked
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            {index.niches.length} industry categories
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-400" />
                            ChatGPT · Perplexity · Claude · Google AIO
                        </span>
                    </div>
                </div>

                {/* Dataset schema — signals to Google that this is a structured, citable dataset */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "Dataset",
                            "name": `AI Visibility Leaderboard — Most AI-Cited Websites`,
                            "description": "Rankings of websites by generative share of voice across ChatGPT, Perplexity, and Google AI Overviews.",
                            "url": `${SITE_URL}/leaderboard`,
                            "license": "https://creativecommons.org/licenses/by/4.0/",
                            "creator": { "@type": "Organization", "name": "OptiAISEO", "url": SITE_URL },
                            "temporalCoverage": year.toString(),
                            "keywords": ["AI SEO", "GSoV", "generative AI", "AEO", "ChatGPT citations"],
                        }),
                    }}
                />

                {/* ItemList schema — enumerates the niche categories as list entries */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "ItemList",
                            "name": `AI Visibility Leaderboard ${year}`,
                            "description": "Rankings of websites by AI engine citation rate across ChatGPT, Perplexity, Claude, and Google AI Overview.",
                            "numberOfItems": index.niches.length,
                            "itemListElement": index.niches.map((n, i) => ({
                                "@type": "ListItem",
                                "position": i + 1,
                                "name": n.nicheLabel,
                                "url": `${SITE_URL}/leaderboard/${n.niche}`,
                            })),
                        }),
                    }}
                />

                {/* BreadcrumbList schema — mirrors the visual breadcrumb trail */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "BreadcrumbList",
                            "itemListElement": [
                                { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
                                { "@type": "ListItem", "position": 2, "name": "AI Visibility Leaderboard", "item": `${SITE_URL}/leaderboard` },
                            ],
                        }),
                    }}
                />

                {/* FAQPage schema — targets the explainer section for rich-result eligibility */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "FAQPage",
                            "mainEntity": [
                                {
                                    "@type": "Question",
                                    "name": "What is AI Visibility?",
                                    "acceptedAnswer": {
                                        "@type": "Answer",
                                        "text": "AI Visibility measures how often a website is cited or recommended when users ask questions in ChatGPT, Perplexity, Claude, and Google AI Overviews. As AI engines replace traditional search for informational queries, appearing in AI answers is becoming as important as ranking on Google page one.",
                                    },
                                },
                                {
                                    "@type": "Question",
                                    "name": "What is Generative Share of Voice (gSOV)?",
                                    "acceptedAnswer": {
                                        "@type": "Answer",
                                        "text": "Generative Share of Voice (gSOV) is the percentage of relevant AI engine responses that include a reference to a given website. A score of 60 means the site appears in 60% of queries related to its category. Scores are computed weekly from live queries sent to ChatGPT, Perplexity, Claude, and Google AI Overview.",
                                    },
                                },
                                {
                                    "@type": "Question",
                                    "name": "How is the AI Visibility Leaderboard updated?",
                                    "acceptedAnswer": {
                                        "@type": "Answer",
                                        "text": "The leaderboard is updated weekly using live queries sent to each AI engine. Only websites that have connected their Google Search Console to OptiAISEO appear in the ranking, ensuring scores reflect verified domain ownership.",
                                    },
                                },
                                {
                                    "@type": "Question",
                                    "name": "Which AI engines are tracked in the leaderboard?",
                                    "acceptedAnswer": {
                                        "@type": "Answer",
                                        "text": "The leaderboard tracks citation rates across ChatGPT, Perplexity, Claude, and Google AI Overviews (AIO). Each platform is scored individually and combined into an overall AEO score.",
                                    },
                                },
                            ],
                        }),
                    }}
                />

                <section aria-labelledby="categories-heading">
                    <h2 id="categories-heading" className="text-2xl font-bold tracking-tight mb-8">Browse by industry</h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {index.niches.map((n) => {
                            const top = n.topEntry;
                            const gradeClass = top ? (GRADE_COLOR[top.grade] ?? GRADE_COLOR.C) : GRADE_COLOR.C;
                            return (
                                <Link
                                    key={n.niche}
                                    href={`/leaderboard/${n.niche}`}
                                    className="card-surface rounded-2xl p-6 flex flex-col gap-4 hover:-translate-y-1 transition-transform duration-200 group"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-2xl mb-1">{NICHE_ICONS[n.niche as Niche]}</div>
                                            <h3 className="text-lg font-bold">{n.nicheLabel}</h3>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {n.totalSites.toLocaleString()} sites · avg {n.medianScore} AEO
                                            </p>
                                        </div>
                                        <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                                    </div>
                                    {top ? (
                                        <div className="border-t border-border pt-4">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">#1 this week</p>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium truncate">{top.domain}</span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${gradeClass}`}>{top.grade}</span>
                                                    <span className="text-sm font-bold">{top.aeoScore}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="border-t border-border pt-4">
                                            <p className="text-xs text-muted-foreground">No data yet for this category</p>
                                        </div>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-20 mb-16 max-w-3xl">
                    <h2 className="text-2xl font-bold mb-4">What is AI Visibility?</h2>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                        AI Visibility measures how often a website is cited or recommended when users ask questions in ChatGPT,
                        Perplexity, Claude, and Google AI Overviews. As AI engines replace traditional search for informational
                        queries, appearing in AI answers is becoming as important as ranking on Google page one.
                    </p>
                    <p className="text-muted-foreground leading-relaxed mb-4">
                        The <strong>Generative Share of Voice (gSOV)</strong> score shown in this leaderboard represents the
                        percentage of relevant AI engine responses that include a reference to a given website. A score of 60
                        means the site appears in 60% of queries related to its category.
                    </p>
                    <p className="text-muted-foreground leading-relaxed">
                        Scores are computed weekly from live queries sent to each AI engine. Only websites that have connected
                        their Google Search Console to OptiAISEO appear in this ranking — ensuring scores reflect verified domain
                        ownership.
                    </p>
                </section>

                <section className="bg-foreground text-background rounded-3xl p-12 text-center">
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">See where your site ranks</h2>
                    <p className="text-lg text-background/70 mb-8 max-w-xl mx-auto">
                        Check your AI Visibility Score free — no credit card required. Find out if ChatGPT and Perplexity know
                        about your brand, and what it would take to reach the top 10 in your industry.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            href="/signup"
                            className="inline-flex items-center gap-2 bg-brand text-white font-bold px-8 py-4 rounded-full hover:opacity-90 transition-all active:scale-95 text-base"
                        >
                            <Zap className="w-5 h-5" /> Check your score free
                        </Link>
                        <Link
                            href="/free/seo-checker"
                            className="inline-flex items-center gap-2 bg-background/10 border border-background/20 text-white font-semibold px-8 py-4 rounded-full hover:bg-background/20 transition-all text-base"
                        >
                            Free instant audit <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </section>
            </main>
            <SiteFooter />
        </div>
    );
}
