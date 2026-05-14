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
    Download,
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
    'on-page'?: number;
    'technical-seo'?: number;
    'content-quality'?: number;
    [key: string]: number | undefined;
}

interface IssueStats {
    total: number;
    errors: number;
    warnings: number;
    notices: number;
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
    issueStats: IssueStats;
    quickWins: Rec[];
}



const GRADE_COLOR: Record<string, string> = {
    A: 'var(--brand)',
    B: '#3b82f6',
    C: '#f59e0b',
    D: '#f97316',
    F: '#ef4444',
};

const CATEGORY_LABELS: Record<string, string> = {
    'on-page':         'On-Page SEO',
    'technical-seo':   'Technical',
    'content-quality': 'Content Quality',
};

const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
    High:   { background: 'rgba(239,68,68,0.08)',  color: '#f87171', borderColor: 'rgba(239,68,68,0.25)' },
    Medium: { background: 'rgba(245,158,11,0.08)', color: '#fbbf24', borderColor: 'rgba(245,158,11,0.25)' },
    Low:    { background: 'var(--brand-muted)',     color: 'var(--brand)', borderColor: 'var(--brand-border)' },
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

function chipBg(value: number): string {
    if (value >= 80) return 'rgba(16,185,129,0.08)';
    if (value >= 50) return 'rgba(245,158,11,0.08)';
    return 'rgba(239,68,68,0.08)';
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



type TabFilter = 'all' | 'High' | 'Medium' | 'Low';

export default function FreeResultClient({
    auditId,
    domain,
    overallScore,
    categoryScores,
    topRecs,
    totalRecCount,
    grade,
    createdAt,
    issueStats,
    quickWins,
}: Props) {
    const [email, setEmail] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [unlockedEmail, setUnlockedEmail] = useState('');
    const [allRecs, setAllRecs] = useState<Rec[]>([]);
    const [emailError, setEmailError] = useState('');
    const [shared, setShared] = useState(false);
    const [activeTab, setActiveTab] = useState<TabFilter>('all');

    const ringColor = GRADE_COLOR[grade] ?? '#ef4444';

    const cats = Object.entries(categoryScores)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => ({ key: k, label: CATEGORY_LABELS[k] ?? k, value: v as number }));

    const FREE_ROW_COUNT = 5;
    const freeRecs = topRecs.slice(0, FREE_ROW_COUNT);
    const gatedCount = Math.max(0, totalRecCount - freeRecs.length);
    const displayedRecs = unlocked ? allRecs : freeRecs;

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

    return (
        <div className="min-h-screen bg-background text-foreground">

            <nav
                className="border-b px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm"
                style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--card) 85%, transparent)' }}
            >
                <Link href="/" className="font-bold text-lg" style={{ color: 'var(--brand)' }}>OptiAISEO</Link>
                <div className="flex items-center gap-2">
                    {unlocked && (
                        <a
                            href={`/api/audit/export/${auditId}`}
                            className="text-xs font-medium px-3 py-2 rounded-lg border transition-all flex items-center gap-1"
                            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                        >
                            <Download className="w-3.5 h-3.5" /> Export PDF
                        </a>
                    )}
                    <button
                        onClick={handleShare}
                        className="text-xs font-medium px-3 py-2 rounded-lg border transition-all flex items-center gap-1"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                    >
                        <Share2 className="w-3.5 h-3.5" /> {shared ? '✓ Copied' : 'Share'}
                    </button>
                    <Link
                        href={`/signup?audit=${auditId}`}
                        className="text-xs sm:text-sm font-semibold px-4 py-2 rounded-lg transition-all"
                        style={{ background: 'var(--brand)', color: '#000' }}
                    >
                        Fix these issues →
                    </Link>
                </div>
            </nav>

            <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">


                <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 fade-in-up">


                    <div
                        className="rounded-2xl p-6 border flex flex-col items-center gap-4"
                        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                    >

                        <div className="flex items-center gap-2 self-start">
                            <span className="text-sm font-semibold text-foreground break-all">{domain}</span>
                            <span
                                className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                                style={{ background: 'var(--brand-muted)', color: 'var(--brand)', border: '1px solid var(--brand-border)' }}
                            >
                                {new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                        </div>


                        <div className="relative" style={{ width: 140, height: 140 }}>
                            <svg className="-rotate-90" width="140" height="140" viewBox="0 0 140 140">
                                <circle cx="70" cy="70" r="54" fill="none" stroke="var(--muted)" strokeWidth="12" />
                                <circle
                                    cx="70" cy="70" r="54" fill="none"
                                    strokeWidth="12" strokeLinecap="round"
                                    strokeDasharray={`${(overallScore / 100) * 2 * Math.PI * 54} ${2 * Math.PI * 54}`}
                                    stroke={ringColor}
                                    className="transition-all duration-1000"
                                />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-4xl font-black" style={{ color: ringColor }}>{overallScore}</span>
                                <span className="text-muted-foreground text-xs">health score</span>
                            </div>
                        </div>


                        <div className="grid grid-cols-3 gap-2 w-full">
                            {cats.map((c) => (
                                <div key={c.key} className="rounded-xl p-2 text-center" style={{ background: chipBg(c.value) }}>
                                    <p className="text-[10px] text-muted-foreground mb-0.5">{c.label}</p>
                                    <p className="text-base font-bold" style={{ color: barTextColor(c.value) }}>{c.value}</p>
                                </div>
                            ))}
                        </div>


                        <div className="flex gap-2 w-full">
                            <button
                                className="flex-1 text-xs py-2 rounded-xl border transition-colors"
                                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                                onClick={handleShare}
                            >
                                <Share2 className="w-3 h-3 inline mr-1" />{shared ? '✓ Copied' : 'Share'}
                            </button>
                            <Link
                                href={`/signup?audit=${auditId}`}
                                className="flex-1 text-xs py-2 rounded-xl text-center font-semibold transition-all"
                                style={{ background: 'var(--brand)', color: '#000' }}
                            >
                                Track weekly →
                            </Link>
                        </div>
                    </div>


                    <div
                        className="rounded-2xl p-6 border flex flex-col gap-5"
                        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                    >

                        <div className="grid grid-cols-4 gap-3">
                            {[
                                { label: 'Total',    value: issueStats.total,    color: 'var(--foreground)' },
                                { label: 'Errors',   value: issueStats.errors,   color: '#ef4444' },
                                { label: 'Warnings', value: issueStats.warnings, color: '#f59e0b' },
                                { label: 'Notices',  value: issueStats.notices,  color: 'var(--muted-foreground)' },
                            ].map(s => (
                                <div key={s.label} className="rounded-xl p-3" style={{ background: 'var(--muted)' }}>
                                    <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                                </div>
                            ))}
                        </div>


                        <div>
                            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                                Category Scores
                            </p>
                            <div className="flex flex-col gap-3">
                                {cats.map((c) => (
                                    <CategoryBar key={c.key} label={c.label} value={c.value} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>


                <div className="fade-in-up fade-in-up-2">


                    <div className="flex gap-1 border-b mb-0" style={{ borderColor: 'var(--border)' }}>
                        {([
                            { id: 'all' as TabFilter,    label: 'All',      count: issueStats.total },
                            { id: 'High' as TabFilter,   label: 'Errors',   count: issueStats.errors },
                            { id: 'Medium' as TabFilter, label: 'Warnings', count: issueStats.warnings },
                            { id: 'Low' as TabFilter,    label: 'Notices',  count: issueStats.notices },
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
                                style={{
                                    borderBottomColor: activeTab === tab.id ? 'var(--brand)' : 'transparent',
                                    color: activeTab === tab.id ? 'var(--brand)' : 'var(--muted-foreground)',
                                }}
                            >
                                {tab.label}
                                <span
                                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                                    style={{
                                        background: tab.id === 'High' ? 'rgba(239,68,68,0.1)'
                                            : tab.id === 'Medium' ? 'rgba(245,158,11,0.1)'
                                                : 'var(--muted)',
                                        color: tab.id === 'High' ? '#ef4444'
                                            : tab.id === 'Medium' ? '#f59e0b'
                                                : 'var(--muted-foreground)',
                                    }}
                                >
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>


                    <div
                        className="rounded-b-2xl border border-t-0 overflow-hidden"
                        style={{ borderColor: 'var(--border)' }}
                    >

                        <div
                            className="grid px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                            style={{ background: 'var(--muted)', gridTemplateColumns: '1fr 100px 90px' }}
                        >
                            <span>Issue</span>
                            <span>Category</span>
                            <span>Severity</span>
                        </div>


                        {displayedRecs
                            .filter(r => activeTab === 'all' || r.priority === activeTab)
                            .map((rec, i) => (
                                <div
                                    key={i}
                                    className="grid px-4 py-3 border-t items-start transition-colors hover:bg-muted/40"
                                    style={{ borderColor: 'var(--border)', gridTemplateColumns: '1fr 100px 90px' }}
                                >
                                    <div className="flex items-start gap-2 min-w-0 pr-3">
                                        <PriorityIcon status={rec.priority} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground">{rec.label}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{rec.finding}</p>
                                            {rec.recommendation && (
                                                <p
                                                    className="text-xs mt-1.5 rounded-lg px-2 py-1.5 border"
                                                    style={{ background: 'var(--muted)', borderColor: 'var(--border)' }}
                                                >
                                                    <span className="font-semibold" style={{ color: '#fbbf24' }}>💡 </span>
                                                    <span className="text-muted-foreground">{rec.recommendation}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground pt-0.5">
                                        {CATEGORY_LABELS[rec.categoryId] ?? rec.categoryId}
                                    </span>
                                    <span
                                        className="text-[10px] font-bold px-2 py-0.5 rounded border self-start"
                                        style={PRIORITY_STYLE[rec.priority] ?? {}}
                                    >
                                        {rec.priority}
                                    </span>
                                </div>
                            ))}


                        {!unlocked && gatedCount > 0 && (
                            <div
                                className="border-t px-5 py-5 flex flex-col sm:flex-row items-center justify-between gap-4"
                                style={{ borderColor: 'var(--brand-border)', background: 'var(--brand-muted)' }}
                            >
                                <div>
                                    <p className="text-sm font-bold text-foreground flex items-center gap-2">
                                        <Lock className="w-4 h-4" style={{ color: 'var(--brand)' }} />
                                        {gatedCount} more issues found
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Enter your email to unlock the full report — we&apos;ll send it to your inbox too.
                                    </p>
                                </div>
                                <form onSubmit={handleUnlock} className="flex gap-2 w-full sm:w-auto">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        required
                                        className="flex-1 sm:w-52 px-3 py-2 rounded-xl text-sm focus:outline-none"
                                        style={{
                                            background: 'var(--card)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--foreground)',
                                        }}
                                        onFocus={e => (e.currentTarget.style.borderColor = 'var(--brand)')}
                                        onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                                    />
                                    <button
                                        type="submit"
                                        disabled={unlocking}
                                        className="btn-brand px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap disabled:opacity-50"
                                    >
                                        {unlocking ? 'Sending…' : 'Unlock →'}
                                    </button>
                                </form>
                                {emailError && (
                                    <p className="text-xs w-full" style={{ color: '#ef4444' }}>{emailError}</p>
                                )}
                            </div>
                        )}


                        {unlocked && unlockedEmail && (
                            <div
                                className="border-t px-4 py-3 flex items-center gap-2"
                                style={{ borderColor: 'var(--brand-border)', background: 'rgba(16,185,129,0.06)' }}
                            >
                                <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--brand)' }} />
                                <p className="text-sm" style={{ color: 'var(--brand)' }}>
                                    Full report sent to <strong>{unlockedEmail}</strong>
                                </p>
                            </div>
                        )}
                    </div>
                </div>


                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 fade-in-up fade-in-up-3">


                    <div
                        className="rounded-2xl border overflow-hidden"
                        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                    >
                        <div
                            className="px-5 py-3 border-b flex items-center gap-2"
                            style={{ borderColor: 'var(--border)' }}
                        >
                            <TrendingUp className="w-4 h-4" style={{ color: 'var(--brand)' }} />
                            <h3 className="text-sm font-bold text-foreground">Quick Wins</h3>
                            <span className="text-xs text-muted-foreground">— highest impact, lowest effort</span>
                        </div>
                        {quickWins.map((rec, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-3 px-5 py-3 border-b last:border-0"
                                style={{ borderColor: 'var(--border)' }}
                            >
                                <span
                                    className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                                    style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                                >
                                    {i + 1}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-foreground">{rec.label}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{rec.finding}</p>
                                </div>
                                <span
                                    className="text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 mt-0.5"
                                    style={PRIORITY_STYLE[rec.priority] ?? {}}
                                >
                                    {rec.priority}
                                </span>
                            </div>
                        ))}
                    </div>


                    <div
                        className="rounded-2xl p-6 border flex flex-col items-center justify-center text-center"
                        style={{
                            background: 'linear-gradient(135deg, var(--brand-muted), rgba(59,130,246,0.08))',
                            borderColor: 'var(--brand-border)',
                        }}
                    >
                        <Sparkles className="w-7 h-7 mb-3" style={{ color: 'var(--brand)' }} />
                        <h2 className="text-base font-bold mb-1 text-foreground">Fix issues automatically</h2>
                        <p className="text-muted-foreground text-xs mb-4">
                            Track rankings, auto-fix issues, and get weekly AI-powered SEO reports.
                        </p>
                        <Link
                            href={`/signup?audit=${auditId}`}
                            className="btn-brand inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm w-full justify-center"
                            style={{ boxShadow: '0 0 20px rgba(16,185,129,0.3)' }}
                        >
                            Start fixing for free <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>

            </main>
        </div>
    );
}
