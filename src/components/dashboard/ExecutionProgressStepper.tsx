"use client";

import React from "react";

export interface ExecutionProgressStepperProps {
    currentPhase: 1 | 2 | 3 | 4;
    phaseTitle?: string;
    details?: string;
}

export function ExecutionProgressStepper({
    currentPhase = 1,
    phaseTitle = "Executing Growth Decision",
    details,
}: ExecutionProgressStepperProps) {
    const phases = [
        { id: 1, label: "Vector Linker Analysis" },
        { id: 2, label: "FAQ Schema Injection" },
        { id: 3, label: "Instant IndexNow Ping" },
        { id: 4, label: "28-Day Baseline Lock" },
    ];

    return (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                    {phaseTitle}
                </span>
                <span className="text-xs font-mono text-slate-400">
                    Phase {currentPhase} of 4
                </span>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-3">
                {phases.map((p) => {
                    const isDone = p.id < currentPhase;
                    const isCurrent = p.id === currentPhase;

                    return (
                        <div key={p.id} className="flex flex-col gap-1.5">
                            <div
                                className={`h-1.5 rounded-full transition-all duration-500 ${
                                    isDone
                                        ? "bg-emerald-500"
                                        : isCurrent
                                        ? "bg-cyan-500 animate-pulse"
                                        : "bg-slate-800"
                                }`}
                            />
                            <span
                                className={`text-[10px] font-medium leading-tight ${
                                    isDone
                                        ? "text-emerald-400"
                                        : isCurrent
                                        ? "text-cyan-300 font-bold"
                                        : "text-slate-500"
                                }`}
                            >
                                {p.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {details && (
                <div className="p-2.5 bg-slate-950 border border-slate-800/80 rounded text-xs text-slate-300 font-mono truncate">
                    {details}
                </div>
            )}
        </div>
    );
}
