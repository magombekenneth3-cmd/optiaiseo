"use client";

import { useEffect, useState } from "react";

const DATA = [
    { month: "Jan", visitors: 20 },
    { month: "Feb", visitors: 35 },
    { month: "Mar", visitors: 48 },
    { month: "Apr", visitors: 62 },
    { month: "May", visitors: 80 },
    { month: "Jun", visitors: 100 },
];

const GRID_ROWS = 5;
const GRID_COLS = 6;
const MAX = 100;

export function TrafficGrowth3D() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div className="relative w-full flex flex-col items-center justify-center gap-0 select-none">
            {/* Ambient glow */}
            <div
                className="absolute inset-0 pointer-events-none rounded-2xl"
                aria-hidden="true"
                style={{
                    background: "radial-gradient(ellipse 70% 60% at 50% 60%, rgba(16,185,129,0.13) 0%, transparent 75%)",
                }}
            />

            {/* Heatmap grid */}
            <div
                className="grid gap-1.5 p-3 rounded-2xl border border-emerald-500/15 bg-white/[0.02] mb-0 w-full max-w-[340px]"
                style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}
                aria-hidden="true"
            >
                {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, i) => {
                    const col = i % GRID_COLS;
                    const row = Math.floor(i / GRID_COLS);
                    const barIdx = col;
                    const barPct = DATA[barIdx].visitors / MAX;
                    const rowThreshold = 1 - (row + 1) / GRID_ROWS;
                    const active = mounted && barPct > rowThreshold;
                    return (
                        <div
                            key={i}
                            className="rounded-md transition-all duration-700"
                            style={{
                                aspectRatio: "1",
                                background: active
                                    ? `rgba(16,185,129,${0.25 + barPct * 0.45})`
                                    : "rgba(255,255,255,0.04)",
                                border: active
                                    ? "1px solid rgba(16,185,129,0.25)"
                                    : "1px solid rgba(255,255,255,0.05)",
                                transitionDelay: mounted ? `${col * 80 + row * 40}ms` : "0ms",
                                boxShadow: active && row === 0 ? "0 0 8px rgba(16,185,129,0.4)" : undefined,
                            }}
                        />
                    );
                })}
            </div>

            {/* SVG trend line overlaid on grid */}
            <div className="w-full max-w-[340px] -mt-[calc(100%/5*6+24px)] pointer-events-none" aria-hidden="true"
                style={{ height: `calc(${GRID_ROWS} * (100% / ${GRID_COLS}) + ${(GRID_ROWS - 1) * 6}px)` }}
            >
            </div>

            {/* Bar chart */}
            <div className="w-full max-w-[340px] flex items-end justify-between gap-1.5 px-3 pb-0">
                {DATA.map((item, idx) => {
                    const heightPct = mounted ? (item.visitors / MAX) * 100 : 0;
                    const delay = idx * 100;
                    return (
                        <div key={item.month} className="flex-1 flex flex-col items-center gap-1.5">
                            <div
                                className="w-full rounded-t-md relative overflow-visible"
                                style={{
                                    height: `${Math.round(heightPct * 1.2)}px`,
                                    background: `linear-gradient(to top, rgba(16,185,129,0.9), rgba(52,211,153,0.75))`,
                                    transition: "height 1.2s cubic-bezier(0.34,1.56,0.64,1)",
                                    transitionDelay: `${delay}ms`,
                                    boxShadow: mounted ? "0 -4px 16px rgba(16,185,129,0.35)" : undefined,
                                }}
                            >
                                {/* Glowing top cap */}
                                {mounted && (
                                    <div
                                        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full"
                                        style={{
                                            background: "rgba(52,211,153,0.9)",
                                            boxShadow: "0 0 10px 3px rgba(16,185,129,0.6)",
                                            animation: "breathe 2.5s ease-in-out infinite",
                                            animationDelay: `${delay}ms`,
                                        }}
                                        aria-hidden="true"
                                    />
                                )}
                            </div>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                {item.month}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
