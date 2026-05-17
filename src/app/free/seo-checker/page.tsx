'use client';
import SiteFooter from "@/components/marketing/SiteFooter";

/**
 * /free/seo-checker (rebuilt)
 *
 * Step 1: URL input form
 * Step 2: Streaming SSE progress bar (connects to /api/free/progress/[auditId])
 * Step 3: Redirect to /free/results/[auditId] when done
 *
 * No login required. Mobile optimised.
 * Uses app design tokens (--brand #10b981, --background, --card, --border).
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Search, Sparkles, Shield, Zap, CheckCircle2, AlertCircle, Settings, FileText, BarChart3 } from 'lucide-react';
import SeoCheckerContent from "@/components/seoContext/SeoContext";
import { NavAuthSection } from "@/components/marketing/NavAuthSection";

type Phase = 'idle' | 'loading' | 'streaming' | 'error';

interface ProgressEvent {
    status: string;
    progress: number;
    step: string;
    redirectTo?: string;
    error?: string;
}

const FEATURES = [
    { icon: Search,    label: 'On-Page Analysis',       desc: 'Title, meta, headings, images' },
    { icon: Settings,  label: 'Technical SEO',           desc: 'Speed, mobile, crawlability' },
    { icon: FileText,  label: 'Content Quality',         desc: 'Readability, keyword usage' },
    { icon: BarChart3, label: 'Score & Recommendations', desc: 'Prioritised fix list' },
];

export default function FreeSeoCheckerPage() {
    const [url, setUrl] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [step, setStep] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const reconnectCount = useRef(0);
    const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            esRef.current?.close();
            if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
        };
    }, []);

    function normalizeUrl(raw: string): string {
        const trimmed = raw.trim();
        if (!trimmed) return '';
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const normalized = normalizeUrl(url);
        if (!normalized) return;

        setPhase('loading');
        setProgress(0);
        setStep('Starting audit...');
        setErrorMsg('');

        let auditId: string;
        try {
            const res = await fetch('/api/free/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: normalized }),
            });
            const data = await res.json();
            if (!res.ok) {
                setPhase('error');
                setErrorMsg(data.error ?? 'Failed to start audit');
                return;
            }
            auditId = data.auditId;
            setActiveAuditId(auditId);
            reconnectCount.current = 0;
        } catch {
            setPhase('error');
            setErrorMsg('Network error — please check your connection and try again.');
            return;
        }

        setPhase('streaming');
        setProgress(5);
        setStep('Queuing audit...');

        const es = new EventSource(`/api/free/progress/${auditId}`);
        esRef.current = es;

        if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
        streamTimeoutRef.current = setTimeout(() => {
            es.close();
            setPhase('error');
            setErrorMsg('This is taking longer than expected. Your report may still be processing — try refreshing in a minute.');
        }, 90_000);

        es.onmessage = (evt) => {
            try {
                const payload: ProgressEvent = JSON.parse(evt.data);
                setProgress(payload.progress ?? 0);
                setStep(payload.step ?? '');

                if (payload.status === 'DONE' && payload.redirectTo) {
                    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                    es.close();
                    setProgress(100);
                    setStep('Complete ✓ — loading your report...');
                    setTimeout(() => { window.location.href = payload.redirectTo!; }, 800);
                } else if (payload.status === 'FAILED') {
                    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                    es.close();
                    setPhase('error');
                    setErrorMsg(payload.error ?? 'Audit failed. Please try again.');
                }
            } catch { /* malformed event — ignore */ }
        };

        es.onerror = () => {
            reconnectCount.current += 1;
            if (reconnectCount.current >= 3) {
                if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                es.close();
                setPhase((prev) => {
                    if (prev === 'streaming') {
                        setErrorMsg('Connection lost. Refreshing may load your result.');
                        return 'error';
                    }
                    return prev;
                });
            }
        };
    }

    return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
            <nav className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between bg-card/60 backdrop-blur-sm sticky top-0 z-10">
                <Link href="/" className="font-bold text-lg" style={{ color: 'var(--brand)' }}>OptiAISEO</Link>
                <NavAuthSection ctaText="Sign up free →" ctaHref="/signup" ctaClassName="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors font-medium" />
            </nav>

            <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
                <div className="w-full max-w-xl flex flex-col items-center gap-8">

                    {/* Header */}
                    {phase === 'idle' && (
                        <div className="text-center fade-in-up">
                            <div
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-4 border"
                                style={{
                                    background: 'var(--brand-muted)',
                                    borderColor: 'var(--brand-border)',
                                    color: 'var(--brand)',
                                }}
                            >
                                <Sparkles className="w-3 h-3" /> Free — No signup required
                            </div>
                            <h1 className="text-3xl sm:text-4xl font-black mb-3 text-foreground leading-tight">
                                Free SEO Audit
                            </h1>
                            <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto">
                                Get an instant SEO score and prioritised fixes for any website — in under 15 seconds.
                            </p>
                        </div>
                    )}
                    {/* Sample report preview */}
                    {phase === 'idle' && (
                        <div className="w-full rounded-2xl border border-border bg-card p-4 fade-in-up fade-in-up-1">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                                Sample report preview
                            </p>
                            <div className="rounded-xl bg-muted/50 border border-border overflow-hidden relative">
                                <div className="p-4 blur-[2px] pointer-events-none select-none" aria-hidden="true">
                                    <div className="flex gap-3 mb-3">
                                        {["SEO Score", "Issues Found", "Passed Checks"].map((label, i) => (
                                            <div key={label} className="flex-1 bg-card rounded-xl p-3 border border-border">
                                                <p className="text-xs text-muted-foreground">{label}</p>
                                                <p className="text-2xl font-bold mt-1 text-foreground">{["72", "14", "38"][i]}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="space-y-2">
                                        {["Missing meta description", "Images missing alt text", "Slow page speed"].map(issue => (
                                            <div key={issue} className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                                                <span className="text-xs text-foreground">{issue}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="px-3 py-1.5 rounded-full bg-background/90 border border-border text-xs font-semibold text-foreground">
                                        Your report will look like this
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* URL form */}
                    {(phase === 'idle' || phase === 'error') && (
                        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3 fade-in-up fade-in-up-1">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                                <input
                                    id="free-audit-url"
                                    type="text"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="yourwebsite.com"
                                    autoFocus
                                    required
                                    className="w-full pl-11 pr-4 py-4 rounded-2xl text-base focus:outline-none transition-colors"
                                    style={{
                                        background: 'var(--card)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--foreground)',
                                    }}
                                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--brand)')}
                                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                                />
                            </div>
                            {errorMsg && (
                                <div className="flex flex-col gap-2 px-4 py-3 rounded-xl text-sm border"
                                    style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#f87171' }}>
                                    <div className="flex items-start gap-2">
                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>{errorMsg}</span>
                                    </div>
                                    {activeAuditId && (
                                        <a
                                            href={`/free/results/${activeAuditId}`}
                                            className="text-xs underline underline-offset-2 opacity-80 hover:opacity-100 pl-6"
                                        >
                                            Check if your results are ready →
                                        </a>
                                    )}
                                </div>
                            )}
                            <button
                                type="submit"
                                className="btn-brand w-full py-4 rounded-2xl text-base font-bold justify-center"
                                style={{
                                    boxShadow: '0 0 30px rgba(16,185,129,0.25)',
                                }}
                            >
                                Analyse My Site
                            </button>
                        </form>
                    )}

                    {/* Streaming progress */}
                    {(phase === 'loading' || phase === 'streaming') && (
                        <div
                            className="w-full rounded-2xl p-8 flex flex-col items-center gap-6 border fade-in-up"
                            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                        >
                            {/* Animated progress ring */}
                            <div className="relative w-20 h-20">
                                <svg className="animate-spin w-full h-full" viewBox="0 0 80 80">
                                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="7" />
                                    <circle
                                        cx="40" cy="40" r="34" fill="none"
                                        stroke="var(--brand)" strokeWidth="7"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(progress / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
                                        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="font-bold text-lg" style={{ color: 'var(--brand)' }}>{progress}%</span>
                                </div>
                            </div>

                            {/* Step label */}
                            <p className="text-muted-foreground text-sm font-medium text-center min-h-[20px]">
                                {step || 'Starting...'}
                            </p>

                            {/* Progress bar */}
                            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${progress}%`, background: 'var(--brand)' }}
                                />
                            </div>

                            {/* Feature checklist */}
                            <div className="grid grid-cols-2 gap-2 w-full mt-2">
                                {FEATURES.map((f) => {
                                    const FeatureIcon = f.icon;
                                    const done = progress >= (FEATURES.indexOf(f) + 1) * 22;
                                    return (
                                        <div
                                            key={f.label}
                                            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all"
                                            style={{
                                                borderColor: done ? 'var(--brand-border)' : 'var(--border)',
                                                background: done ? 'var(--brand-muted)' : 'transparent',
                                                color: done ? 'var(--brand)' : 'var(--muted-foreground)',
                                            }}
                                        >
                                            {done
                                                ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                                                : <FeatureIcon className="w-3 h-3 shrink-0" />
                                            }
                                            {f.label}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Trust strip */}
                    {phase === 'idle' && (
                        <div className="flex flex-wrap items-center justify-center gap-4 text-muted-foreground text-xs fade-in-up fade-in-up-2">
                            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> No account needed</span>
                            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3" /> Results in ~15 seconds</span>
                            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Shareable report link</span>
                        </div>
                    )}

                </div>
            </main>
            <SeoCheckerContent />
            <div className="border-t border-border pt-8 mt-4 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Also free — no account required</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/free/gso-checker" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                  🤖 AI Visibility Checker (GSoV)
                </Link>
                <Link href="/free/reddit-seo" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                  🔴 Reddit SEO Opportunity Finder
                </Link>
                <Link href="/vs" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                  📊 SEO Tool Comparisons
                </Link>
                <Link href="/guide" className="text-xs font-semibold px-4 py-2 rounded-full border border-border hover:border-brand hover:text-brand transition-colors">
                  📚 SEO &amp; AEO Guides
                </Link>
              </div>
            </div>
            <SiteFooter />
        </div>
    );
}
