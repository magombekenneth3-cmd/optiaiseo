/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import { getSelfHealingData, toggleAutopilot } from "@/app/actions/selfHealing";
import { formatDistanceToNow } from "date-fns";

export default function AutopilotSection({ siteId, initialMode }: { siteId: string, initialMode: string }) {
    const [isAutopilot, setIsAutopilot] = useState(initialMode === "AUTOPILOT");
     
    const [data, setData] = useState<{ logs: any[], linkingRecs: any[] } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            const res = await getSelfHealingData(siteId);
            if (res.success) {
                setData({ logs: res.logs || [], linkingRecs: res.linkingRecs || [] });
            }
            setLoading(false);
        };
        fetchData();
    }, [siteId]);

    const handleToggle = async () => {
        const newMode = !isAutopilot;
        setIsAutopilot(newMode);
        const res = await toggleAutopilot(siteId, newMode);
        if (!res.success) {
            setIsAutopilot(!newMode); // Rollback
        }
    };

    return (
        <div className="space-y-6">
            <div className={`card-surface p-6 border-l-4 ${isAutopilot ? "border-emerald-500 bg-emerald-500/5" : "border-zinc-500 bg-zinc-500/5"}`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <span>🚀</span> Autopilot: Agentic Self-Healing
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            {isAutopilot
                                ? "OptiAISEO is autonomously monitoring and healing your site health."
                                : "Autopilot is disabled. Switch to Autopilot for autonomous SEO repairs."}
                        </p>
                    </div>
                    <button
                        onClick={handleToggle}
                        className={`px-6 py-2 rounded-full font-bold transition-all ${isAutopilot ? "bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]" : "bg-zinc-700 text-zinc-300"
                            }`}
                    >
                        {isAutopilot ? "AUTOPILOT ON" : "TURN ON AUTOPILOT"}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Self-Healing Logs */}
                <div className="card-surface p-6">
                    <h3 className="font-bold flex items-center gap-2 mb-4">
                        <span>🛡️</span> Healing Activity
                    </h3>
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {loading ? (
                            <p className="text-sm text-muted-foreground">Loading logs...</p>
                        ) : data?.logs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No autonomous actions taken yet.</p>
                        ) : data?.logs.map((log, i) => (
                            <div key={i} className="text-xs p-3 rounded bg-muted/50 border border-border/50">
                                <div className="flex justify-between items-start">
                                    <span className="font-bold text-emerald-400">{log.actionTaken}</span>
                                    <span className="text-muted-foreground">{formatDistanceToNow(new Date(log.createdAt))} ago</span>
                                </div>
                                <p className="mt-1 text-zinc-300">{log.description}</p>
                                {log.status === "COMPLETED" && (
                                    <span className="inline-block mt-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold scale-90 origin-left">RECOVERY SUCCESS</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* AI-Native Internal Linking */}
                <div className="card-surface p-6">
                    <h3 className="font-bold flex items-center gap-2 mb-4">
                        <span>🔗</span> Semantic Internal Linking (AIA)
                    </h3>
                    <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                        {loading ? (
                            <p className="text-sm text-muted-foreground">Analyzing schema...</p>
                        ) : data?.linkingRecs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No link optimizations found yet.</p>
                        ) : data?.linkingRecs.map((rec, i) => (
                            <div key={i} className="text-xs p-3 rounded bg-muted/50 border border-border">
                                <p className="text-muted-foreground truncate">
                                    Source: <span className="text-zinc-300 font-mono">{rec.sourceUrl.replace(/https?:\/\//, "")}</span>
                                </p>
                                <p className="text-muted-foreground truncate mt-1">
                                    Target: <span className="text-foreground font-mono italic">{rec.targetUrl.replace(/https?:\/\//, "")}</span>
                                </p>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="px-2 py-0.5 rounded bg-muted border border-border text-foreground font-bold">{rec.anchorText}</span>
                                    <span className="text-emerald-400 font-bold">+{Math.round(rec.semanticScore * 40)}% Equity</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
