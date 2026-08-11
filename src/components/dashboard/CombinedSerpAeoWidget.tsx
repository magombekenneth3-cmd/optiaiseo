"use client";

import React from "react";

export interface CombinedSerpAeoWidgetProps {
    consensusScore: number;
    googleRank: number;
    llmCitationRate: number;
    totalKeywordsTracked: number;
    modelBreakdown?: {
        searchGpt: number;
        claudeWeb: number;
        perplexity: number;
        deepseekR1: number;
    };
}

export function CombinedSerpAeoWidget({
    consensusScore = 88,
    googleRank = 2,
    llmCitationRate = 92,
    totalKeywordsTracked = 45,
    modelBreakdown = {
        searchGpt: 94,
        claudeWeb: 90,
        perplexity: 96,
        deepseekR1: 88,
    },
}: CombinedSerpAeoWidgetProps) {
    return (
        <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        Unified SERP + AEO Visibility Overview
                    </h3>
                    <p className="text-xs text-slate-400">
                        Combined Google Rank & Multi-LLM Citation Index
                    </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full">
                    <span className="text-xs font-bold text-cyan-400">Consensus Visibility</span>
                    <span className="text-sm font-extrabold text-white">{consensusScore}/100</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {/* Metric 1 */}
                <div className="p-3.5 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <span className="text-xs text-slate-400 font-medium">Average Google Rank</span>
                    <div className="text-2xl font-bold text-white mt-1">Position #{googleRank}</div>
                    <span className="text-[11px] text-emerald-400 font-medium">↑ +3.2 rank gain</span>
                </div>

                {/* Metric 2 */}
                <div className="p-3.5 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <span className="text-xs text-slate-400 font-medium">LLM Citation Rate</span>
                    <div className="text-2xl font-bold text-sky-400 mt-1">{llmCitationRate}%</div>
                    <span className="text-[11px] text-emerald-400 font-medium">↑ +45% generative lift</span>
                </div>

                {/* Metric 3 */}
                <div className="p-3.5 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                    <span className="text-xs text-slate-400 font-medium">Tracked Keywords</span>
                    <div className="text-2xl font-bold text-purple-400 mt-1">{totalKeywordsTracked}</div>
                    <span className="text-[11px] text-slate-400 font-medium">across 4 AI engines</span>
                </div>
            </div>

            {/* Model Breakdown Bar */}
            <div className="pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium mb-2 block">
                    AI Search Engine Citation Breakdown
                </span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-800">
                        <span className="text-slate-300 font-medium">SearchGPT</span>
                        <span className="font-bold text-emerald-400">{modelBreakdown.searchGpt}%</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-800">
                        <span className="text-slate-300 font-medium">Perplexity</span>
                        <span className="font-bold text-cyan-400">{modelBreakdown.perplexity}%</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-800">
                        <span className="text-slate-300 font-medium">Claude Web</span>
                        <span className="font-bold text-purple-400">{modelBreakdown.claudeWeb}%</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-slate-800/30 rounded border border-slate-800">
                        <span className="text-slate-300 font-medium">DeepSeek-R1</span>
                        <span className="font-bold text-sky-400">{modelBreakdown.deepseekR1}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
