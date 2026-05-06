"use client";

import { useState } from "react";
import Link from "next/link";
import { runFreeGsoCheck } from "@/app/actions/freeGsoCheck";
import { Bot, ArrowRight, Lock, Check, X, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface ScanResult {
    domain: string;
    grade: string;
    mentionRate: number;
    excerpt: string;
    categories: { label: string; passed: boolean }[];
}

export default function FreeGsoCheckerPage() {
    const [domain, setDomain] = useState("");
    const [isScanning, setIsScanning] = useState(false);
    const [result, setResult] = useState<ScanResult | null>(null);

    async function handleScan(e: React.FormEvent) {
        e.preventDefault();
        if (!domain) return;
        setIsScanning(true);
        setResult(null);

        const res = await runFreeGsoCheck(domain);
        setIsScanning(false);

        if (res.success && res.data) {
            setResult(res.data);
        } else {
            toast.error(res.error || "Failed to scan domain. Please try again.");
        }
    }

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Simple Nav */}
            <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
                            <span className="font-black text-background text-[11px] tracking-tight">Opti</span>
                        </div>
                        <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                    </Link>
                    <div className="flex items-center gap-4">
                        <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:block">Log in</Link>
                        <Link href="/signup" className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90">Get full report</Link>
                    </div>
                </div>
            </nav>

            <main className="flex-1 max-w-4xl mx-auto px-6 py-24 w-full">
                {/* Hero / Input */}
                <div className="text-center mb-16 transition-all duration-500">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand/10 border border-brand/20 mb-6 mx-auto">
                        <Bot className="w-8 h-8 text-brand" />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
                        Do AI engines <span className="text-brand">know you exist?</span>
                    </h1>
                    <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
                        Check your Generative Share of Voice (GSoV) across ChatGPT, Claude, and Perplexity in 15 seconds. Free.
                    </p>

                    <form onSubmit={handleScan} className="max-w-xl mx-auto relative group">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-brand transition-colors" />
                        </div>
                        <input
                            type="text"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            placeholder="Enter your website (e.g. yourdomain.com)"
                            disabled={isScanning}
                            className="w-full bg-card border-2 border-border focus:border-brand rounded-2xl py-4 pl-12 pr-32 text-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-brand/10 transition-all disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={isScanning || !domain}
                            className="absolute inset-y-2 right-2 px-6 bg-foreground text-background font-bold rounded-xl text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isScanning ? (
                                <><span className="animate-spin text-lg">⚙</span> Scanning...</>
                            ) : (
                                "Check Now"
                            )}
                        </button>
                    </form>
                </div>

                {/* Results Section */}
                {result && (
                    <div className="fade-in-up card-surface rounded-3xl p-1 overflow-hidden relative">
                        {/* Grade Header */}
                        <div className="bg-card px-8 py-10 rounded-[22px] border border-border flex flex-col md:flex-row items-center gap-10">
                            {/* Score Ring */}
                            <div className="relative w-32 h-32 shrink-0 flex items-center justify-center rounded-full bg-background border-8 border-muted">
                                {result.grade === "A" && <div className="absolute inset-0 rounded-full border-8 border-brand shadow-[0_0_30px_rgba(16,185,129,0.3)] animate-pulse" />}
                                {result.grade === "B" || result.grade === "C" && <div className="absolute inset-0 rounded-full border-8 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]" />}
                                {result.grade === "D" || result.grade === "F" && <div className="absolute inset-0 rounded-full border-8 border-rose-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]" />}
                                <div className="flex flex-col items-center justify-center relative z-10">
                                    <span className="text-4xl font-black">{result.grade}</span>
                                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Grade</span>
                                </div>
                            </div>
                            
                            <div className="text-center md:text-left flex-1">
                                <h2 className="text-2xl font-bold mb-2">
                                    {result.mentionRate >= 80 ? "Excellent AI Visibility!" : result.mentionRate >= 40 ? "Average AI Visibility" : "Poor AI Visibility"}
                                </h2>
                                <p className="text-muted-foreground text-sm mb-6 max-w-lg leading-relaxed">
                                    AI models recognize <span className="text-foreground font-semibold">{result.domain}</span> for {result.mentionRate}% of core brand attributes. 
                                    They wrote: <span className="italic">"{result.excerpt}"</span>
                                </p>
                                
                                <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                                    {result.categories.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            {c.passed ? <Check className="w-4 h-4 text-brand" /> : <X className="w-4 h-4 text-rose-500" />}
                                            <span className={c.passed ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Gated Teaser Section (Semrush style upsell) */}
                        <div className="mt-6 relative px-8 py-12 rounded-[22px] border border-border bg-gradient-to-b from-card to-background overflow-hidden">
                            <div className="absolute inset-0 bg-background/40 backdrop-blur-[6px] z-10 flex flex-col items-center justify-center text-center p-6">
                                <div className="w-16 h-16 rounded-2xl bg-brand border border-brand/20 flex items-center justify-center mb-6 shadow-xl shadow-brand/20 rotate-3">
                                    <Lock className="w-8 h-8 text-background" />
                                </div>
                                <h3 className="text-3xl font-black mb-3">Unlock the full AEO Report</h3>
                                <p className="text-muted-foreground max-w-md mx-auto mb-8 text-lg">
                                    See exactly which keywords you're missing, view your competitor gaps, and get step-by-step instructions to fix your AI visibility.
                                </p>
                                <Link
                                    href={`/signup?domain=${encodeURIComponent(result.domain)}`}
                                    className="bg-foreground text-background font-bold px-8 py-4 rounded-full hover:opacity-90 transition-transform hover:scale-105 active:scale-95 shadow-xl flex items-center gap-2 text-lg"
                                >
                                    <Sparkles className="w-5 h-5 text-brand" />
                                    Get Full Report — Free
                                </Link>
                                <p className="text-xs text-muted-foreground mt-4">Takes 30 seconds. No credit card required.</p>
                            </div>

                            {/* Fake blurred content underneath */}
                            <div className="opacity-40 select-none pointer-events-none filter blur-sm space-y-8 max-w-3xl mx-auto">
                                <div className="h-6 w-48 bg-muted rounded-full mb-6 relative overflow-hidden" />
                                <div className="space-y-4">
                                    {[1,2,3].map(i => (
                                        <div key={i} className="w-full bg-muted/50 rounded-xl p-6 flex items-start gap-4 border border-border/50">
                                            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                                            <div className="flex-1 space-y-3">
                                                <div className="h-4 w-3/4 bg-muted rounded" />
                                                <div className="h-4 w-1/2 bg-muted rounded" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Soft conversion footer */}
            <div className="border-t border-border bg-card">
                <div className="max-w-4xl mx-auto px-6 py-12 text-center">
                    <p className="text-muted-foreground text-sm mb-3">Want automated AI visibility tracking, audit history, and keyword rankings?</p>
                    <Link href="/signup" className="btn-brand inline-flex items-center gap-2">
                        Start free with OptiAISEO →
                    </Link>
                    <p className="text-xs text-muted-foreground mt-3">No credit card · Full Pro access for 7 days · Cancel anytime</p>
                </div>
            </div>
        </div>
    );
}
