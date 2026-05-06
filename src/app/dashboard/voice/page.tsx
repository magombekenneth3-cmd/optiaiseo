/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import { logger } from "@/lib/logger";
import Link from "next/link";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
    useAgent, useSessionMessages, useSession, StartAudio,
    RoomAudioRenderer, AudioTrack, useTracks,
} from "@livekit/components-react";
import { AgentSessionProvider, useAgentSession } from "@/components/agents-ui/agent-session-provider";
import { TokenSource, Track, RoomEvent, ConnectionState } from "livekit-client";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";
import { AgentAudioVisualizerAura } from "@/components/agents-ui/agent-audio-visualizer-aura";
import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript";
import { AgentDisconnectButton } from "@/components/agents-ui/agent-disconnect-button";
import { AgentTrackControl } from "@/components/agents-ui/agent-track-control";
import {
    Activity, Sparkles, Zap, Search, ArrowRight, Bot, Target,
    AlertCircle, ImageIcon, X, Globe, ChevronDown, CheckCircle2,
} from "lucide-react";
import "@livekit/components-styles";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import {
    AgentStoreProvider, useAgentStore, ChartPayload,
    KeywordBarRow, CompetitorBarRow, NlpRadarRow,
} from "@/store/agent-store";
import { DashboardErrorBoundary } from "@/components/dashboard/ErrorBoundary";
import { TalkingRobot } from "./TalkingRobot";
import { SuggestionChips } from "./SuggestionChips";
import ActionLog from "./ActionLog";
import { useAgentDataChannel } from "@/hooks/use-agent-data-channel";
import { getVoiceMetrics } from "@/app/actions/voice-metrics";
import { getUserSites } from "@/app/actions/site";

type TokenDetails = { token: string; url: string; room: string };
type SiteOption   = { id: string; domain: string; lastAuditScore?: number | null };

