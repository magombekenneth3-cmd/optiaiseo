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
import { Search, Sparkles, Shield, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import SeoCheckerContent from "@/components/seoContext/SeoContext";

type Phase = 'idle' | 'loading' | 'streaming' | 'error';

interface ProgressEvent {
    status: string;
    progress: number;
    step: string;
    redirectTo?: string;
    error?: string;
}

const FEATURES = [
    { icon: '🔍', label: 'On-Page Analysis' },
    { icon: '⚙️', label: 'Technical SEO' },
    { icon: '📝', label: 'Content Quality' },
    { icon: '📊', label: 'Score & Recommendations' },
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

    useEffect(() => {
        return () => { esRef.current?.close(); };
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

        es.onmessage = (evt) => {
            try {
                const payload: ProgressEvent = JSON.parse(evt.data);
                setProgress(payload.progress ?? 0);
                setStep(payload.step ?? '');

                if (payload.status === 'DONE' && payload.redirectTo) {
                    es.close();
                    setProgress(100);
                    setStep('Complete ✓ — loading your report...');
                    setTimeout(() => { window.location.href = payload.redirectTo!; }, 800);
                } else if (payload.status === 'FAILED') {
                    es.close();
                    setPhase('error');
                    setErrorMsg(payload.error ?? 'Audit failed. Please try again.');
                }
            } catch { /* malformed event — ignore */ }
        };

        es.onerror = () => {
            reconnectCount.current += 1;
            if (reconnectCount.current >= 3) {
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
            {/* Nav */}
            <nav className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between bg-card/60 backdrop-blur-sm sticky top-0 z-10">
                <Link href="/" className="font-bold text-lg" style={{ color: 'var(--brand)' }}>OptiAISEO</Link>
                <a href="/signup" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors font-medium">
                    Sign up free →
                </a>
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
                                                : <span className="w-3 h-3 shrink-0 text-center">{f.icon}</span>
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
            <SiteFooter />
        </div>
    );
}
