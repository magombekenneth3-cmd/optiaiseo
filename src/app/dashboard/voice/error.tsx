"use client";
import { logger } from "@/lib/logger";

import { useEffect } from "react";
import { RefreshCcw, Mic } from "lucide-react";

/** Map raw error messages to user-friendly copy */
function friendlyMessage(msg: string | undefined): string {
    if (!msg) return "The voice session failed to start. Check that your LiveKit keys are set and the agent is running.";
    if (/timeout|timed out/i.test(msg)) return "The voice session timed out. The agent may be starting up — please try again.";
    if (/unauthorized|401|403/i.test(msg)) return "Authentication failed. Please refresh the page and try again.";
    if (/network|websocket|connect/i.test(msg)) return "Could not connect to the voice service. Check your internet connection and LiveKit configuration.";
    if (/livekit/i.test(msg)) return "LiveKit configuration error. Ensure your LiveKit URL and API keys are set correctly.";
    return "The voice session failed to start. Check that your LiveKit keys are set and the agent is running.";
}

export default function VoiceError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        logger.error("[Voice Agent Error]", { error: error?.message || error });
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center p-10 bg-[#09090b]">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Mic className="w-8 h-8 text-red-400" />
            </div>
            <div className="max-w-sm">
                <h2 className="text-xl font-bold text-foreground mb-2">The AI Assistant couldn&apos;t connect</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                    {friendlyMessage(error?.message)}
                </p>
                {/* Show raw error only in development */}
                {process.env.NODE_ENV === "development" && error?.message && (
                    <p className="text-[11px] font-mono text-red-400/70 bg-background rounded-lg px-3 py-2 text-left border border-red-500/10">
                        {error.message}
                    </p>
                )}
            </div>
            <button
                onClick={reset}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-muted hover:bg-white/10 border border-border text-zinc-300 text-sm font-medium transition-all"
            >
                <RefreshCcw className="w-4 h-4" />
                Try Again
            </button>
        </div>
    );
}
