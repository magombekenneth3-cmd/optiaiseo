'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Share2,
    Lock,
    ArrowRight,
    Sparkles,
    TrendingUp,
} from 'lucide-react';

interface Rec {
    label: string;
    recommendation: string;
    priority: 'High' | 'Medium' | 'Low';
    categoryId: string;
    finding: string;
    priorityScore: number;
}

interface CategoryScores {
    onPage?: number;
    technical?: number;
    contentQuality?: number;
}

interface Props {
    auditId: string;
    domain: string;
    url: string;
    overallScore: number;
    categoryScores: CategoryScores;
    topRecs: Rec[];
    totalRecCount: number;
    grade: string;
    createdAt: string;
}

// Grade ring colours use brand + semantic palette
const GRADE_COLOR: Record<string, string> = {
    A: 'var(--brand)',
    B: '#3b82f6',
    C: '#f59e0b',
    D: '#f97316',
    F: '#ef4444',
};

const CATEGORY_LABELS: Record<string, string> = {
    onPage: 'On-Page SEO',
    technical: 'Technical',
    contentQuality: 'Content Quality',
};

function barColor(value: number) {
    if (value >= 80) return 'var(--brand)';
    if (value >= 50) return '#f59e0b';
    return '#ef4444';
}
function barTextColor(value: number) {
    if (value >= 80) return 'var(--brand)';
    if (value >= 50) return '#f59e0b';
    return '#ef4444';
}

