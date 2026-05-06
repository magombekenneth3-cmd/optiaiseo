"use client";

import { motion } from "framer-motion";

export function FloatContainer({ children, delay = 0, yOffset = 15, duration = 4 }: { children: React.ReactNode, delay?: number, yOffset?: number, duration?: number }) {
    return (
        <motion.div
            animate={{ y: [0, -yOffset, 0] }}
            transition={{
                duration: duration,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
                delay: delay,
            }}
        >
            {children}
        </motion.div>
    );
}

export function IsoServerMiniature() {
    return (
        <div className="relative w-24 h-24 flex items-center justify-center perspective-[1000px]">
            <style dangerouslySetInnerHTML={{
                __html: `
            .iso-box {
                transform: rotateX(60deg) rotateZ(-45deg);
            transform-style: preserve-3d;
          }
            .iso-face-f {
                position: absolute; bottom: 0; left: 0; width: 100%; height: 100%;
            transform-origin: bottom; transform: rotateX(-90deg);
          }
            .iso-face-r {
                position: absolute; bottom: 0; right: 0; width: 100%; height: 100%;
            transform-origin: right; transform: rotateY(-90deg) rotateX(-90deg);
          }
            .iso-face-t {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            transform: translateZ(var(--depth));
          }
            `
            }} />
            <div className="iso-box relative w-12 h-12" style={{ "--depth": "2rem" } as React.CSSProperties}>
                {/* Glow behind */}
                <div className="absolute inset-0 bg-blue-500/30 blur-xl translate-z-[-1rem]"></div>

                {/* Server Block 1 */}
                <div className="absolute inset-0" style={{ "--depth": "1.2rem" } as React.CSSProperties}>
                    <div className="iso-face-f bg-zinc-800 border border-zinc-700 flex items-center justify-start px-2 gap-1" style={{ height: "1.2rem" }}>
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        <div className="w-4 h-0.5 bg-zinc-600 rounded" />
                    </div>
                    <div className="iso-face-r bg-zinc-900 border border-zinc-800" style={{ height: "1.2rem" }} />
                    <div className="iso-face-t bg-zinc-700 border border-zinc-600 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full border border-blue-500/30 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-blue-500/50" />
                        </div>
                    </div>
                </div>

                {/* Server Block 2 */}
                <div className="absolute inset-x-0 bottom-0" style={{ "--depth": "1.2rem", transform: "translateZ(1.6rem)" } as React.CSSProperties}>
                    <div className="iso-face-f bg-zinc-800 border border-zinc-700 flex items-center justify-start px-2 gap-1" style={{ height: "1.2rem" }}>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <div className="w-4 h-0.5 bg-zinc-600 rounded" />
                    </div>
                    <div className="iso-face-r bg-zinc-900 border border-zinc-800" style={{ height: "1.2rem" }} />
                    <div className="iso-face-t bg-zinc-700 border border-zinc-600 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full border border-emerald-500/30 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-emerald-500/50" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function IsoDatabaseMiniature() {
    return (
        <div className="relative w-24 h-24 flex items-center justify-center perspective-[1000px]">
            <div className="iso-box relative w-10 h-10" style={{ "--depth": "2.5rem" } as React.CSSProperties}>
                <div className="absolute inset-0 bg-purple-500/30 blur-xl translate-z-[-0.5rem]"></div>
                <div className="absolute inset-0">
                    <div className="iso-face-f bg-purple-900/80 border border-purple-500/50 flex flex-col items-center justify-around py-1" style={{ height: "2.5rem" }}>
                        <div className="w-6 h-0.5 bg-purple-400/50 rounded" />
                        <div className="w-6 h-0.5 bg-purple-400/50 rounded" />
                        <div className="w-6 h-0.5 bg-purple-400/50 rounded" />
                    </div>
                    <div className="iso-face-r bg-purple-950/90 border border-purple-600/50" style={{ height: "2.5rem" }} />
                    <div className="iso-face-t bg-purple-800/90 border border-purple-400/60 overflow-hidden relative">
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent to-purple-400/20" />
                        <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-purple-300 shadow-[0_0_8px_rgba(216,180,254,1)] animate-pulse" />
                    </div>
                </div>
            </div>
        </div>
    );
}
