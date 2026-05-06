import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/marketing/SiteFooter";
import { TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import {
    getNicheLeaderboard,
    NICHES,
    NICHE_META,
    type Niche,
    type LeaderboardEntry,
} from "@/lib/leaderboard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");

export function generateStaticParams() {
    return NICHES.map((niche) => ({ niche }));
}

export async function generateMetadata({ params }: { params: Promise<{ niche: string }> }): Promise<Metadata> {
    const { niche } = await params;
    if (!NICHES.includes(niche as Niche)) return {};
    const meta = NICHE_META[niche as Niche];
    const year = new Date().getFullYear();
    return {
        title: `Top AI-Visible ${meta.label} ${year} — AI Visibility Leaderboard`,
        description: `Which ${meta.label} are most cited by ChatGPT, Perplexity, and Google AI? Weekly-updated ranking of the most AI-visible ${meta.description.toLowerCase()}.`,
        alternates: { canonical: `${SITE_URL}/leaderboard/${niche}` },
        openGraph: {
            title: `Most AI-Visible ${meta.label} in ${year}`,
            description: `Weekly ranking of ${meta.label} by Generative Share of Voice — how often each site appears in ChatGPT, Perplexity, and Google AI answers.`,
            type: "article",
            images: [{ url: "/og-image.png", width: 1200, height: 630 }],
        },
    };
}