function CategoryBar({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-bold" style={{ color: barTextColor(value) }}>{value}/100</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--muted)' }}>
                <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${value}%`, background: barColor(value) }}
                />
            </div>
        </div>
    );
}

function PriorityIcon({ status }: { status: string }) {
    if (status === 'High') return <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#f87171' }} />;
    if (status === 'Medium') return <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />;
    return <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />;
}

const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
    High:   { background: 'rgba(239,68,68,0.08)',   color: '#f87171', borderColor: 'rgba(239,68,68,0.25)' },
    Medium: { background: 'rgba(245,158,11,0.08)',  color: '#fbbf24', borderColor: 'rgba(245,158,11,0.25)' },
    Low:    { background: 'var(--brand-muted)',     color: 'var(--brand)', borderColor: 'var(--brand-border)' },
};

export default function FreeResultClient({
    auditId,
    domain,
    overallScore,
    categoryScores,
    topRecs,
    totalRecCount,
    grade,
    createdAt,
}: Props) {
    const [email, setEmail] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [unlockedEmail, setUnlockedEmail] = useState('');
    const [allRecs, setAllRecs] = useState<Rec[]>([]);
    const [emailError, setEmailError] = useState('');
    const [shared, setShared] = useState(false);

    const ringColor = GRADE_COLOR[grade] ?? '#ef4444';
    const circumference = 2 * Math.PI * 52;
    const dash = (overallScore / 100) * circumference;

    const cats = Object.entries(categoryScores)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => ({ key: k, label: CATEGORY_LABELS[k] ?? k, value: v as number }));

    const freeRecs = topRecs.slice(0, 3);
    const gatedCount = totalRecCount - 3;

    async function handleShare() {
        const title = `${domain} SEO Score: ${overallScore}/100`;
        const text = `I just got my free SEO audit from OptiAISEO — Score: ${overallScore}/100. Check yours:`;
        const url = window.location.href;
        if (typeof navigator !== 'undefined' && 'share' in navigator) {
            try {
                await (navigator as Navigator & { share: (d: object) => Promise<void> }).share({ title, text, url });
                setShared(true);
                return;
            } catch { /* user cancelled */ }
        }
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 2500);
    }

    async function handleUnlock(e: React.FormEvent) {
        e.preventDefault();
        setEmailError('');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setEmailError('Please enter a valid email address.');
            return;
        }
        setUnlocking(true);
        try {
            const res = await fetch('/api/free/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auditId, email }),
            });
            const data = await res.json();
            if (res.ok && data.allRecs) {
                setAllRecs(data.allRecs);
                setUnlockedEmail(email);
                setUnlocked(true);
            } else {
                setEmailError(data.error ?? 'Something went wrong. Please try again.');
            }
        } catch {
            setEmailError('Network error. Please try again.');
        } finally {
            setUnlocking(false);
        }
    }

    const displayedRecs = unlocked ? allRecs : freeRecs;

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Nav */}
            <nav
                className="border-b px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm"
                style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--card) 85%, transparent)' }}
            >
                <Link href="/" className="font-bold text-lg" style={{ color: 'var(--brand)' }}>OptiAISEO</Link>
                <Link
                    href={`/signup?audit=${auditId}`}
                    className="text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg transition-all"
                    style={{ background: 'var(--brand)', color: '#000' }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                    Fix These Issues Free →
                </Link>
            </nav>

            <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">

                {/* Score Card */}
                <div
                    className="rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6 sm:gap-10 border fade-in-up"
                    style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                >
                    {/* Score ring */}
                    <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
                        <svg className="-rotate-90" width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--muted)" strokeWidth="10" />
                            <circle
                                cx="60" cy="60" r="52" fill="none"
                                strokeWidth="10" strokeLinecap="round"
                                strokeDasharray={`${dash} ${circumference}`}
                                stroke={ringColor}
                                className="transition-all duration-1000"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black" style={{ color: ringColor }}>{grade}</span>
                            <span className="text-muted-foreground text-xs">{overallScore}/100</span>
                        </div>
                    </div>

                    <div className="flex-1 text-center sm:text-left">
                        <h1 className="text-xl sm:text-2xl font-bold mb-1 break-all text-foreground">{domain}</h1>
                        <p className="text-muted-foreground text-sm mb-4">
                            Audited {new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <div className="flex flex-col gap-3 w-full max-w-xs sm:max-w-full">
                            {cats.map((c) => (
                                <CategoryBar key={c.key} label={c.label} value={c.value} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Share button */}
                <div className="flex justify-center fade-in-up fade-in-up-1">
                    <button
                        onClick={handleShare}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all border"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                        onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'var(--brand-border)';
                            e.currentTarget.style.color = 'var(--brand)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.color = 'var(--muted-foreground)';
                        }}
                    >
                        <Share2 className="w-4 h-4" />
                        {shared ? '✓ Link copied!' : 'Share your score'}
                    </button>
                </div>

                {/* Recommendations */}
                <div className="fade-in-up fade-in-up-2">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="w-5 h-5" style={{ color: 'var(--brand)' }} />
                        <h2 className="text-lg font-bold text-foreground">
                            {unlocked
                                ? `All ${allRecs.length} Recommendations`
                                : `Top Issues Found (${totalRecCount} total)`}
                        </h2>
                    </div>

                    {unlocked && unlockedEmail && (
                        <div
                            className="flex items-start gap-3 rounded-xl px-4 py-3 mb-4 border"
                            style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' }}
                        >
                            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />
                            <p className="text-sm" style={{ color: 'var(--brand)' }}>
                                Full report unlocked and sent to <strong>{unlockedEmail}</strong> — check your inbox.
                            </p>
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        {displayedRecs.map((rec, i) => (
                            <div
                                key={i}
                                className="rounded-xl p-4 border transition-colors"
                                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                            >
                                <div className="flex items-start gap-3">
                                    <PriorityIcon status={rec.priority} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <p className="text-sm font-semibold text-foreground">{rec.label}</p>
                                            <span
                                                className="text-[10px] font-bold px-2 py-0.5 rounded border"
                                                style={PRIORITY_STYLE[rec.priority] ?? {}}
                                            >
                                                {rec.priority}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">{rec.finding}</p>
                                        {rec.recommendation && (
                                            <div
                                                className="mt-2 text-xs rounded-lg p-2.5 border"
                                                style={{ background: 'var(--muted)', borderColor: 'var(--border)' }}
                                            >
                                                <span className="font-semibold" style={{ color: '#fbbf24' }}>💡 Fix: </span>
                                                <span className="text-muted-foreground">{rec.recommendation}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Email gate */}
                    {!unlocked && gatedCount > 0 && (
                        <div className="mt-4 relative">
                            {/* Blurred preview */}
                            <div
                                className="rounded-xl p-4 blur-sm select-none pointer-events-none border"
                                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                            >
                                <div className="flex items-start gap-3">
                                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">Hidden recommendation...</p>
                                        <p className="text-xs text-muted-foreground mt-1">Enter your email to unlock all {gatedCount} remaining issues</p>
                                    </div>
                                </div>
                            </div>

                            {/* Gate overlay */}
                            <div
                                className="absolute inset-0 flex flex-col items-center justify-center rounded-xl px-6 py-8"
                                style={{ background: 'color-mix(in srgb, var(--background) 88%, transparent)' }}
                            >
                                <Lock className="w-6 h-6 mb-3" style={{ color: 'var(--brand)' }} />
                                <p className="text-sm font-bold text-center mb-1 text-foreground">
                                    {gatedCount} more issues found
                                </p>
                                <p className="text-xs text-muted-foreground text-center mb-5">
                                    Enter your email to unlock the full report — we&apos;ll also send it to your inbox.
                                </p>
                                <form onSubmit={handleUnlock} className="w-full max-w-sm flex flex-col gap-3">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        required
                                        className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-colors"
                                        style={{
                                            background: 'var(--card)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--foreground)',
                                        }}
                                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--brand)')}
                                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                                    />
                                    {emailError && (
                                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', color: '#f87171' }}>
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            <p className="text-xs">{emailError}</p>
                                        </div>
                                    )}
                                    <button
                                        type="submit"
                                        disabled={unlocking}
                                        className="btn-brand w-full py-2.5 rounded-xl text-sm justify-center disabled:opacity-50"
                                    >
                                        {unlocking ? 'Sending...' : 'Unlock Full Report'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>

                {/* CTA banner */}
                <div
                    className="rounded-2xl p-6 text-center border fade-in-up fade-in-up-3"
                    style={{
                        background: 'linear-gradient(135deg, var(--brand-muted), rgba(59,130,246,0.08))',
                        borderColor: 'var(--brand-border)',
                    }}
                >
                    <Sparkles className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--brand)' }} />
                    <h2 className="text-lg font-bold mb-2 text-foreground">Fix these issues automatically</h2>
                    <p className="text-muted-foreground text-sm mb-5">
                        Sign up free to track rankings, auto-fix issues, and get weekly AI-powered SEO reports.
                    </p>
                    <Link
                        href={`/signup?audit=${auditId}`}
                        className="btn-brand inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm"
                        style={{ boxShadow: '0 0 20px rgba(16,185,129,0.3)' }}
                    >
                        Start Fixing for Free <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>

            </main>
        </div>
    );
}
