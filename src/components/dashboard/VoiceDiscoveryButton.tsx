"use client";

/**
 * VoiceDiscoveryButton — Compact "Ask OptiAI" text button
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the large floating microphone with a minimal text button.
 * Positioned bottom-right, navigates to /dashboard/voice on click.
 * Shown only to PRO/AGENCY users.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

interface Props {
    userTier: string;
}

const ELIGIBLE = new Set(["PRO", "AGENCY"]);

export function VoiceDiscoveryButton({ userTier }: Props) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (ELIGIBLE.has(userTier)) {
            setVisible(true);
        }
    }, [userTier]);

    if (!visible) return null;

    return (
        <Link
            href="/dashboard/voice"
            className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-card border border-border text-[13px] font-medium text-foreground hover:bg-accent hover:border-border/80 transition-colors shadow-sm"
            aria-label="Ask OptiAI voice assistant"
        >
            <Sparkles className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
            Ask OptiAI
        </Link>
    );
}
