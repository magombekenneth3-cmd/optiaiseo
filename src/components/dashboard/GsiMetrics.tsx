"use client";

import type { AeoResult } from "@/lib/aeo";

/**
 * Premium God Level component for visualizing GSI metrics.
 * Displays Share of Voice, multi-engine breakdown, and Citation Likelihood.
 */
export function GsiMetrics({ result }: { result: AeoResult }) {
    const { multiEngineScore, generativeShareOfVoice, citationLikelihood } = result;

    if (!multiEngineScore) return null;

    const engines = [
        { name: "Perplexity", score: multiEngineScore.perplexity, icon: "🔍", color: "text-blue-400" },
        { name: "ChatGPT Search", score: multiEngineScore.chatgpt, icon: "💬", color: "text-emerald-400" },
        { name: "Google AI Overview", score: multiEngineScore.googleAio, icon: "🤖", color: "text-yellow-400" },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Generative Share of Voice */}
                <div className="card-surface p-6 border-emerald-500/20 bg-emerald-500/5">
                    <p className="text-sm font-medium text-emerald-400 uppercase tracking-wider mb-1">Generative Share of Voice</p>
                    <div className="flex items-end gap-3">
                        <span className="text-5xl font-bold">{generativeShareOfVoice}%</span>
                        <span className="text-muted-foreground mb-1 text-sm italic">Overall visibility</span>
                    </div>
                    <div className="mt-4 w-full bg-muted h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-emerald-500 h-full transition-all duration-1000"
                            style={{ width: `${generativeShareOfVoice}%` }}
                        />
                    </div>
                </div>

                {/* Citation Likelihood */}
                <div className="card-surface p-6 border-blue-500/20 bg-blue-500/5">
                    <p className="text-sm font-medium text-blue-400 uppercase tracking-wider mb-1">Citation Likelihood</p>
                    <div className="flex items-end gap-3">
                        <span className="text-5xl font-bold">{citationLikelihood}%</span>
                        <span className="text-muted-foreground mb-1 text-sm italic">Predictive score</span>
                    </div>
                    <div className="mt-4 w-full bg-muted h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-blue-500 h-full transition-all duration-1000"
                            style={{ width: `${citationLikelihood}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Multi-Engine Breakdown */}
            <div className="card-surface p-6">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 text-center">Multi-Engine Visibility Breakdown</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {engines.map(engine => (
                        <div key={engine.name} className="flex flex-col items-center gap-3">
                            <div className="relative">
                                <svg width="80" height="80" className="-rotate-90">
                                    <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
                                    <circle
                                        cx="40" cy="40" r="35" fill="none"
                                        stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                                        className={engine.color}
                                        strokeDasharray={`${(engine.score / 100) * 219} 219`}
                                        style={{ transition: "stroke-dasharray 1s ease 0.5s" }}
                                    />
                                </svg>
                                <span className={`absolute inset-0 flex items-center justify-center font-bold text-lg ${engine.color}`}>
                                    {engine.score}%
                                </span>
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-sm flex items-center justify-center gap-1">
                                    <span>{engine.icon}</span> {engine.name}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
