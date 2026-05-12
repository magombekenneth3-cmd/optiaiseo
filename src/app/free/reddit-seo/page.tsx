"use client";
/**
 * 6.3 / 8.4: Free Reddit SEO Opportunity Finder
 * Target keyword: "reddit seo strategy tool" / "find reddit seo opportunities"
 * No login required — calls the public /api/free/reddit-opportunities endpoint.
 */
import { useState } from "react";
import Link from "next/link";
import { Search, ExternalLink, TrendingUp, MessageCircle, Users, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import RedditSeoContent from "@/components/seoContext/RedditContent";

interface RedditResult {
    keyword: string;
    threadTitle: string;
    subreddit: string;
    redditUrl: string;
    googlePosition: number;
    estimatedTraffic: number;
    brandMentioned: boolean;
    competitorMentioned: boolean;
}

function PositionBadge({ pos }: { pos: number }) {
    const color = pos <= 3 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
        : pos <= 7 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
            : "text-muted-foreground bg-muted/30 border-border";
    return <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${color}`}>#{pos}</span>;
}

export default function RedditSeoFinderPage() {
    const [keyword, setKeyword] = useState("");
    const [results, setResults] = useState<RedditResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searched, setSearched] = useState(false);

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault();
        if (!keyword.trim()) return;
        setLoading(true);
        setError(null);
        setResults([]);
        setSearched(false);
        try {
            const res = await fetch(`/api/free/reddit-opportunities?keyword=${encodeURIComponent(keyword.trim())}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Search failed");
            setResults(data.opportunities ?? []);
            setSearched(true);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Search failed. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Hero */}
            <section className="py-20 px-4 text-center bg-gradient-to-b from-brand/5 to-transparent">
                <div className="max-w-3xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-bold mb-6">
                        <MessageCircle className="w-3 h-3" /> Free Reddit SEO Tool
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-4">
                        Reddit SEO Opportunity Finder
                    </h1>
                    <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
                        Find Reddit threads ranking on Google&apos;s first page for your target keywords — then join the conversation and get seen.
                    </p>

                    {/* Search box */}
                    <form onSubmit={handleSearch} className="flex gap-2 max-w-lg mx-auto">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <input
                                type="text"
                                value={keyword}
                                onChange={e => setKeyword(e.target.value)}
                                placeholder="e.g. best AI SEO tool"
                                id="reddit-keyword-input"
                                className="w-full pl-10 pr-4 py-3 bg-card border border-border rounded-xl text-sm outline-none focus:border-brand transition-colors"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            id="reddit-search-btn"
                            className="px-5 py-3 bg-brand text-background rounded-xl font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            {loading ? "Searching…" : "Find Threads"}
                        </button>
                    </form>
                </div>
            </section>

            <div className="max-w-4xl mx-auto px-4 pb-20 space-y-6">
                {/* Error */}
                {error && (
                    <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                )}

                {/* Results */}
                {results.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-foreground">
                                {results.length} Reddit threads ranking on Google for <span className="text-brand">&ldquo;{keyword}&rdquo;</span>
                            </h2>
                        </div>
                        {results.map((r, i) => (
                            <div key={i} className="card-elevated p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                                <div className="flex items-center gap-3 shrink-0">
                                    <PositionBadge pos={r.googlePosition} />
                                    <div className="text-center">
                                        <div className="text-lg font-black text-foreground">{r.estimatedTraffic}</div>
                                        <div className="text-[10px] text-muted-foreground">est. visits</div>
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2 flex-wrap">
                                        <a
                                            href={r.redditUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm font-semibold text-foreground hover:text-brand transition-colors flex items-center gap-1.5"
                                        >
                                            {r.threadTitle}
                                            <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                                        </a>
                                    </div>
                                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                                        <span className="text-xs text-orange-400 font-semibold">{r.subreddit}</span>
                                        {r.brandMentioned && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Your brand mentioned</span>
                                        )}
                                        {r.competitorMentioned && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Competitor mentioned</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {searched && results.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                        <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p className="text-sm">No Reddit threads ranking in Google&apos;s top 10 for this keyword. Try a broader term.</p>
                    </div>
                )}

                {/* How it works */}
                <div className="card-elevated p-6 space-y-4">
                    <h2 className="font-bold text-foreground">How to use Reddit threads for SEO</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        {[
                            { icon: Search, step: "1", title: "Find ranking threads", desc: "Threads on Google page 1 already have traffic. Participating drives referral visits and brand mentions." },
                            { icon: TrendingUp, step: "2", title: "Join the conversation", desc: "Leave helpful, non-promotional answers. Link to relevant resources on your site when genuinely useful." },
                            { icon: Users, step: "3", title: "Build brand signals", desc: "Consistent Reddit presence creates brand mentions that AI engines like ChatGPT and Perplexity pick up in AEO scans." },
                        ].map(item => {
                            const Icon = item.icon;
                            return (
                                <div key={item.step} className="flex gap-3">
                                    <span className="w-6 h-6 rounded-full bg-brand/10 text-brand text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{item.step}</span>
                                    <div>
                                        <Icon className="w-4 h-4 text-brand mb-1" />
                                        <p className="font-semibold">{item.title}</p>
                                        <p className="text-muted-foreground text-xs mt-0.5">{item.desc}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* CTA */}
                <div className="text-center p-8 card-elevated space-y-3">
                    <h2 className="font-bold text-foreground">Get full Reddit + AEO tracking in OptiAISEO</h2>
                    <p className="text-sm text-muted-foreground">Track brand mentions, AEO scores, and Reddit threads automatically for all your keywords.</p>
                    <Link href="/signup" className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-background rounded-xl font-bold text-sm">
                        Start free trial <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>

                {/* SEO content */}
                <div className="prose prose-invert prose-sm max-w-none text-foreground/70 space-y-4 border-t border-border pt-8">
                    <h2 className="text-foreground font-bold">What is Reddit SEO?</h2>
                    <p>Reddit SEO is the practice of identifying Reddit threads that rank on Google&apos;s first page for your target keywords, then participating strategically to gain brand visibility and referral traffic. Reddit is the third most-visited website globally, and thousands of &quot;site:reddit.com [keyword]&quot; queries rank on page 1 of Google across virtually every niche.</p>
                    <h2 className="text-foreground font-bold">Why Reddit threads rank on Google</h2>
                    <p>Google trusts Reddit as a high-authority domain and frequently surfaces Reddit threads in the top 10 — particularly for &quot;best [product]&quot;, &quot;vs&quot;, and &quot;review&quot; queries. After Google&apos;s HCU (Helpful Content Update) in 2023 and 2024, Reddit rankings increased 40%+ as users sought authentic, user-generated opinions over brand-produced content.</p>
                    <h2 className="text-foreground font-bold">How to find Reddit SEO opportunities (FAQs)</h2>
                    <p><strong>How many Reddit threads should I target per keyword?</strong> Focus on the top 3 ranking threads per keyword. Spreading across too many dilutes your time.</p>
                    <p><strong>Can I link to my site from Reddit?</strong> Only when genuinely relevant. Self-promotion without value is downvoted and flagged by moderators. The goal is building brand mentions and referrals, not direct link building.</p>
                    <p><strong>Does Reddit help AEO (AI search)?</strong> Yes. AI engines like ChatGPT and Perplexity pull brand mentions from Reddit threads when answering questions about your category. Consistent positive Reddit presence improves your AEO citation rate.</p>
                </div>
                <div className="border-t border-border pt-8 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Also free — no account required</p>
                  <div className="flex flex-wrap justify-center gap-3">
                    <Link href="/free/seo-checker" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                      🔍 Free SEO Audit Tool
                    </Link>
                    <Link href="/free/gso-checker" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                      🤖 AI Visibility Checker (GSoV)
                    </Link>
                    <Link href="/guide" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                      📚 SEO &amp; AEO Guides
                    </Link>
                    <Link href="/vs" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                      📊 SEO Tool Comparisons
                    </Link>
                  </div>
                </div>
            </div>
            <RedditSeoContent />
        </div>
    );
}
