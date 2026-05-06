"use client";

import Link from "next/link";
import { Zap, CheckCircle2, ArrowRight, Globe2, RefreshCw, FileSearch, History, Upload } from "lucide-react";

const FEATURES: { icon: React.ElementType; label: string; sub: string }[] = [
    { icon: Zap,         label: "Google Indexing API",        sub: "200 URLs/day — fastest crawl trigger available" },
    { icon: Globe2,      label: "IndexNow — Bing, Yandex, Naver", sub: "One signal, four search engines notified instantly" },
    { icon: RefreshCw,   label: "Auto-submit on publish",     sub: "New blog posts & audit fixes indexed automatically" },
    { icon: Upload,      label: "Sitemap bulk import",        sub: "Import all pages from any sitemap.xml in one click" },
    { icon: History,     label: "Full submission history",    sub: "Track every URL, engine, status & timestamp" },
    { icon: FileSearch,  label: "Per-site quota tracking",    sub: "Live progress bar so you never waste quota" },
];

export function IndexingUpgradeGate() {
    return (
        <div className="max-w-2xl mx-auto py-16 px-4 flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative">
                    <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-xl scale-110" />
                    <span className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                        <Zap className="w-8 h-8 text-emerald-400" />
                    </span>
                </div>

                <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2">PRO Feature</p>
                    <h1 className="text-3xl font-black tracking-tight mb-3">Multi-Engine Auto Indexer</h1>
                    <p className="text-muted-foreground text-base max-w-md mx-auto leading-relaxed">
                        Stop waiting weeks for Google to discover your pages. Submit directly to 4 search engines the moment you publish.
                    </p>
                </div>
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FEATURES.map(({ icon: Icon, label, sub }) => (
                    <div
                        key={label}
                        className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-200 group"
                    >
                        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 mt-0.5 group-hover:border-emerald-500/40 transition-colors">
                            <Icon className="w-4 h-4 text-emerald-400" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">{label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                <Link
                    href="/dashboard/billing"
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-semibold text-sm transition-all duration-150 shadow-lg shadow-emerald-900/20"
                >
                    <Zap className="w-4 h-4" />
                    Upgrade to PRO
                    <ArrowRight className="w-4 h-4 ml-auto" />
                </Link>
                <p className="text-xs text-muted-foreground text-center">
                    Cancel anytime · Instant access after upgrade
                </p>
            </div>

            <div className="w-full rounded-xl border border-border bg-muted/30 p-5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    What happens the moment you upgrade
                </p>
                <ol className="space-y-2">
                    {[
                        "Connect your Google Search Console via OAuth — takes 30 seconds",
                        "Add your site domain to start tracking submissions",
                        "Paste URLs or import your entire sitemap with one click",
                        "Every new blog post and audit fix is auto-submitted going forward",
                    ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-black shrink-0 mt-0.5 border border-emerald-500/20">
                                {i + 1}
                            </span>
                            {step}
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
