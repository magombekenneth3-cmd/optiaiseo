"use client";

/**
 * WinCelebrationToast
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows a one-time confetti + toast when a keyword has moved up ≥3 positions
 * since the previous snapshot. Reads `winKeyword`, `winDelta`, `winNewPos` from
 * props (computed server-side in dashboard/page.tsx) and is dismissed via
 * localStorage so it fires once per win, not on every page load.
 *
 * Confetti is pure CSS (no external library) — uses 30 absolutely-positioned
 * spans animated with keyframes defined inline via a <style> tag.
 */

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, X } from "lucide-react";

interface Props {
    keyword: string;
    delta: number;        // positive number — positions gained
    newPosition: number;
    winId: string;        // unique ID for this win (e.g. siteId + keyword + date)
}

const COLORS = ["#10b981", "#34d399", "#6ee7b7", "#f59e0b", "#fbbf24", "#a78bfa", "#60a5fa"];

function Confetti() {
    const pieces = Array.from({ length: 28 });
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
            <style>{`
                @keyframes confetti-fall {
                    0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(120px) rotate(720deg); opacity: 0; }
                }
            `}</style>
            {pieces.map((_, i) => (
                <span
                    key={i}
                    className="absolute top-0 w-2 h-2 rounded-sm"
                    style={{
                        left: `${(i / pieces.length) * 100}%`,
                        background: COLORS[i % COLORS.length],
                        animationName: "confetti-fall",
                        animationDuration: `${0.8 + Math.random() * 1.2}s`,
                        animationDelay: `${Math.random() * 0.5}s`,
                        animationTimingFunction: "ease-in",
                        animationFillMode: "forwards",
                    }}
                />
            ))}
        </div>
    );
}

export function WinCelebrationToast({ keyword, delta, newPosition, winId }: Props) {
    const [visible, setVisible] = useState(false);
    const storageKey = `win-seen:${winId}`;

    useEffect(() => {
        try {
            if (!localStorage.getItem(storageKey)) {
                setVisible(true);
            }
        } catch {
            // localStorage unavailable — just don't show
        }
    }, [storageKey]);

    const dismiss = useCallback(() => {
        setVisible(false);
        try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
    }, [storageKey]);

    // Auto-dismiss after 8 seconds
    useEffect(() => {
        if (!visible) return;
        const t = setTimeout(dismiss, 8000);
        return () => clearTimeout(t);
    }, [visible, dismiss]);

    if (!visible) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="relative overflow-hidden fade-in-up rounded-2xl border border-emerald-500/30 bg-emerald-950/60 backdrop-blur-sm p-5 flex items-start gap-4 shadow-[0_8px_32px_-8px_rgba(16,185,129,0.35)]"
        >
            <Confetti />

            {/* Icon */}
            <div className="shrink-0 mt-0.5 w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/70 mb-0.5">
                    🏆 Ranking Win
                </p>
                <p className="text-sm font-bold text-foreground leading-snug">
                    &ldquo;{keyword}&rdquo; moved up {delta} position{delta !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Now ranking <strong className="text-emerald-400">#{newPosition}</strong> — keep publishing to hold it.
                </p>
            </div>

            {/* Dismiss */}
            <button
                onClick={dismiss}
                aria-label="Dismiss win notification"
                className="shrink-0 p-1.5 rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-foreground transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
