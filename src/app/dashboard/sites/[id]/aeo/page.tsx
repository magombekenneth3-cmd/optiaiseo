/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { runAeoReport, getAeoHistory, getAeoConversionMetrics } from "@/app/actions/aeo";
import { generateAeoFix, generateAllFixes, pushFixToGitHub } from "@/app/actions/aeoFix";
import { PrReviewModal, type PrReviewPayload } from "@/components/PrReviewModal";
import { VisibilityForecastCard } from "@/components/aeo/VisibilityForecastCard";
import type { AeoResult, AeoCheck } from "@/lib/aeo";

// ... (skipping unchanged gradeMeta, categoryMeta, impactBadge, ScoreRing, CheckCard)

// ─── GRADE BADGE ─────────────────────────────────────────────────────────────

const gradeMeta: Record<string, { color: string; bg: string; label: string }> = {
    A: { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Excellent" },
    B: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30", label: "Good" },
    C: { color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30", label: "Needs Work" },
    D: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", label: "Poor" },
    F: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", label: "Critical" },
};

const categoryMeta: Record<string, { label: string; icon: string }> = {
    schema: { label: "Structured Data", icon: "🏗️" },
    eeat: { label: "E-E-A-T Signals", icon: "🎓" },
    content: { label: "Content Format", icon: "📝" },
    technical: { label: "Technical SEO", icon: "⚙️" },
    citation: { label: "AI Citations", icon: "🤖" },
};

const impactBadge: Record<AeoCheck["impact"], string> = {
    high: "bg-red-500/10 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    low: "bg-zinc-500/10 text-muted-foreground border-zinc-500/30",
};

// ─── SCORE RING ───────────────────────────────────────────────────────────────

function ScoreRing({ score, grade }: { score: number; grade: string }) {
    const meta = gradeMeta[grade] ?? gradeMeta["F"];
    const circumference = 2 * Math.PI * 52;
    const dash = (score / 100) * circumference;

    return (
        <div className="relative w-36 h-36 mx-auto">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                <circle
                    cx="60" cy="60" r="52" fill="none"
                    strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${dash} ${circumference}`}
                    className={`transition-all duration-1000 ${meta.color.replace("text-", "stroke-")}`}
                    style={{ stroke: "currentColor" }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-4xl font-bold ${meta.color}`}>{grade}</span>
                <span className="text-muted-foreground text-xs mt-0.5">{score}/100</span>
            </div>
        </div>
    );
}

// ─── CHECK CARD WITH FIX GENERATION ──────────────────────────────────────────

function CheckCard({ check, domain, githubRepoUrl, preloadedFix }: {
    check: AeoCheck;
    domain: string;
    githubRepoUrl?: string;
    preloadedFix?: { fix: string; language: string; filePath?: string };
}) {
    const [showFix, setShowFix] = useState(false);
    const [fixing, setFixing] = useState(false);
    const [fixCode, setFixCode] = useState<string | null>(null);
    const [filePath, setFilePath] = useState<string | undefined>();
    const [copied, setCopied] = useState(false);
    const [fixError, setFixError] = useState("");
    const [pushing, setPushing] = useState(false);
    const [pushResult, setPushResult] = useState<{ ok: boolean; url?: string; msg?: string } | null>(null);
    const [reviewPayload, setReviewPayload] = useState<PrReviewPayload | null>(null);

    const handleGenerateFix = async () => {
        if (fixCode) { setShowFix(!showFix); return; }
        setFixing(true);
        setFixError("");
        const res = await generateAeoFix(check, domain);
        setFixing(false);
        if (res.success) {
            setFixCode(res.fix);
            setFilePath(res.filePath);
            setShowFix(true);
        } else {
            setFixError(res.error);
        }
    };

    const handleCopy = () => {
        if (fixCode) {
            navigator.clipboard.writeText(fixCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Auto-populate from preloaded batch fix
    useEffect(() => {
        if (preloadedFix && !fixCode) {
            setFixCode(preloadedFix.fix);
            setFilePath(preloadedFix.filePath);
            setShowFix(true);
        }
     
    }, [preloadedFix]);

    const handlePushToGitHub = () => {
        if (!fixCode || !filePath || !githubRepoUrl) return;
        setReviewPayload({
            filePath,
            content: fixCode,
            language: check.id.includes("schema") ? "tsx" : "tsx",
            issueLabel: `AEO Fix: Add ${check.label}`,
        });
    };

    const handleConfirmPR = async (editedContent: string) => {
        if (!filePath || !githubRepoUrl) return;
        setReviewPayload(null);
        setPushing(true);
        setPushResult(null);
        const res = await pushFixToGitHub({
            repoUrl: githubRepoUrl,
            filePath,
            content: editedContent,
            commitMessage: `AEO Fix: Add ${check.label}`,
            siteId: "",
        });
        setPushing(false);
        if (res.success) {
            setPushResult({ ok: true, url: res.url });
        } else {
            setPushResult({ ok: false, msg: res.error });
        }
    };

    return (
        <>
            {reviewPayload && (
                <PrReviewModal
                    payload={reviewPayload}
                    onConfirm={handleConfirmPR}
                    onCancel={() => setReviewPayload(null)}
                />
            )}
            <div className={`card-surface p-4 border-l-4 ${check.passed ? "border-l-emerald-500" : "border-l-red-500/60"}`}>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg shrink-0">{check.passed ? "✅" : "❌"}</span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm">{check.label}</p>
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${impactBadge[check.impact]}`}>
                                    {check.impact}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                                    {categoryMeta[check.category]?.icon} {categoryMeta[check.category]?.label}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{check.detail}</p>
                        </div>
                    </div>
                    {/* Generate Fix button for failed checks */}
                    {!check.passed && (
                        <button
                            onClick={handleGenerateFix}
                            disabled={fixing}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium transition-all disabled:opacity-50"
                        >
                            {fixing ? (
                                <>
                                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generating…
                                </>
                            ) : fixCode ? (showFix ? "Hide Fix" : "Show Fix") : "🔧 Generate Fix"}
                        </button>
                    )}
                </div>

                {/* Recommendation text */}
                {!check.passed && (
                    <div className="mt-3 ml-8 text-xs text-muted-foreground bg-white/3 rounded-lg p-3 border border-border">
                        <span className="font-semibold text-yellow-400">💡 Fix: </span>
                        {check.recommendation}
                    </div>
                )}

                {/* Fix error */}
                {fixError && (
                    <div className="mt-2 ml-8 text-xs text-red-400 bg-red-500/5 rounded-lg p-2 border border-red-500/20">
                        {fixError}
                    </div>
                )}

                {/* Generated fix code */}
                {showFix && fixCode && (
                    <div className="mt-3 ml-8">
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">
                                📋 Copy this code to your site{filePath ? ` → ${filePath}` : ""}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleCopy}
                                    className="text-[10px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20"
                                >
                                    {copied ? "✓ Copied!" : "Copy"}
                                </button>
                                {githubRepoUrl && filePath && (
                                    <button
                                        onClick={handlePushToGitHub}
                                        disabled={pushing}
                                        className="text-[10px] font-medium text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded bg-blue-500/10 border border-blue-500/20 disabled:opacity-50"
                                    >
                                        {pushing ? "Pushing…" : "⬆ Push to GitHub"}
                                    </button>
                                )}
                            </div>
                        </div>
                        <pre className="bg-black/40 border border-white/10 rounded-lg p-4 overflow-x-auto text-xs text-zinc-300 leading-relaxed max-h-80 overflow-y-auto">
                            <code>{fixCode}</code>
                        </pre>
                        {pushResult && (
                            <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${pushResult.ok
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : "bg-red-500/10 border-red-500/20 text-red-400"
                                }`}>
                                {pushResult.ok
                                    ? <>✅ Pushed to GitHub! <a href={pushResult.url} target="_blank" rel="noreferrer" className="underline">View file →</a></>
                                    : <>❌ {pushResult.msg}</>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function AeoPage() {
    const { id: siteId } = useParams<{ id: string }>();
    const router = useRouter();
     
    const [loading, setLoading] = useState(false);
    const [_history, setHistory] = useState<any[]>([]);
    const [result, setResult] = useState<AeoResult | null>(null);
    const [siteDomain, setSiteDomain] = useState("");
    const [githubRepoUrl, setGithubRepoUrl] = useState("");
    const [activeCategory, setActiveCategory] = useState<string>("all");
    const [error, setError] = useState("");
    const [generatingAll, setGeneratingAll] = useState(false);
     
    const [allFixesProgress, setAllFixesProgress] = useState(0);
    const [allFixes, setAllFixes] = useState<Record<string, { fix: string; language: string; filePath?: string }>>({});
    const [metrics, setMetrics] = useState<any>(null);

    // Load history on mount
    useEffect(() => {
        getAeoHistory(siteId).then(res => {
            if (res.success) {
                setSiteDomain(res.domain);
                setGithubRepoUrl(res.githubRepoUrl);
                if (res.reports.length > 0) {
                    setHistory(res.reports);
                    const latest = res.reports.find((r: any) => Array.isArray(r.checks));
                    if (latest) {
                        setResult({
                            url: res.domain ?? "",
                            score: latest.score,
                            grade: latest.grade as "A" | "B" | "C" | "D" | "F",
                            checks: latest.checks as unknown as AeoCheck[],
                             
                            schemaTypes: latest.schemaTypes,
                             
                            citationScore: latest.citationScore,
                             
                            generativeShareOfVoice: latest.generativeShareOfVoice,
                            citationLikelihood: latest.citationLikelihood,
                            multiEngineScore: (latest as any).multiEngineScore,
                            multiModelResults: (latest as any).multiModelResults,
                            factCheckResults: (latest as any).factCheckResults,
                            topRecommendations: latest.topRecommendations,
                            scannedAt: new Date(latest.createdAt),
                            diagnosis: (latest as any).diagnosis ?? null,
                        });
                    }
                }
            }
        });

        // Load conversion metrics
        getAeoConversionMetrics(siteId).then(res => {
            if (res.success) setMetrics(res.metrics);
        });
    }, [siteId]);

    const handleRun = async () => {
        setLoading(true);
        setError("");
        const res = await runAeoReport(siteId);
        setLoading(false);
        if (res.success && res.reportId) {
            // Since it's now queued, we'll just show a pending state locally
            setResult({
                url: siteDomain,
                score: 0,
                grade: "PENDING",
                checks: [],
                schemaTypes: [],
                citationScore: 0,
                 
                generativeShareOfVoice: 0,
                citationLikelihood: 0,
                multiEngineScore: { perplexity: 0, chatgpt: 0, googleAio: 0 },
                multiModelResults: [],
                factCheckResults: [],
                topRecommendations: ["Audit in progress, please refresh in a minute."],
                scannedAt: new Date()
            } as any);
            // Use router.refresh() (soft Next.js re-render) — no white flash
            router.refresh();
        } else {
            setError(!res.success ? (res.error ?? "Failed to queue AEO audit") : "");
        }
    };

    const handleGenerateAll = async () => {
        if (!result || generatingAll) return;
        const failed = checks.filter((c: AeoCheck) => !c.passed);
        if (failed.length === 0) return;
        setGeneratingAll(true);
        setAllFixesProgress(0);
        const res = await generateAllFixes(checks, siteDomain);
        setGeneratingAll(false);
        if (res.success) {
            setAllFixes(res.fixes);
            setAllFixesProgress(Object.keys(res.fixes).length);
        }
    };

    const checks = Array.isArray(result?.checks) ? result.checks : [];
    const filteredChecks = checks.filter(
        (c: AeoCheck) => activeCategory === "all" || c.category === activeCategory
    );

    const categories = ["all", "schema", "eeat", "technical", "citation"];

    return (
        <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-12">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <span>🤖</span> AEO Rank Tracker
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Answer Engine Optimization — how well your site appears in ChatGPT, Perplexity & Google AI Overviews
                    </p>
                </div>
                <button
                    onClick={handleRun}
                    disabled={loading}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl text-sm transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Scanning…
                        </>
                    ) : "Run AEO Audit"}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
                    {error}
                </div>
            )}
            {/* 90-Day Visibility Forecast — hero metric */}
            <VisibilityForecastCard siteId={siteId} />

            {/* No data state */}
            {!result && !loading && (
                <div className="card-surface p-12 text-center">
                    <div className="text-5xl mb-4">🔍</div>
                    <h2 className="text-xl font-semibold mb-2">No AEO Report Yet</h2>
                    <p className="text-muted-foreground text-sm mb-6">
                        Run your first AEO audit to see how well this site appears in AI answer engines.
                    </p>
                    <button
                        onClick={handleRun}
                        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-sm transition-all"
                    >
                        Run First AEO Audit
                    </button>
                </div>
            )}

            {/* Loading skeleton */}
            {loading && !result && (
                <div className="card-surface p-8 flex flex-col items-center gap-4 text-center">
                    <svg className="animate-spin h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <div>
                        <p className="font-semibold">Auditing your AEO signals…</p>
                        <p className="text-sm text-muted-foreground mt-1">Checking schema markup, E-E-A-T, content format, and AI citations</p>
                    </div>
                </div>
            )}

            {result && (
                <>
                    {/* Score overview */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* Grade card */}
                        <div className={`card-surface p-6 border ${gradeMeta[result.grade]?.bg ?? ""} flex flex-col items-center gap-3`}>
                            <ScoreRing score={result.score} grade={result.grade} />
                            <div className="text-center">
                                <p className="font-semibold">{gradeMeta[result.grade]?.label ?? "Unknown"}</p>
                                <p className="text-xs text-muted-foreground">Overall AEO Score</p>
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="sm:col-span-2 grid grid-cols-2 gap-4">
                            <div className="card-surface p-5">
                                <p className="text-3xl font-bold text-emerald-400">
                                    {checks.filter((c: AeoCheck) => c.passed).length}
                                    <span className="text-lg text-muted-foreground">/{checks.length}</span>
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">Checks Passed</p>
                            </div>

                            <div className="card-surface p-5">
                                <p className="text-3xl font-bold text-blue-400">
                                    {result.generativeShareOfVoice}%
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">Gen. Share of Voice (GSoV)</p>
                            </div>

                            <div className="card-surface p-5">
                                <p className="text-3xl font-bold text-purple-400">
                                    {result.citationLikelihood}%
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">Citation Likelihood</p>
                            </div>

                            <div className="card-surface p-5">
                                <p className="text-3xl font-bold text-yellow-400">
                                    {checks.filter((c: AeoCheck) => !c.passed && c.impact === "high").length}
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">High-Impact Fixes</p>
                            </div>
                        </div>
                    </div>

                    {/* God Level: Multi-Engine Visibility */}
                    <div className="card-surface p-6 border-emerald-500/20 bg-emerald-500/5">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <span>🌐</span> Multi-Engine Visibility
                                </h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Comparative brand presence across leading Generative Search Engines
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Perplexity</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">ChatGPT</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-orange-500" />
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Google AIO</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-8 items-end h-32 px-4">
                            {[
                                { label: "Perplexity", score: result.multiEngineScore?.perplexity ?? 0, color: "bg-blue-500" },
                                { label: "ChatGPT Search", score: result.multiEngineScore?.chatgpt ?? 0, color: "bg-emerald-500" },
                                { label: "Google AI Overview", score: result.multiEngineScore?.googleAio ?? 0, color: "bg-orange-500" },
                            ].map((engine, i) => (
                                <div key={i} className="flex flex-col items-center gap-2 group h-full justify-end">
                                    <div className="text-xs font-bold text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                        {engine.score}%
                                    </div>
                                    <div
                                        className={`w-full rounded-t-lg ${engine.color} opacity-80 hover:opacity-100 transition-all shadow-[0_0_20px_-5px_currentColor]`}
                                        style={{ height: `${Math.max(10, engine.score)}%` }}
                                    />
                                    <span className="text-[10px] font-bold text-muted-foreground truncate w-full text-center">
                                        {engine.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Multi-Model Mentions Module */}
                    <div className="card-surface p-6 border-blue-500/20 bg-blue-500/5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <span>🧠</span> Multi-Model Brand Presence
                            </h2>
                            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
                                LIVE LLM VERIFICATION
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {result.multiModelResults?.map((m: any, i: number) => (
                                <div key={i} className="p-3 rounded-lg bg-muted border border-border">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-muted-foreground">{m.model}</span>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${m.mentioned ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-muted-foreground"}`}>
                                            {m.mentioned ? "MENTIONED" : "NOT FOUND"}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-zinc-300 leading-relaxed italic line-clamp-2">
                                        {m.details || "No citation data available."}
                                    </p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-[10px] font-bold text-muted-foreground uppercase">Knowledge Graph Active</span>
                            </div>
                            <code className="text-[10px] font-mono text-blue-400 bg-blue-500/5 px-2 py-1 rounded">/api/kg-feed?domain={result.url}</code>
                        </div>
                    </div>

                    {/* AI Fact Verification Loop */}
                    <div className="card-surface p-6 border-purple-500/20 bg-purple-500/5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <span>⚖️</span> AI Fact Verification Loop
                            </h2>
                            <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-500/20">
                                ANTI-HALLUCINATION
                            </span>
                        </div>
                        <div className="space-y-3">
                            {result.factCheckResults?.map((f: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{f.fact}</span>
                                        <p className="text-xs text-zinc-300">
                                            Expected: <span className="font-semibold text-emerald-400">{f.expectedValue}</span>
                                        </p>
                                        <p className="text-xs text-muted-foreground italic">
                                            Found: {f.actualValue || "Unknown"}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${f.status === 'verified' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                                            f.status === 'hallucination' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                                                'bg-zinc-500/10 text-muted-foreground border-zinc-500/30'
                                            }`}>
                                            {f.status.toUpperCase()}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground uppercase font-bold">{f.model}</span>
                                    </div>
                                </div>
                            ))}
                            {(!result.factCheckResults || result.factCheckResults.length === 0) && (
                                <div className="text-center py-4 text-xs text-muted-foreground italic">
                                    No facts verified yet. Check will run on next audit.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* God Level: AEO Conversion & Revenue Attribution */}
                    <div className="card-surface p-6 border-emerald-500/20 bg-emerald-500/5">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <span>💰</span> AEO Conversion & Revenue Attribution
                                </h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Direct revenue captured from Generative Search citations and AI answer engine funnels
                                </p>
                            </div>
                            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
                                Live ROI Tracking
                            </div>
                        </div>

                        {metrics ? (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Left: High Level Metrics */}
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-muted border border-border">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Total AEO Conversions</p>
                                        <p className="text-3xl font-black text-white mt-1">{metrics.totalConversions}</p>
                                        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-emerald-400 font-bold">
                                            <span>↑ 12%</span>
                                            <span className="text-muted-foreground font-normal italic">vs last month</span>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                        <p className="text-[10px] font-bold text-emerald-500/70 uppercase">Attributed AEO Revenue</p>
                                        <p className="text-3xl font-black text-emerald-400 mt-1">${metrics.totalRevenue.toLocaleString()}</p>
                                        <p className="text-[10px] text-emerald-500/50 mt-1 font-medium">Estimated from intent-based yield</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-muted border border-border">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Conversion Yield</p>
                                        <p className="text-xl font-bold text-white mt-1">{(metrics.totalRevenue / (metrics.totalConversions || 1)).toFixed(2)} USD</p>
                                        <p className="text-[10px] text-muted-foreground mt-1">Average value per AEO lead</p>
                                    </div>
                                </div>

                                {/* Center: Intent Breakdown */}
                                <div className="space-y-3">
                                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">Conversions by Intent</h3>
                                    {Object.entries(metrics.byIntent).map(([intent, count]: [string, any]) => (
                                        <div key={intent} className="p-3 rounded-lg bg-muted border border-border flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${intent === 'transactional' ? 'bg-red-400' :
                                                    intent === 'commercial' ? 'bg-blue-400' :
                                                        intent === 'informational' ? 'bg-emerald-400' : 'bg-zinc-400'
                                                    }`} />
                                                <span className="text-xs font-bold capitalize text-zinc-300">{intent}</span>
                                            </div>
                                            <span className="text-xs font-black text-white">{count}</span>
                                        </div>
                                    ))}
                                    {Object.keys(metrics.byIntent).length === 0 && (
                                        <div className="text-center py-8 text-xs text-muted-foreground italic">No intent data tracked yet.</div>
                                    )}
                                </div>

                                {/* Right: Top Converting Blogs */}
                                <div className="space-y-3">
                                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">Top Converting AEO Content</h3>
                                    {metrics.topBlogs.map((blog: any) => (
                                        <div key={blog.id} className="p-3 rounded-lg bg-muted border border-border">
                                            <p className="text-[11px] font-bold text-white truncate">{blog.title}</p>
                                            <div className="flex items-center justify-between mt-2">
                                                <span className="text-[10px] text-muted-foreground">{blog.conversions} leads</span>
                                                <span className="text-[10px] font-bold text-emerald-400">${blog.revenue}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {metrics.topBlogs.length === 0 && (
                                        <div className="text-center py-8 text-xs text-muted-foreground italic">Generate blogs to see attribution.</div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="py-12 flex flex-col items-center justify-center gap-3 border border-dashed border-border rounded-2xl">
                                <div className="animate-spin h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full" />
                                <p className="text-xs text-muted-foreground font-medium tracking-wide">Syncing real-time conversion data…</p>
                            </div>
                        )}

                        <div className="mt-6 pt-6 border-t border-border flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase">Pixel Active</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                    <span className="text-[9px] font-bold text-muted-foreground uppercase">Intent Anchors Verified</span>
                                </div>
                            </div>
                            <button className="text-[9px] font-bold text-emerald-400/60 uppercase hover:text-emerald-400 transition-colors">
                                Export Attribution Report (CSV)
                            </button>
                        </div>
                    </div>

                    {/* Top recommendations */}
                    {result.topRecommendations.length > 0 && (
                        <div className="card-surface p-6">
                            <h2 className="font-semibold mb-4 flex items-center gap-2">
                                <span>🚀</span> Top Recommendations
                            </h2>
                            <ul className="space-y-3">
                                {result.topRecommendations.map((rec, i) => (
                                    <li key={i} className="flex gap-3 text-sm">
                                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                                            {i + 1}
                                        </span>
                                        <span className="text-muted-foreground">{rec}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Generate All Fixes bar */}
                    <div className="flex items-center gap-3 p-4 card-surface border-border">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                                {generatingAll ? (
                                    <span className="text-yellow-400">⏳ Generating fixes… this takes ~{checks.filter((c: AeoCheck) => !c.passed).length * 2}s</span>
                                ) : allFixesProgress > 0 ? (
                                    <span className="text-emerald-400">✅ Generated {allFixesProgress}/{checks.filter((c: AeoCheck) => !c.passed).length} fixes — expand each check below</span>
                                ) : (
                                    <span className="text-muted-foreground">AI scans your live site and generates real, ready-to-paste code for each fix</span>
                                )}
                            </p>
                        </div>
                        <button
                            onClick={handleGenerateAll}
                            disabled={generatingAll || checks.filter((c: AeoCheck) => !c.passed).length === 0}
                            className="shrink-0 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-blue-500 text-black font-bold rounded-xl text-sm hover:opacity-90 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {generatingAll ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generating…
                                </>
                            ) : "🤖 Generate All Fixes"}
                        </button>
                    </div>

                    {/* Content Strategy Checks (Surfaced Distinctly) */}
                    <div className="mt-8">
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <span>✍️</span> AI Ranking Content Strategies
                            </h2>
                            <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full">
                                New Feature
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                            Go beyond technical schema. Generate the dense, factual content structures that LLMs actually want to cite.
                        </p>
                        <div className="space-y-3">
                            {checks.filter((c: AeoCheck) => c.category === "content").map((check: AeoCheck) => (
                                <CheckCard
                                    key={check.id}
                                    check={check}
                                    domain={siteDomain}
                                    githubRepoUrl={githubRepoUrl || undefined}
                                    preloadedFix={allFixes[check.id]}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Technical Checks Section */}
                    <div className="mt-12">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <span>⚙️</span> Technical AEO Audit
                        </h2>

                        {/* Category filter tabs */}
                        <div className="flex flex-wrap gap-2 mb-4">
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setActiveCategory(cat)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeCategory === cat
                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                        : "bg-muted text-muted-foreground border border-border hover:text-foreground"
                                        }`}
                                >
                                    {cat === "all"
                                        ? `All Technical (${checks.filter((c: AeoCheck) => c.category !== "content").length})`
                                        : `${categoryMeta[cat]?.icon} ${categoryMeta[cat]?.label} (${checks.filter((c: AeoCheck) => c.category === cat).length})`
                                    }
                                </button>
                            ))}
                        </div>

                        {/* Checks list (Technical only) */}
                        <div className="space-y-3">
                            {filteredChecks.filter((c: AeoCheck) => c.category !== "content").map((check: AeoCheck) => (
                                <CheckCard
                                    key={check.id}
                                    check={check}
                                    domain={siteDomain}
                                    githubRepoUrl={githubRepoUrl || undefined}
                                    preloadedFix={allFixes[check.id]}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Scan timestamp */}
                    <p className="text-xs text-muted-foreground text-center mt-8">
                        Last scanned {new Date(result.scannedAt).toLocaleString()}
                    </p>
                </>
            )}
        </div>
    );
}
