"use client";

import { useEffect, useState } from "react";

export function TrafficGrowth3D() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // 6 months of data
    const data = [
        { month: "Jan", visitors: 20 },
        { month: "Feb", visitors: 35 },
        { month: "Mar", visitors: 45 },
        { month: "Apr", visitors: 60 },
        { month: "May", visitors: 80 },
        { month: "Jun", visitors: 100 },
    ];

    return (
        <div className="relative w-full h-[400px] flex items-center justify-center perspective-1000">
            {/* Global style overrides for the isometric projections */}
            <style dangerouslySetInnerHTML={{
                __html: `
                .iso-container {
                    transform: rotateX(60deg) rotateZ(-45deg);
                    transform-style: preserve-3d;
                }
                .iso-bar {
                    transform-style: preserve-3d;
                    transition: height 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    position: relative;
                }
                .iso-face-front {
                    position: absolute;
                    bottom: 0; left: 0;
                    width: 100%; height: 100%;
                    transform-origin: bottom;
                    transform: rotateX(-90deg);
                }
                .iso-face-right {
                    position: absolute;
                    bottom: 0; right: 0;
                    width: 100%; height: 100%;
                    transform-origin: right;
                    transform: rotateY(-90deg) rotateX(-90deg);
                }
                .iso-face-top {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    transform: translateZ(var(--bar-height));
                }
            `}} />

            {/* Isometric Scene Container */}
            <div className="iso-container w-64 h-64 relative group mx-auto mt-12">
                {/* Glowing Grid Base Floor */}
                <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 gap-1 bg-primary/5 border border-primary/20 p-2 shadow-[0_0_50px_rgba(16,185,129,0.2)] rounded-sm">
                    {Array.from({ length: 36 }).map((_, i) => (
                        <div key={i} className="bg-primary/10 border border-primary/10 rounded-sm" />
                    ))}
                </div>

                {/* Simulated Traffic Line (SVG running across the floor) */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path
                        d="M 10 90 L 30 70 L 50 50 L 70 30 L 90 10"
                        fill="none"
                        stroke="rgba(52, 211, 153, 0.5)"
                        strokeWidth="2"
                        className="animate-[dash_3s_linear_infinite]"
                        strokeDasharray="10, 5"
                    />
                </svg>

                {/* Data Bars */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="grid grid-cols-6 gap-4 w-full h-full p-4 items-end">
                        {data.map((item, idx) => {
                            // Max height will map to 160px for 100% capacity
                            const heightPx = mounted ? (item.visitors / 100) * 160 : 0.1; // 0.1 prevents glitch
                            const delay = idx * 150;

                            return (
                                <div
                                    key={item.month}
                                    className="relative w-full h-full flex flex-col items-center justify-end"
                                >
                                    {/* 3D Bar container relative to floor */}
                                    <div
                                        className="iso-bar w-8 bg-emerald-500/80 cursor-pointer pointer-events-auto"
                                        style={{
                                            height: '32px', // footprint width/depth
                                            width: '32px',
                                            '--bar-height': `${heightPx}px`,
                                            transitionDelay: mounted ? `${delay}ms` : '0ms'
                                        } as React.CSSProperties}
                                    >
                                        {/* Front Face */}
                                        <div
                                            className="iso-face-front bg-emerald-500 border border-emerald-400/50 hover:bg-emerald-400 transition-colors"
                                            style={{ height: `${heightPx}px`, transition: 'height 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', transitionDelay: `${delay}ms` }}
                                        />

                                        {/* Right Face */}
                                        <div
                                            className="iso-face-right bg-emerald-700 border border-emerald-600/50 hover:bg-emerald-600 transition-colors"
                                            style={{ height: `${heightPx}px`, transition: 'height 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', transitionDelay: `${delay}ms` }}
                                        />

                                        {/* Top Face */}
                                        <div
                                            className="iso-face-top bg-emerald-400 border border-emerald-300/80 flex items-center justify-center hover:bg-emerald-300 transition-all"
                                            style={{ transform: `translateZ(${heightPx}px)`, transition: 'transform 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', transitionDelay: `${delay}ms` }}
                                        >
                                             <div className="w-4 h-4 rounded-full bg-white/40 shadow-[0_0_15px_rgba(255,255,255,0.8)] animate-breathe" />
                                        </div>
                                    </div>

                                    {/* Floor Label */}
                                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest transform rotateX(-60deg) rotateZ(45deg)">
                                        {item.month}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Glowing Ambient Light Setup */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 blur-[100px] pointer-events-none z-0 rounded-full mix-blend-screen animate-breathe" />
            <div className="absolute top-[60%] left-1/2 -translate-x-1/2 w-[300px] h-[50px] bg-emerald-500/20 blur-[30px] rounded-[100%] pointer-events-none animate-breathe" />
        </div>
    );
}

// Internal custom animation keyframes
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes dash {
            to { stroke-dashoffset: -30; }
        }
    `;
    document.head.appendChild(style);
}
