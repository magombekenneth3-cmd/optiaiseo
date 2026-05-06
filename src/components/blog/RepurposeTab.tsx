"use client";

import { useState, useCallback } from "react";
import {
    Linkedin,
    Twitter,
    Youtube,
    MessageSquare,
    Mic,
    Copy,
    Check,
    Download,
    ExternalLink,
    Loader2,
    Zap,
    X,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import type {
    RepurposedContent,
    RepurposeFormat,
    LinkedInArticle,
    TwitterThread,
    YouTubeScript,
    RedditPost,
    PodcastOutline,
} from "@/lib/blog/repurpose";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepurposeTabProps {
    blogId: string;
    blogTitle: string;
    blogSlug: string;
    onClose?: () => void;
}

type GenerateState =
    | { status: "idle" }
    | { status: "loading"; formats: RepurposeFormat[] }
    | { status: "done"; data: RepurposedContent; succeeded: RepurposeFormat[]; failed: RepurposeFormat[] }
    | { status: "error"; message: string };

// ─── Format config ────────────────────────────────────────────────────────────

const FORMAT_META: Record<RepurposeFormat, { label: string; icon: React.ElementType; color: string }> = {
    linkedin: { label: "LinkedIn", icon: Linkedin, color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
    thread:   { label: "X Thread", icon: Twitter,  color: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
    youtube:  { label: "YouTube",  icon: Youtube,  color: "text-red-400 border-red-500/30 bg-red-500/10" },
    reddit:   { label: "Reddit",   icon: MessageSquare, color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
    podcast:  { label: "Podcast",  icon: Mic,      color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
};

const ALL_FORMATS: RepurposeFormat[] = ["linkedin", "thread", "youtube", "reddit", "podcast"];

// ─── Copy / Download helpers ──────────────────────────────────────────────────

function useCopy() {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const copy = useCallback((text: string, key: string) => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    }, []);
    return { copy, copiedKey };
}

function downloadTxt(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Format Cards ─────────────────────────────────────────────────────────────

function CopyBtn({ text, label, copyKey, copiedKey, onCopy }: {
    text: string; label: string; copyKey: string;
    copiedKey: string | null; onCopy: (text: string, key: string) => void;
}) {
    const active = copiedKey === copyKey;
    return (
        <button
            onClick={() => onCopy(text, copyKey)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-muted hover:bg-card transition-all"
        >
            {active ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {active ? "Copied!" : label}
        </button>
    );
}

function LinkedInCard({ data }: { data: LinkedInArticle }) {
    const { copy, copiedKey } = useCopy();
    const full = `${data.title}\n\n${data.body}\n\n${(data.hashtags ?? []).map(h => `#${h}`).join(" ")}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <p className="font-semibold text-sm">{data.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        ~{data.estimatedReadMinutes} min read
                        {data.hashtags && data.hashtags.length > 0 && ` · ${data.hashtags.length} hashtags`}
                    </p>
                </div>
                <CopyBtn text={full} label="Copy article" copyKey="li-full" copiedKey={copiedKey} onCopy={copy} />
            </div>
            <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-4 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto font-sans">
                {data.body}
            </pre>
            {data.hashtags && data.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {data.hashtags.map(h => (
                        <span key={h} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            #{h}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function ThreadCard({ data }: { data: TwitterThread }) {
    const { copy, copiedKey } = useCopy();
    const all = data.tweets.join("\n\n---\n\n");
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground">{data.tweets.length} tweets</p>
                <CopyBtn text={all} label={`Copy all ${data.tweets.length} tweets`} copyKey="thread-all" copiedKey={copiedKey} onCopy={copy} />
            </div>
            <div className="flex flex-col gap-2">
                {data.tweets.map((t, i) => (
                    <div key={i} className="flex gap-3 items-start p-3 rounded-xl border border-border bg-muted/30">
                        <span className="w-5 h-5 rounded-full bg-sky-500/10 text-sky-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground/90 leading-relaxed">{t}</p>
                            <p className={`text-[10px] mt-1 ${t.length > 280 ? "text-rose-400" : "text-muted-foreground"}`}>
                                {t.length}/280 chars
                            </p>
                        </div>
                        <CopyBtn text={t} label="Copy" copyKey={`t-${i}`} copiedKey={copiedKey} onCopy={copy} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function YouTubeCard({ data, slug }: { data: YouTubeScript; slug: string }) {
    const { copy, copiedKey } = useCopy();
    const [showScript, setShowScript] = useState(false);
    const scriptContent = `${data.title}\n\n${data.script}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <p className="font-semibold text-sm">{data.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        ~{data.estimatedMinutes} min · {data.chapters.length} chapters
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <CopyBtn text={scriptContent} label="Copy script" copyKey="yt-script" copiedKey={copiedKey} onCopy={copy} />
                    <button
                        onClick={() => downloadTxt(`youtube-script-${slug}.txt`, scriptContent)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-muted hover:bg-card transition-all"
                    >
                        <Download className="w-3 h-3" /> .txt
                    </button>
                </div>
            </div>

            {/* Chapters */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {data.chapters.map((ch, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border text-xs">
                        <span className="text-muted-foreground font-mono shrink-0">{ch.time}</span>
                        <span className="text-foreground/80 truncate">{ch.title}</span>
                    </div>
                ))}
            </div>

            {/* Description */}
            <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Video Description</p>
                <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-3 whitespace-pre-wrap leading-relaxed font-sans">
                    {data.description}
                </pre>
            </div>

            {/* Script (collapsible) */}
            <button
                onClick={() => setShowScript(s => !s)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
            >
                {showScript ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showScript ? "Hide full script" : "Show full script"}
            </button>
            {showScript && (
                <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-4 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto font-sans">
                    {data.script}
                </pre>
            )}
        </div>
    );
}

function RedditCard({ data }: { data: RedditPost }) {
    const { copy, copiedKey } = useCopy();
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                        {data.subreddit}
                    </span>
                    <p className="font-semibold text-sm mt-1.5">{data.title}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <CopyBtn text={`${data.title}\n\n${data.body}`} label="Copy post" copyKey="reddit-body" copiedKey={copiedKey} onCopy={copy} />
                    <a
                        href={data.redditSubmitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-all"
                    >
                        <ExternalLink className="w-3 h-3" /> Open Reddit
                    </a>
                </div>
            </div>
            <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-4 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-sans">
                {data.body}
            </pre>
            <p className="text-[10px] text-muted-foreground">
                💡 Tip: Post this, then add your blog link in a comment — keeps the post authentic.
            </p>
        </div>
    );
}

function PodcastCard({ data, slug }: { data: PodcastOutline; slug: string }) {
    const { copy, copiedKey } = useCopy();
    const full = `${data.title}\n\n${data.outline}\n\n---\nSHOW NOTES\n\n${data.showNotes}`;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <p className="font-semibold text-sm">{data.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">~{data.estimatedMinutes} min episode</p>
                </div>
                <div className="flex items-center gap-2">
                    <CopyBtn text={full} label="Copy outline" copyKey="pod-full" copiedKey={copiedKey} onCopy={copy} />
                    <button
                        onClick={() => downloadTxt(`podcast-outline-${slug}.txt`, full)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-muted hover:bg-card transition-all"
                    >
                        <Download className="w-3 h-3" /> .txt
                    </button>
                </div>
            </div>
            <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Episode Outline</p>
                <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-4 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto font-sans">
                    {data.outline}
                </pre>
            </div>
            <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Show Notes</p>
                <pre className="text-xs text-foreground/80 bg-muted/50 border border-border rounded-xl p-3 whitespace-pre-wrap leading-relaxed font-sans">
                    {data.showNotes}
                </pre>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RepurposeTab({ blogId, blogTitle, blogSlug, onClose }: RepurposeTabProps) {
    const [state, setState] = useState<GenerateState>({ status: "idle" });
    const [activeFormat, setActiveFormat] = useState<RepurposeFormat>("linkedin");

    const generate = useCallback(async (formats: RepurposeFormat[]) => {
        setState({ status: "loading", formats });
        try {
            const res = await fetch(`/api/blogs/${blogId}/repurpose`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ formats }),
            });
            const data = await res.json();
            if (!res.ok) {
                setState({ status: "error", message: data.error ?? `Error ${res.status}` });
                return;
            }
            setState({
                status: "done",
                data,
                succeeded: data.meta?.succeeded ?? [],
                failed: data.meta?.failed ?? [],
            });
            // Jump to first succeeded format
            const first = (data.meta?.succeeded as RepurposeFormat[])?.[0];
            if (first) setActiveFormat(first);
        } catch {
            setState({ status: "error", message: "Network error — please try again." });
        }
    }, [blogId]);

    const resultData = state.status === "done" ? state.data : null;
    const succeeded = state.status === "done" ? state.succeeded : [];

    return (
        <div className="flex flex-col gap-0 bg-card rounded-2xl border border-border overflow-hidden shadow-xl w-full max-w-2xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-border bg-muted/20">
                <div>
                    <p className="font-bold text-sm flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        Repurpose Content
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{blogTitle}</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Format selector bar */}
            <div className="flex items-center gap-2 px-5 pt-4 flex-wrap">
                {ALL_FORMATS.map((fmt) => {
                    const meta = FORMAT_META[fmt];
                    const Icon = meta.icon;
                    const isSucceeded = succeeded.includes(fmt);
                    const isActive = activeFormat === fmt;
                    return (
                        <button
                            key={fmt}
                            id={`repurpose-tab-${fmt}`}
                            onClick={() => {
                                setActiveFormat(fmt);
                                if (!isSucceeded && state.status !== "loading") {
                                    generate([fmt]);
                                }
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                                isActive
                                    ? meta.color + " ring-1 ring-current"
                                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {meta.label}
                            {isSucceeded && <span className="text-emerald-400">✓</span>}
                        </button>
                    );
                })}
            </div>

            {/* Generate all button */}
            {state.status !== "loading" && (
                <div className="px-5 pt-3">
                    <button
                        id="repurpose-generate-all"
                        onClick={() => generate(ALL_FORMATS)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-all disabled:opacity-40"
                    >
                        <Zap className="w-3.5 h-3.5" />
                        Generate all 5 formats
                    </button>
                </div>
            )}

            {/* Content area */}
            <div className="p-5 min-h-[200px]">
                {/* Idle */}
                {state.status === "idle" && (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                        <Zap className="w-8 h-8 text-amber-400 opacity-50" />
                        <p className="text-sm text-muted-foreground">
                            Click a format above to generate, or use "Generate all 5" to run everything at once.
                        </p>
                        <p className="text-xs text-muted-foreground/60">Takes ~8–15 seconds per format.</p>
                    </div>
                )}

                {/* Loading */}
                {state.status === "loading" && (
                    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                        <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                        <p className="text-sm font-semibold">Generating {state.formats.length > 1 ? `${state.formats.length} formats` : FORMAT_META[state.formats[0]].label}…</p>
                        <p className="text-xs text-muted-foreground">
                            {state.formats.length > 1
                                ? "Running in parallel — usually 10–20 seconds total."
                                : "Usually takes ~8 seconds."}
                        </p>
                    </div>
                )}

                {/* Error */}
                {state.status === "error" && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-400">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold mb-0.5">Generation failed</p>
                            <p className="text-xs text-rose-400/80">{state.message}</p>
                            <button
                                onClick={() => setState({ status: "idle" })}
                                className="mt-2 text-xs underline hover:no-underline text-muted-foreground"
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                )}

                {/* Results */}
                {state.status === "done" && resultData && (
                    <>
                        {/* Failed formats warning */}
                        {state.failed.length > 0 && (
                            <div className="mb-4 flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                    {state.failed.map(f => FORMAT_META[f].label).join(", ")} failed to generate.{" "}
                                    <button
                                        onClick={() => generate(state.failed)}
                                        className="underline hover:no-underline"
                                    >
                                        Retry failed
                                    </button>
                                </span>
                            </div>
                        )}

                        {/* Active format content */}
                        {activeFormat === "linkedin" && resultData.linkedin && (
                            <LinkedInCard data={resultData.linkedin} />
                        )}
                        {activeFormat === "thread" && resultData.thread && (
                            <ThreadCard data={resultData.thread} />
                        )}
                        {activeFormat === "youtube" && resultData.youtube && (
                            <YouTubeCard data={resultData.youtube} slug={blogSlug} />
                        )}
                        {activeFormat === "reddit" && resultData.reddit && (
                            <RedditCard data={resultData.reddit} />
                        )}
                        {activeFormat === "podcast" && resultData.podcast && (
                            <PodcastCard data={resultData.podcast} slug={blogSlug} />
                        )}

                        {/* Not yet generated for active format */}
                        {!resultData[activeFormat] && !state.failed.includes(activeFormat) && (
                            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    {FORMAT_META[activeFormat].label} not generated yet.
                                </p>
                                <button
                                    onClick={() => generate([activeFormat])}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted border border-border text-xs font-semibold hover:bg-card transition-all"
                                >
                                    <Zap className="w-3.5 h-3.5" />
                                    Generate {FORMAT_META[activeFormat].label}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