const GRADE_CONFIG: Record<string, { text: string; bg: string; border: string }> = {
    A: { text: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    B: { text: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
    C: { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20" },
    D: { text: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20" },
    F: { text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20" },
};

function GradeBadge({ grade }: { grade: string }) {
    const c = GRADE_CONFIG[grade] ?? GRADE_CONFIG.C;
    return (
        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
            {grade}
        </span>
    );
}

function ChangeChip({ change }: { change: number | null }) {
    if (change === null) return <span className="text-xs text-muted-foreground">new</span>;
    if (change === 0) return <Minus className="w-3 h-3 text-muted-foreground" />;
    if (change > 0) return (
        <span className="flex items-center gap-0.5 text-xs font-bold text-emerald-500">
            <TrendingUp className="w-3 h-3" /> +{change}
        </span>
    );
    return (
        <span className="flex items-center gap-0.5 text-xs font-bold text-red-400">
            <TrendingDown className="w-3 h-3" /> {change}
        </span>
    );
}

function ScoreBar({ value, color = "bg-brand" }: { value: number; color?: string }) {
    return (
        <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
            </div>
            <span className="text-xs text-muted-foreground w-6 text-right">{value}</span>
        </div>
    );
}

function EntryRow({ entry, showExpanded }: { entry: LeaderboardEntry; showExpanded: boolean }) {
    const rankColors = ["text-amber-400", "text-slate-400", "text-amber-600"];
    const isTopThree = entry.rank <= 3;
    return (
        <div className={`group flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border transition-colors hover:border-border/80 ${isTopThree ? "border-border bg-card/60" : "border-border/50 bg-card/20"}`}>
            <div className="flex items-center gap-3 sm:w-12">
                <span className={`text-lg font-black w-8 text-center ${isTopThree ? rankColors[entry.rank - 1] : "text-muted-foreground"}`}>
                    {entry.rank}
                </span>
                {entry.isNew && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">new</span>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <a
                        href={`https://${entry.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-brand transition-colors truncate"
                    >
                        {entry.domain}
                    </a>
                    <GradeBadge grade={entry.grade} />
                    <ChangeChip change={entry.weeklyChange} />
                </div>
                {showExpanded && (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Perplexity</p>
                            <ScoreBar value={entry.perplexityScore} color="bg-blue-400" />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted-foreground mb-1">ChatGPT</p>
                            <ScoreBar value={entry.chatgptScore} color="bg-emerald-400" />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Claude</p>
                            <ScoreBar value={entry.claudeScore} color="bg-amber-400" />
                        </div>
                        <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Google AIO</p>
                            <ScoreBar value={entry.googleAioScore} color="bg-red-400" />
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">gSOV</p>
                    <p className="text-sm font-bold">{entry.generativeShareOfVoice}%</p>
                </div>
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">AEO score</p>
                    <p className="text-lg font-black">{entry.aeoScore}</p>
                </div>
            </div>
        </div>
    );
}

export default async function NicheLeaderboardPage({ params }: { params: Promise<{ niche: string }> }) {
    const { niche } = await params;
    if (!NICHES.includes(niche as Niche)) notFound();

    const lb   = await getNicheLeaderboard(niche as Niche);
    const meta = NICHE_META[niche as Niche];
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

            <main className="flex-1 max-w-4xl mx-auto px-6 py-20 w-full">
                <nav aria-label="Breadcrumb" className="mb-10">
                    <ol className="flex items-center gap-2 text-xs text-muted-foreground">
                        <li><Link href="/" className="hover:text-foreground">Home</Link></li>
                        <li aria-hidden>/</li>
                        <li><Link href="/leaderboard" className="hover:text-foreground">Leaderboard</Link></li>
                        <li aria-hidden>/</li>
                        <li>{meta.label}</li>
                    </ol>
                </nav>

                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand/25 bg-brand/10 mb-4">
                        <span className="text-xs font-semibold text-brand uppercase tracking-wider">{month} {year} · updated weekly</span>
                    </div>
                    <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
                        Most AI-Visible {meta.label} in {year}
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
                        Ranked by <strong>Generative Share of Voice</strong> — how often each site is cited when users ask
                        ChatGPT, Perplexity, Claude, or Google AI questions about {meta.description.toLowerCase()}.
                    </p>
                    {lb && (
                        <div className="flex flex-wrap gap-5 mt-6 text-sm">
                            <span className="text-muted-foreground">
                                <strong className="text-foreground">{lb.totalSitesTracked.toLocaleString()}</strong> sites tracked
                            </span>
                            <span className="text-muted-foreground">
                                Industry median: <strong className="text-foreground">{lb.medianAeoScore}</strong> AEO score
                            </span>
                            <span className="text-muted-foreground">
                                <strong className="text-foreground">#1</strong> score: {lb.entries[0]?.aeoScore ?? "—"}
                            </span>
                        </div>
                    )}
                </div>

                {lb && (
                    <script
                        type="application/ld+json"
                        dangerouslySetInnerHTML={{
                            __html: JSON.stringify({
                                "@context": "https://schema.org",
                                "@type": "ItemList",
                                "name": `Most AI-Visible ${meta.label} — ${month} ${year}`,
                                "description": `Top ${meta.label} ranked by Generative Share of Voice in ChatGPT, Perplexity, and Google AI Overview.`,
                                "numberOfItems": lb.entries.length,
                                "itemListElement": lb.entries.map((e) => ({
                                    "@type": "ListItem",
                                    "position": e.rank,
                                    "item": {
                                        "@type": "WebSite",
                                        "name": e.domain,
                                        "url": `https://${e.domain}`,
                                        "additionalProperty": [
                                            {
                                                "@type": "PropertyValue",
                                                "name": "AEO Score",
                                                "value": e.aeoScore,
                                            },
                                            {
                                                "@type": "PropertyValue",
                                                "name": "Generative Share of Voice",
                                                "value": `${e.generativeShareOfVoice}%`,
                                            },
                                            {
                                                "@type": "PropertyValue",
                                                "name": "AI Visibility Grade",
                                                "value": e.grade,
                                            },
                                        ],
                                    },
                                })),
                            }),
                        }}
                    />
                )}

                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "Dataset",
                            "name": `Most AI-Visible ${meta.label} — ${month} ${year}`,
                            "description": `Rankings of ${meta.label} by generative share of voice across ChatGPT, Perplexity, and Google AI Overviews.`,
                            "url": `${SITE_URL}/leaderboard/${niche}`,
                            "license": "https://creativecommons.org/licenses/by/4.0/",
                            "creator": { "@type": "Organization", "name": "OptiAISEO", "url": SITE_URL },
                            "temporalCoverage": year.toString(),
                            "keywords": ["AI SEO", "GSoV", "generative AI", "AEO", meta.label],
                        }),
                    }}
                />

                {/* BreadcrumbList schema — 3-level trail: Home → Leaderboard → Niche */}
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify({
                            "@context": "https://schema.org",
                            "@type": "BreadcrumbList",
                            "itemListElement": [
                                { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
                                { "@type": "ListItem", "position": 2, "name": "AI Visibility Leaderboard", "item": `${SITE_URL}/leaderboard` },
                                { "@type": "ListItem", "position": 3, "name": meta.label, "item": `${SITE_URL}/leaderboard/${niche}` },
                            ],
                        }),
                    }}
                />

                {lb && lb.entries.length > 0 ? (
                    <section aria-labelledby="rankings-heading" className="mb-16">
                        <div className="flex items-center justify-between mb-4">
                            <h2 id="rankings-heading" className="text-lg font-bold">
                                Top {lb.entries.length} — {meta.label}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                                Last updated {new Date(lb.lastUpdated).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                        </div>
                        <div className="hidden sm:flex items-center gap-3 px-4 mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            <div className="w-12">Rank</div>
                            <div className="flex-1">Website</div>
                            <div className="w-16 text-center">gSOV</div>
                            <div className="w-20 text-center">AEO score</div>
                        </div>
                        <div className="space-y-2">
                            {lb.entries.map((entry, i) => (
                                <EntryRow key={entry.domain} entry={entry} showExpanded={i === 0} />
                            ))}
                        </div>
                    </section>
                ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-12 text-center mb-16">
                        <p className="font-medium mb-2">No rankings available yet</p>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                            We need more verified {meta.label} with AI visibility data to publish this leaderboard. Be among the first.
                        </p>
                    </div>
                )}

                <section className="mb-16 max-w-2xl">
                    <h2 className="text-xl font-bold mb-3">AI Visibility for {meta.label}</h2>
                    <p className="text-muted-foreground leading-relaxed mb-3">
                        In {year}, AI engines are answering more questions about {meta.description.toLowerCase()}. When a user
                        asks ChatGPT "what is the best {meta.label.toLowerCase()} for X?" or Perplexity summarises options in
                        your category, the sites at the top of this leaderboard are the ones being cited.
                    </p>
                    <p className="text-muted-foreground leading-relaxed">
                        The <strong>Generative Share of Voice (gSOV)</strong> score measures what percentage of relevant AI
                        queries include a citation to that site. A score of 70 means the site appears in 7 out of 10 relevant
                        AI answers. Scores are verified against live ChatGPT, Perplexity, Claude, and Google AIO queries.
                    </p>
                </section>

                <section className="mb-16">
                    <h2 className="text-lg font-bold mb-4">Other industry leaderboards</h2>
                    <div className="flex flex-wrap gap-2">
                        {NICHES.filter((n) => n !== niche).map((n) => (
                            <Link
                                key={n}
                                href={`/leaderboard/${n}`}
                                className="text-sm font-medium px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors"
                            >
                                {NICHE_META[n].label} →
                            </Link>
                        ))}
                    </div>
                </section>

                <section className="bg-foreground text-background rounded-3xl p-12 text-center">
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">Where does your site rank?</h2>
                    <p className="text-lg text-background/70 mb-8 max-w-xl mx-auto">
                        Find out if you appear on this leaderboard — and what it would take to reach the top 10.
                        Free AI visibility score, no credit card required.
                    </p>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 bg-brand text-white font-bold px-8 py-4 rounded-full hover:opacity-90 transition-all active:scale-95 text-base"
                    >
                        <Zap className="w-5 h-5" /> Check your AI visibility score free
                    </Link>
                </section>
            </main>
            <SiteFooter />
        </div>
    );
}
