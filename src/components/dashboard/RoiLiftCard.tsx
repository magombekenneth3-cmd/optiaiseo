"use client";

import React from "react";

export interface RoiLiftCardProps {
    totalRevenueGenerated?: number;
    averageRankGain?: number;
    ctrLiftPercent?: number;
    totalExperiments?: number;
}

export function RoiLiftCard({
    totalRevenueGenerated = 2450,
    averageRankGain = 4.8,
    ctrLiftPercent = 85.4,
    totalExperiments = 12,
}: RoiLiftCardProps) {
    return (
        <div className="p-5 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 border border-cyan-500/20 rounded-xl shadow-xl">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                    28-Day Verified ROI & Revenue Lift Prover
                </span>
                <span className="px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold rounded-full">
                    T+28 Days Verified
                </span>
            </div>

            <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-black text-white">
                    +${totalRevenueGenerated.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-medium">/ month revenue lift</span>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800">
                <div>
                    <span className="text-[11px] text-slate-400 block">Avg Rank Gain</span>
                    <span className="text-sm font-bold text-emerald-400">+{averageRankGain} positions</span>
                </div>
                <div>
                    <span className="text-[11px] text-slate-400 block">CTR Lift</span>
                    <span className="text-sm font-bold text-sky-400">+{ctrLiftPercent}%</span>
                </div>
                <div>
                    <span className="text-[11px] text-slate-400 block">Experiments</span>
                    <span className="text-sm font-bold text-purple-400">{totalExperiments} completed</span>
                </div>
            </div>
        </div>
    );
}