// ─── Site Picker ──────────────────────────────────────────────────────────────
function SitePicker({
    sites,
    selected,
    onSelect,
    disabled,
}: {
    sites: SiteOption[];
    selected: SiteOption | null;
    onSelect: (site: SiteOption) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);

    if (sites.length === 0) {
        return (
            <Link
                href="/dashboard/sites/new"
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-border bg-muted/30 text-sm text-muted-foreground hover:text-white hover:border-indigo-500/40 transition-colors"
            >
                <Globe className="w-4 h-4 shrink-0" />
                No sites yet — add one to start
            </Link>
        );
    }

    if (sites.length === 1) {
        return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 text-sm">
                <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="font-medium text-white flex-1">{sites[0].domain}</span>
                <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            </div>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card/60 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="flex-1 text-left font-medium text-white truncate">
                    {selected ? selected.domain : "Choose a site to discuss…"}
                </span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
                    {sites.map(site => (
                        <button
                            key={site.id}
                            onClick={() => { onSelect(site); setOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-indigo-500/10 transition-colors text-left
                                ${selected?.id === site.id ? "bg-indigo-500/10 text-indigo-300" : "text-zinc-300"}`}
                        >
                            <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate font-medium">{site.domain}</span>
                            {site.lastAuditScore != null && (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                                    ${site.lastAuditScore >= 80 ? "bg-emerald-500/10 text-emerald-400"
                                    : site.lastAuditScore >= 50 ? "bg-amber-500/10 text-amber-400"
                                    : "bg-red-500/10 text-red-400"}`}>
                                    {site.lastAuditScore}
                                </span>
                            )}
                            {selected?.id === site.id && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Context Canvas ───────────────────────────────────────────────────────────
function ContextCanvas({ isConnected }: { isConnected: boolean }) {
    const { state } = useAgentStore();

    if (!isConnected) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 bg-card/40 rounded-3xl border border-border relative overflow-hidden h-full">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-emerald-500/5 opacity-50" />
                <div className="relative z-10 flex flex-col items-center text-center max-w-sm">
                    <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center mb-6 shadow-2xl">
                        <Activity className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">Workspace Idle</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Select a site and activate the AI Assistant to unlock the AI Insights feed and live analysis charts.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col p-6 bg-card/80 backdrop-blur-xl rounded-3xl border border-border relative overflow-hidden shadow-2xl gap-5 h-full">
            {state.awaitingUserInput && (
                <div className="relative z-50 bg-emerald-600/10 border border-emerald-500/20 text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-3 shrink-0">
                    <svg className="w-4 h-4 animate-pulse text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                    </svg>
                    <div>
                        <div className="text-xs font-bold">Waiting for your URL</div>
                        <div className="text-xs text-muted-foreground">Say the full URL or say &quot;add site&quot; and give me the URL.</div>
                    </div>
                </div>
            )}
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

            <div className="relative z-10 flex-1 min-h-0 shrink [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] -mx-4 px-4 overflow-hidden">
                <ActionLog logs={state.toolLog} isProcessing={state.isProcessing} className="h-full" />
            </div>

            <div className="shrink-0 space-y-3 relative z-10">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" /> Analysis Pipeline
                </h3>
                <div className="bg-card rounded-2xl border border-border py-3 relative overflow-hidden">
                    <div className="flex items-center gap-3 overflow-x-auto px-4 pb-2 pt-1">
                        {state.toolLog.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                </span>
                                {state.domain ? `Ready to analyse ${state.domain}` : "Waiting for target..."}
                            </div>
                        ) : (
                            state.toolLog.map((log, i) => {
                                const isExecuting = i === state.toolLog.length - 1 && state.isProcessing;
                                return (
                                    <div key={i} className={`flex items-center gap-2 shrink-0 ${isExecuting ? "text-indigo-400" : "text-muted-foreground"}`}>
                                        <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${isExecuting ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "bg-muted text-muted-foreground"}`}>
                                            {i + 1}
                                        </div>
                                        <span className="text-xs font-mono">{log.replace(/^>\s*/, "").replace(/\.\.\.$/, "")}</span>
                                        {i < state.toolLog.length - 1 && <span className="text-zinc-700 ml-2">→</span>}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 flex gap-6 min-h-0 relative z-10">
                <div className="w-1/2 flex flex-col gap-3 overflow-y-auto custom-scrollbar pr-2">
                    <h3 className="text-sm font-bold text-foreground sticky top-0 bg-transparent py-1">AI Insights</h3>
                    {state.insights && state.insights.length > 0 ? (
                        state.insights.map((insight, idx) => {
                            const isSeo      = insight.type === "seo";
                            const bgClass    = isSeo ? "bg-emerald-500/10 border-emerald-500/20" : "bg-indigo-500/10 border-indigo-500/20";
                            const stripeClass = isSeo ? "bg-emerald-500" : "bg-indigo-500";
                            const textClass  = isSeo ? "text-emerald-400" : "text-indigo-400";
                            const titleClass = isSeo ? "text-emerald-300" : "text-indigo-300";
                            const Icon       = isSeo ? AlertCircle : Sparkles;
                            return (
                                <div key={idx} className={`p-4 rounded-2xl ${bgClass} border relative overflow-hidden shrink-0`}>
                                    <div className={`absolute top-0 left-0 w-1 h-full ${stripeClass}`} />
                                    <div className="flex items-start gap-3">
                                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${textClass}`} />
                                        <div>
                                            <h4 className={`text-xs font-bold mb-1 ${titleClass}`}>{insight.title}</h4>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-xs text-muted-foreground italic mt-4">
                            Connect to a session to generate live AI insights.
                        </div>
                    )}
                </div>

                <div className="w-1/2 bg-black/30 rounded-2xl border border-border p-4 flex flex-col min-h-0">
                    <h3 className="text-sm font-bold text-foreground mb-3 shrink-0">Visual Analysis</h3>
                    <div className="flex-1 min-h-0 relative">
                        <DynamicChart chart={state.chart} />
                    </div>
                </div>
            </div>

            <div className="shrink-0 bg-background/80 rounded-2xl border border-emerald-500/20 p-4 relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-3">Recommended Actions</h3>
                <div className="flex flex-wrap gap-2">
                    {state.recommendedActions && state.recommendedActions.length > 0 ? (
                        state.recommendedActions.map((action, idx) => (
                            <button key={idx} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors">
                                {action}
                            </button>
                        ))
                    ) : (
                        <span className="text-[11px] text-muted-foreground">No recommendations yet — start a session to load your site data.</span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Dynamic Chart ────────────────────────────────────────────────────────────
function DynamicChart({ chart }: { chart: ChartPayload }) {
    if (chart.type === "idle") {
        return (
            <div className="h-full flex flex-col gap-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Waiting for data...</p>
                <div className="flex items-end justify-between h-full gap-3 pb-4">
                    {[30, 55, 40, 75, 60, 85, 45, 70].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-md bg-muted animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 150}ms` }} />
                    ))}
                </div>
            </div>
        );
    }
    if (chart.type === "competitor_bar") {
        return (
            <div className="h-full flex flex-col gap-3">
                <p className="text-xs font-semibold text-zinc-300 shrink-0">{chart.title}</p>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart.data as CompetitorBarRow[]} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                        <XAxis dataKey="site" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} />
                        <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11, color: "#e4e4e7" }} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="words" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }
    if (chart.type === "keyword_bar") {
        return (
            <div className="h-full flex flex-col gap-3">
                <p className="text-xs font-semibold text-zinc-300 shrink-0">{chart.title}</p>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart.data as KeywordBarRow[]} layout="vertical" margin={{ top: 4, right: 8, left: 60, bottom: 4 }}>
                        <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} />
                        <YAxis type="category" dataKey="keyword" tick={{ fill: "#a1a1aa", fontSize: 10 }} tickLine={false} axisLine={false} width={60} />
                        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11, color: "#e4e4e7" }} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }
    if (chart.type === "nlp_radar") {
        return (
            <div className="h-full flex flex-col gap-3">
                <p className="text-xs font-semibold text-zinc-300 shrink-0">{chart.title}</p>
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chart.data as NlpRadarRow[]}>
                        <PolarGrid stroke="#3f3f46" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: "#71717a", fontSize: 10 }} />
                        <Radar name="Coverage" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
        );
    }
    if (chart.type === "readability_gauge") {
        const pct   = Math.min(100, (chart.gradeLevel / 16) * 100);
        const color = pct <= 60 ? "#34d399" : pct <= 80 ? "#fbbf24" : "#f87171";
        return (
            <div className="h-full flex flex-col items-center justify-center gap-4">
                <p className="text-xs font-semibold text-zinc-300">{chart.label}</p>
                <div className="relative w-36 h-36">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="#3f3f46" strokeWidth="10" />
                        <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="10"
                            strokeDasharray="264" strokeDashoffset={264 - (264 * pct) / 100}
                            className="transition-all duration-1000" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold" style={{ color }}>{chart.gradeLevel.toFixed(1)}</span>
                        <span className="text-[9px] text-muted-foreground uppercase tracking-widest">grade</span>
                    </div>
                </div>
            </div>
        );
    }
    if (chart.type === "vision_critique") {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                <div className="relative w-32 h-32 rounded-3xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center overflow-hidden shrink-0 shadow-2xl">
                    <div className="absolute inset-0 bg-indigo-500/20 blur-2xl animate-pulse" />
                    <ImageIcon className="w-12 h-12 text-indigo-400 relative z-10" />
                    <div className="absolute inset-x-0 h-1 bg-indigo-400/80 shadow-[0_0_20px_rgba(99,102,241,1)]"
                        style={{ animation: "scan 3s cubic-bezier(0.4,0,0.2,1) infinite", top: 0 }} />
                    <style>{`@keyframes scan{0%{top:-10px;opacity:0}10%{opacity:1}90%{opacity:1}100%{top:130px;opacity:0}}`}</style>
                </div>
                <div>
                    <p className="text-sm font-bold text-foreground mb-1">{chart.title}</p>
                    <p className="text-[11px] text-muted-foreground max-w-[200px] leading-relaxed mx-auto">
                        Aria is using Gemini Vision to analyze the UX, accessibility, and design logic of this interface.
                    </p>
                </div>
            </div>
        );
    }
    return null;
}

// ─── Agent Audio ──────────────────────────────────────────────────────────────
function AgentAudioRenderer() {
    const tracks = useTracks([Track.Source.Microphone], {
        onlySubscribed: true,
        updateOnlyOn:   [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed],
    });
    return <>{tracks.map(t => <AudioTrack key={t.publication.trackSid} trackRef={t} />)}</>;
}

// ─── Voice Session ─────────────────────────────────────────────────────────────
function VoiceSession({ tokenDetails, onDisconnect }: { tokenDetails: TokenDetails; onDisconnect: () => void }) {
    const tokenSource = useMemo(
        () => TokenSource.literal({ serverUrl: tokenDetails.url, participantToken: tokenDetails.token }),
        [tokenDetails.url, tokenDetails.token],
    );
    const session = useSession(tokenSource);
    const hasConnectedRef = useRef(false);

    useEffect(() => {
        session.start();
        return () => { session.end(); };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (
            session.connectionState === ConnectionState.Connected ||
            session.connectionState === ConnectionState.Reconnecting ||
            session.connectionState === ConnectionState.SignalReconnecting
        ) {
            hasConnectedRef.current = true;
            session.room.localParticipant
                ?.setMicrophoneEnabled(true)
                .catch(err => logger.warn("[AI Assistant] Mic enable failed:", { error: (err as Error)?.message || err }));
        }
    }, [session.connectionState]);

    return (
        <AgentSessionProvider session={session}>
            <RoomAudioRenderer volume={1.0} muted={false} />
            <AgentAudioRenderer />
            <StartAudio
                label="👆 Click to allow audio"
                className="absolute inset-x-4 top-4 z-50 py-3 bg-indigo-500/90 text-white text-sm font-bold text-center rounded-xl shadow-2xl backdrop-blur-md border border-indigo-400 cursor-pointer"
            />
            <AgentInterface onDisconnect={onDisconnect} />
        </AgentSessionProvider>
    );
}

// ─── Workspace Header ─────────────────────────────────────────────────────────
function WorkspaceHeader({
    isConnected, domain, seoHealth, aiVisibility,
    sites, selectedSite, onSelectSite,
}: {
    isConnected: boolean; domain: string | null;
    seoHealth: number | null; aiVisibility: number | null;
    sites: SiteOption[]; selectedSite: SiteOption | null;
    onSelectSite: (s: SiteOption) => void;
}) {
    return (
        <div className="flex items-center justify-between shrink-0 bg-card/60 backdrop-blur-xl rounded-3xl border border-border p-5 shadow-2xl mb-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-transparent to-emerald-500/10 pointer-events-none" />
            <div className="flex items-center gap-4 relative z-10 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 p-[1px] shrink-0">
                    <div className="w-full h-full bg-background rounded-[11px] flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                    </div>
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-bold tracking-tight text-foreground">AI SEO Workspace</h1>
                    {sites.length > 1 && !isConnected ? (
                        <div className="mt-1 w-64">
                            <SitePicker sites={sites} selected={selectedSite} onSelect={onSelectSite} />
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground font-medium tracking-wider mt-0.5">
                            {domain ? `Analyzing: ${domain}` : selectedSite ? `Selected: ${selectedSite.domain}` : "Ready for analysis"}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
                {isConnected && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Live</span>
                    </div>
                )}
                <div className="hidden md:flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">SEO Health</span>
                        <div className="flex items-center gap-2">
                            <div className="w-12 bg-white/10 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-emerald-400 h-full" style={{ width: `${seoHealth ?? 0}%` }} />
                            </div>
                            <span className="text-sm font-black text-emerald-400">{seoHealth ?? "--"}</span>
                        </div>
                    </div>
                    <div className="w-px h-8 bg-white/10" />
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">AI Visibility</span>
                        <div className="flex items-center gap-2">
                            <div className="w-12 bg-white/10 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-amber-400 h-full" style={{ width: `${aiVisibility ?? 0}%` }} />
                            </div>
                            <span className="text-sm font-black text-amber-400">{aiVisibility ?? "--"}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Idle State ───────────────────────────────────────────────────────────────
function IdleState({
    onConnect, isConnecting, error,
    sites, selectedSite, onSelectSite,
}: {
    onConnect: () => void; isConnecting: boolean; error: string | null;
    sites: SiteOption[]; selectedSite: SiteOption | null;
    onSelectSite: (s: SiteOption) => void;
}) {
    const CAPABILITIES = [
        { title: "SEO Audit",            desc: "Find technical SEO issues on your site",  icon: <Search   className="w-5 h-5 text-emerald-400" /> },
        { title: "Competitor Analysis",  desc: "Compare your keywords with competitors",   icon: <Target   className="w-5 h-5 text-indigo-400"  /> },
        { title: "AI Search Visibility", desc: "See if AI tools recommend your brand",     icon: <Sparkles className="w-5 h-5 text-amber-400"  /> },
        { title: "Content Optimization", desc: "Improve readability and NLP coverage",     icon: <Zap      className="w-5 h-5 text-muted-foreground"    /> },
    ];

    const canConnect = !!selectedSite && !isConnecting;

    return (
        <div className="flex-1 flex flex-col relative h-full w-full overflow-y-auto custom-scrollbar">
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 via-transparent to-emerald-500/5 pointer-events-none" />

            <div className="flex flex-col items-center justify-center pt-8 pb-4 px-8 gap-4 relative z-10">
                <div className="w-full max-w-sm">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                        Which site should I analyse?
                    </p>
                    <SitePicker sites={sites} selected={selectedSite} onSelect={onSelectSite} disabled={isConnecting} />
                </div>

                <div
                    onClick={() => canConnect && onConnect()}
                    className={`transition-transform duration-300 relative group flex items-center justify-center p-6
                        ${canConnect ? "cursor-pointer hover:scale-105" : "cursor-not-allowed opacity-60"}`}
                >
                    <div className="absolute inset-0 bg-indigo-500/10 blur-3xl rounded-full scale-150 group-hover:bg-indigo-500/20 transition-colors" />
                    <TalkingRobot state={isConnecting ? "thinking" : "idle"} size={160} />
                </div>

                <div className="text-center max-w-xs">
                    <h2 className="text-xl font-bold text-foreground mb-1.5">
                        {isConnecting ? "Connecting..." : canConnect ? `Ready for ${selectedSite!.domain}` : "Select a site to begin"}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        {isConnecting
                            ? "Setting up your voice session..."
                            : canConnect
                                ? "Tap the robot or a suggestion below to start your AI SEO session"
                                : "Pick a site from the dropdown above"}
                    </p>
                </div>

                {!isConnecting && canConnect && (
                    <SuggestionChips onChipClick={() => onConnect()} className="justify-center" compact />
                )}

                {isConnecting && (
                    <div className="flex items-center gap-2 text-[11px] text-indigo-400 font-medium">
                        <div className="w-3 h-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                        Initializing voice channel...
                    </div>
                )}

                {error && (
                    <div className="w-full max-w-sm p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex gap-3">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3 px-8 mb-4 relative z-10">
                <div className="flex-1 h-px bg-muted" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Or select an analysis</span>
                <div className="flex-1 h-px bg-muted" />
            </div>

            <div className="px-6 pb-8 grid grid-cols-1 gap-2.5 relative z-10">
                {CAPABILITIES.map((cap, idx) => (
                    <button
                        key={idx}
                        onClick={() => canConnect && onConnect()}
                        disabled={!canConnect}
                        className="p-4 rounded-2xl bg-muted border border-border hover:bg-white/10 hover:border-indigo-500/30 transition-all text-left group flex items-start gap-4 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <div className="p-2.5 rounded-xl bg-black/30 group-hover:bg-black/50 transition-colors shrink-0">{cap.icon}</div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-bold text-foreground group-hover:text-white transition-colors">{cap.title}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{cap.desc}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-white shrink-0 mt-1 transition-all group-hover:translate-x-1" />
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Main Page Inner ──────────────────────────────────────────────────────────
function VoiceAgentInner() {
    const [tokenDetails,    setTokenDetails]    = useState<TokenDetails | null>(null);
    const [error,           setError]           = useState<string | null>(null);
    const [isConnecting,    setIsConnecting]    = useState(false);
    const [sites,           setSites]           = useState<SiteOption[]>([]);
    const [selectedSite,    setSelectedSite]    = useState<SiteOption | null>(null);
    const [activeMobileTab, setActiveMobileTab] = useState<"voice" | "insights">("voice");

    const { state: storeState, dispatch } = useAgentStore();

    useEffect(() => {
        async function loadSites() {
            const res = await getUserSites();
            if (res.success && res.sites.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const opts: SiteOption[] = res.sites.map((s: any) => ({
                    id:     s.id,
                    domain: s.domain,
                    lastAuditScore: s.audits?.[0]?.categoryScores
                        ? (() => {
                            try {
                                const scores = s.audits[0].categoryScores as Record<string, number>;
                                const vals   = Object.values(scores).filter(v => typeof v === "number");
                                return vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null;
                            } catch { return null; }
                        })()
                        : null,
                }));
                setSites(opts);
                setSelectedSite(opts[0]);
                dispatch({ type: "SET_SELECTED_SITE", site: opts[0] });
            }
        }
        loadSites();
    }, []);

    useEffect(() => {
        if (!selectedSite) return;
        async function fetchMetrics() {
            try {
                const metrics = await getVoiceMetrics(selectedSite!.domain);
                dispatch({ type: "SET_METRICS", metrics });
            } catch (e) {
                logger.error("Failed to fetch voice metrics", { error: (e as Error)?.message || e });
            }
        }
        fetchMetrics();
    }, [selectedSite?.id]);

    const handleSelectSite = (site: SiteOption) => {
        setSelectedSite(site);
        dispatch({ type: "SET_SELECTED_SITE", site });
    };

    const connect = useCallback(async () => {
        if (isConnecting || tokenDetails) return;
        if (!selectedSite) { setError("Please select a site first."); return; }
        setIsConnecting(true);
        setError(null);
        try {
            const res  = await fetch(`/api/livekit/token?siteId=${selectedSite.id}&domain=${encodeURIComponent(selectedSite.domain)}`);
            if (!res.ok) throw new Error(`Failed to get token: ${res.status}`);
            const data = await res.json();
            if (!data.token || !data.url) throw new Error("Invalid token response from server.");
            setTokenDetails(data);
        } catch (err: unknown) {
            setError((err as Error).message);
        } finally {
            setIsConnecting(false);
        }
    }, [isConnecting, tokenDetails, selectedSite]);

    const disconnect = useCallback(() => {
        setTokenDetails(null);
        dispatch({ type: "RESET" });
        if (selectedSite) dispatch({ type: "SET_SELECTED_SITE", site: selectedSite });
    }, [dispatch, selectedSite]);

    const isConnected = !!tokenDetails;

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100vh-4rem)] bg-[#09090b] text-foreground overflow-hidden relative"
             style={{ height: 'calc(100svh - 4rem - env(safe-area-inset-bottom, 0px))' }}
        >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            <div className="flex flex-col h-full max-w-[1600px] mx-auto w-full p-4 lg:p-6 gap-6 relative z-10">
                <WorkspaceHeader
                    isConnected={isConnected}
                    domain={storeState.domain}
                    seoHealth={storeState.seoHealth}
                    aiVisibility={storeState.aiVisibility}
                    sites={sites}
                    selectedSite={selectedSite}
                    onSelectSite={handleSelectSite}
                />

                <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0">
                    <div className={`w-full md:w-[42%] flex-col relative min-h-0 bg-card/40 rounded-3xl border border-border overflow-hidden shadow-2xl shrink-0 ${activeMobileTab === "voice" ? "flex" : "hidden md:flex"}`}>
                        {tokenDetails ? (
                            <VoiceSession tokenDetails={tokenDetails} onDisconnect={disconnect} />
                        ) : (
                            <IdleState
                                onConnect={connect}
                                isConnecting={isConnecting}
                                error={error}
                                sites={sites}
                                selectedSite={selectedSite}
                                onSelectSite={handleSelectSite}
                            />
                        )}
                    </div>

                    <div className={`w-full md:flex-1 flex-col relative min-h-0 ${activeMobileTab === "insights" ? "flex" : "hidden md:flex"}`}>
                        <ContextCanvas isConnected={isConnected} />
                    </div>

                    <div className="md:hidden shrink-0 flex items-center bg-card border border-border p-1.5 rounded-2xl gap-2 backdrop-blur-md">
                        <button
                            onClick={() => setActiveMobileTab("voice")}
                            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${activeMobileTab === "voice" ? "bg-indigo-500 text-white shadow-lg" : "text-muted-foreground hover:text-zinc-300 hover:bg-muted"}`}
                        >
                            Voice & Chat
                        </button>
                        <button
                            onClick={() => setActiveMobileTab("insights")}
                            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${activeMobileTab === "insights" ? "bg-indigo-500 text-white shadow-lg" : "text-muted-foreground hover:text-zinc-300 hover:bg-muted"}`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <Activity className="w-4 h-4" /> AI Insights
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Agent Interface (connected state) ────────────────────────────────────────
function AgentInterface({ onDisconnect }: { onDisconnect: () => void }) {
    const session                         = useAgentSession();
    const { state: agentState }           = useAgent(session);
    const { messages }                    = useSessionMessages(session);
    const { state: storeState, dispatch } = useAgentStore();

    useAgentDataChannel();

    // Publish selected site context once on connect
    const sitePublishedRef = useRef(false);
    useEffect(() => {
        if (sitePublishedRef.current || !session?.room || !storeState.selectedSite) return;
        sitePublishedRef.current = true;
        const payload = JSON.stringify({
            event:  "set_context",
            siteId: storeState.selectedSite.id,
            domain: storeState.selectedSite.domain,
        });
        session.room.localParticipant?.publishData(
            new TextEncoder().encode(payload),
            { reliable: true },
        ).catch(() => {});
        dispatch({ type: "TOOL_LOG", message: `Context loaded: ${storeState.selectedSite.domain}` });
    }, [session?.room, storeState.selectedSite]);

    // Shared publish helper — used by chips + text input
    const publishMessage = useCallback((text: string) => {
        if (!text.trim() || !session?.room) return;
        session.room.localParticipant?.publishData(
            new TextEncoder().encode(JSON.stringify({ event: "chat_message", text: text.trim() })),
            { reliable: true },
        ).catch(() => {});
        dispatch({ type: "TOOL_LOG", message: `> ${text.trim()}...` });
    }, [session, dispatch]);

    // Auto-detect spoken URLs
    const processedMsgIds = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!messages?.length) return;
        const urlRegex    = /\bhttps?:\/\/[^\s/$.?#][^\s]*\b/i;
        const looseDomain = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,6}(?:\/\S*)?\b/i;

        for (const msg of messages) {
            if (msg.type !== "userTranscript") continue;
            if (processedMsgIds.current.has(msg.id)) continue;
            processedMsgIds.current.add(msg.id);
            const text = (msg.message || "").trim();
            if (!text) continue;
            const m = text.match(urlRegex) || text.match(looseDomain);
            if (m) {
                const detected = m[0];
                dispatch({ type: "PENDING_URL", url: detected });
                dispatch({ type: "TOOL_LOG", message: `Detected URL (awaiting confirmation): ${detected}` });
                try {
                    session.room.localParticipant?.publishData(
                        new TextEncoder().encode(JSON.stringify({ event: "request_confirmation", url: detected })),
                        { reliable: true },
                    );
                } catch { /* ignore */ }
            }
        }
    }, [messages, dispatch]);

    const confirmPendingUrl = useCallback(async () => {
        const url = storeState.pendingUrl;
        if (!url || !session?.room) return;
        try {
            await session.room.localParticipant?.publishData(
                new TextEncoder().encode(JSON.stringify({ event: "user_provided_url", url })),
                { reliable: true },
            );
            dispatch({ type: "TOOL_LOG", message: `Confirmed URL: ${url}` });
        } catch {
            dispatch({ type: "TOOL_LOG", message: `Failed to publish URL: ${url}` });
        } finally {
            dispatch({ type: "CLEAR_PENDING_URL" });
        }
    }, [session, storeState.pendingUrl, dispatch]);

    const cancelPendingUrl = useCallback(() => {
        dispatch({ type: "CLEAR_PENDING_URL" });
        dispatch({ type: "TOOL_LOG", message: "URL confirmation cancelled" });
    }, [dispatch]);

    // Auto-confirm yes/no voice
    const processedConfirmIds = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!storeState.pendingUrl || !messages?.length) return;
        for (const msg of messages.slice(-6)) {
            if (msg.type !== "userTranscript") continue;
            if (processedConfirmIds.current.has(msg.id)) continue;
            const text = (msg.message || "").toLowerCase().trim();
            if (!text) continue;
            processedConfirmIds.current.add(msg.id);
            if (/\b(yes|yeah|yep|sure|please do|do it|go ahead)\b/.test(text)) { confirmPendingUrl(); break; }
            if (/\b(no|nope|nah|cancel|don'?t|do not)\b/.test(text))           { cancelPendingUrl();  break; }
        }
    }, [messages, storeState.pendingUrl, confirmPendingUrl, cancelPendingUrl]);

    // Chat input
    const [chatInput, setChatInput] = useState("");
    const sendChatMessage = useCallback(() => {
        publishMessage(chatInput);
        setChatInput("");
    }, [chatInput, publishMessage]);

    // Image upload
    const imageInputRef      = useRef<HTMLInputElement>(null);
    const [uploadedImage,    setUploadedImage]    = useState<{ name: string; preview: string } | null>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    const handleImageUpload = useCallback(async (file: File) => {
        if (!session.isConnected) return;
        setIsUploadingImage(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const dataUrl  = reader.result as string;
                const base64   = dataUrl.split(",")[1];
                const mimeType = file.type || "image/png";
                setUploadedImage({ name: file.name, preview: dataUrl });
                await session.room.localParticipant?.publishData(
                    new TextEncoder().encode(JSON.stringify({
                        event: "image_upload", imageBase64: base64,
                        mimeType, context: `User uploaded screenshot: ${file.name}`,
                    })),
                    { reliable: true },
                );
            };
            reader.readAsDataURL(file);
        } catch (err) {
            logger.error("[AI Assistant] Image upload failed:", { error: (err as Error)?.message || err });
        } finally {
            setIsUploadingImage(false);
        }
    }, [session]);

    const thinkingMessage = storeState.toolLog.length > 0
        ? storeState.toolLog[storeState.toolLog.length - 1].replace(/^>\s*/, "").replace(/\.\.\.$/, "")
        : null;

    return (
        <div className="flex-1 flex flex-col p-6 relative w-full h-full bg-background/50 rounded-[31px]">
            {storeState.pendingUrl && (
                <div className="absolute left-6 top-6 z-50 bg-indigo-800/80 border border-indigo-600/30 text-white px-4 py-3 rounded-lg flex items-center gap-4">
                    <div className="text-sm">Confirm audit for:</div>
                    <div className="font-mono text-sm text-amber-200">{storeState.pendingUrl}</div>
                    <div className="ml-4 flex gap-2">
                        <button onClick={confirmPendingUrl} className="px-3 py-1 rounded-lg bg-emerald-500 text-black font-bold">Audit</button>
                        <button onClick={cancelPendingUrl}  className="px-3 py-1 rounded-lg bg-muted text-white">Cancel</button>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 backdrop-blur-md">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                    </span>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                        {storeState.selectedSite ? `Analysing ${storeState.selectedSite.domain}` : "AI Assistant Interactive"}
                    </span>
                </div>
                {(agentState === "thinking" || storeState.isProcessing) && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded-full border border-border animate-pulse">
                        <Bot className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[10px] font-medium text-zinc-300">Evaluating...</span>
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col items-center justify-between relative min-h-0 py-8">
                {/* Proper chat transcript with built-in scroll + thinking indicator */}
                <AgentChatTranscript
                    agentState={agentState ?? "idle"}
                    messages={messages}
                    className="flex-1 w-full max-w-2xl mx-auto"
                />
                {messages.length === 0 && (
                    <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-4 pt-4 pointer-events-none">
                        <p className="text-muted-foreground text-sm font-medium animate-pulse tracking-wide">
                            {storeState.selectedSite
                                ? `Ready to analyse ${storeState.selectedSite.domain}. What would you like to know?`
                                : "The AI Assistant is listening. How can I help with your site?"}
                        </p>
                        <SuggestionChips
                            onChipClick={(label) => publishMessage(label)}
                            className="justify-center pointer-events-auto"
                            compact
                        />
                    </div>
                )}

                {/* Aria audio visualizer — reacts to agent voice state */}
                <div className="relative flex items-center justify-center -mt-8 mb-4 shrink-0">
                    <AgentAudioVisualizerAura
                        state={agentState ?? "idle"}
                        size="lg"
                        color="#6366f1"
                        colorShift={0.08}
                        themeMode="dark"
                        className="opacity-80"
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <TalkingRobot state={agentState ?? "idle"} size={120} className="relative z-10" />
                    </div>
                </div>

                <div className="w-full text-center max-w-md mx-auto flex flex-col items-center gap-4 shrink-0">
                    {(agentState === "thinking" || storeState.isProcessing) && thinkingMessage && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 flex items-center gap-3 px-5 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full shadow-lg backdrop-blur-md">
                            <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDuration: "1s" }} />
                            </div>
                            <span className="text-xs font-mono text-indigo-300 font-medium truncate">{thinkingMessage}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-3 shrink-0">
                        {/* Live audio bar — shows mic/agent activity */}
                        <AgentAudioVisualizerBar
                            state={agentState ?? "idle"}
                            size="icon"
                            barCount={5}
                            color={agentState === "speaking" ? "#34d399" : agentState === "listening" ? "#60a5fa" : "#6b7280"}
                            className="opacity-70"
                        />
                        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] px-4 py-1.5 rounded-full shadow-inner
                            ${agentState === "speaking"  ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                            : agentState === "thinking"  ? "text-indigo-400 bg-indigo-500/10 border border-indigo-500/20"
                            : agentState === "listening" ? "text-blue-400 bg-blue-500/10 border border-blue-500/20"
                            : "text-muted-foreground bg-muted border border-border"}`}>
                            {agentState === "speaking" ? "Speaking" : agentState === "thinking" ? "Thinking" : agentState === "listening" ? "Listening" : "Ready"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="mt-6 shrink-0">
                {uploadedImage && (
                    <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl animate-in fade-in slide-in-from-bottom-2">
                        <ImageIcon className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span className="text-xs text-indigo-300 flex-1 truncate">{uploadedImage.name}</span>
                        <span className="text-[10px] text-indigo-400 uppercase tracking-widest">Sent to AI Assistant</span>
                        <button onClick={() => setUploadedImage(null)} className="text-muted-foreground hover:text-zinc-300 transition-colors ml-1">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                <div className="bg-card/80 border border-border rounded-2xl p-2 flex items-center gap-3 backdrop-blur-2xl shadow-2xl relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-emerald-500/5 rounded-2xl pointer-events-none" />
                    <div className="flex-1 flex items-center px-4 py-3 gap-4 relative z-10">
                        <Bot className="w-5 h-5 text-indigo-400" />
                        <input
                            type="text"
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                            placeholder="Interrupt the AI Assistant or type a command..."
                            className="bg-transparent border-none outline-none text-[15px] font-medium text-white w-full placeholder:text-muted-foreground tracking-wide"
                        />
                        <div className="flex items-center gap-2">
                            <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
                            <button
                                onClick={() => imageInputRef.current?.click()}
                                disabled={!session.isConnected || isUploadingImage}
                                title="Upload a screenshot for the AI Assistant to analyse"
                                className="p-2.5 rounded-xl text-muted-foreground hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-transparent hover:border-border"
                            >
                                <ImageIcon className="w-4 h-4" />
                            </button>
                            {chatInput.trim() && (
                                <button onClick={sendChatMessage} disabled={!session.isConnected}
                                    className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            )}
                            <div className="w-px h-6 bg-white/10 mx-1" />
                            {/* Mic track control with audio bar visualizer */}
                            <AgentTrackControl
                                kind="audioinput"
                                source="microphone"
                                variant="outline"
                                className="shrink-0"
                            />
                            {/* Disconnect button */}
                            <AgentDisconnectButton
                                size="icon"
                                variant="destructive"
                                onClick={onDisconnect}
                                className="shrink-0"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Page Entry ───────────────────────────────────────────────────────────────
export default function VoiceAgentPage() {
    return (
        <DashboardErrorBoundary feature="AI Assistant Voice Agent">
            <AgentStoreProvider>
                <VoiceAgentInner />
            </AgentStoreProvider>
        </DashboardErrorBoundary>
    );
}
