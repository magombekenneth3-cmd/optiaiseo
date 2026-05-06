"use client";

/**
 * VoiceDiscoveryButton
 * ────────────────────
 * Floating "Talk to your SEO AI" button — shown only to PRO/AGENCY users.
 * Positioned bottom-right, above the ChatOps terminal.
 * Shown once per session via sessionStorage key, with a subtle pulse
 * animation on first view to draw attention.
 *
 * Mounts client-side only so it never blocks server rendering.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, X } from "lucide-react";

const SESSION_KEY = "voice_discovery_seen";

interface Props {
    userTier: string;
}

const ELIGIBLE = new Set(["PRO", "AGENCY"]);

export function VoiceDiscoveryButton({ userTier }: Props) {
    const [visible,    setVisible]    = useState(false);
    const [dismissed,  setDismissed]  = useState(false);
    const [pulsing,    setPulsing]    = useState(false);

    useEffect(() => {
        if (!ELIGIBLE.has(userTier)) return;
        const seen = sessionStorage.getItem(SESSION_KEY);
        if (!seen) {
            // First view this session — show with pulse
            setVisible(true);
            setPulsing(true);
            sessionStorage.setItem(SESSION_KEY, "1");
            // Stop pulse after 4 s
            const t = setTimeout(() => setPulsing(false), 4000);
            return () => clearTimeout(t);
        } else {
            setVisible(true);
        }
    }, [userTier]);

    if (!visible || dismissed) return null;

    return (
        <div
            className="fixed bottom-24 right-5 z-40 flex items-end gap-2"
            role="region"
            aria-label="Voice AI shortcut"
        >
            {/* Label bubble */}
            {pulsing && (
                <div className="mb-1 animate-fade-in">
                    <div className="bg-card border border-border rounded-xl px-3 py-2 text-xs font-medium text-foreground shadow-xl whitespace-nowrap">
                        🎙️ Talk to your SEO AI
                        <p className="text-[10px] text-muted-foreground mt-0.5">Ask anything about your site</p>
                    </div>
                </div>
            )}

            {/* Button group */}
            <div className="flex flex-col items-center gap-1">
                {/* Dismiss */}
                <button
                    onClick={() => setDismissed(true)}
                    className="w-5 h-5 rounded-full bg-muted/80 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    title="Dismiss"
                >
                    <X className="w-2.5 h-2.5" />
                </button>

                {/* Main button */}
                <Link
                    href="/dashboard/voice"
                    className={`relative w-12 h-12 rounded-2xl bg-violet-600 hover:bg-violet-500 border border-violet-400/30 shadow-xl shadow-violet-900/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
                        pulsing ? "ring-4 ring-violet-500/30 animate-pulse" : ""
                    }`}
                    title="Open Voice AI"
                >
                    <Mic className="w-5 h-5 text-white" />
                    {/* Online indicator */}
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-background" />
                </Link>
            </div>
        </div>
    );
}
