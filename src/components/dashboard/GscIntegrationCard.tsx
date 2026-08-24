"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, ShieldCheck, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";

interface Props {
    isConnected: boolean;
}

export function GscIntegrationCard({ isConnected }: Props) {
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnected, setDisconnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const connected = isConnected && !disconnected;

    async function handleDisconnect() {
        setDisconnecting(true);
        setError(null);
        try {
            const res = await fetch("/api/settings/disconnect-gsc", { method: "POST" });
            if (!res.ok) throw new Error("Failed to disconnect");
            setDisconnected(true);
        } catch {
            setError("Failed to disconnect. Please try again.");
        } finally {
            setDisconnecting(false);
        }
    }

    return (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
            <div className="flex items-center gap-2 mb-3">
                <Search className="w-4 h-4 text-blue-400" />
                <h3 className="text-[14px] font-semibold text-[#e6edf3]">Google Search Console</h3>
                {connected ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#2ea043]/10 text-[#2ea043] border border-[#2ea043]/20">
                        Connected
                    </span>
                ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                        Not connected
                    </span>
                )}
            </div>
            <p className="text-[12px] text-[#6e7681] mb-4">
                Unlocks live CTR, impressions, position data, keyword opportunities, and experiment tracking.
            </p>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#6e7681] mb-4">
                <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Read-only access</span>
                <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Secure Google OAuth</span>
            </div>

            {connected ? (
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-[12px] text-emerald-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Google Search Console is connected
                    </div>
                    <button
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                    >
                        {disconnecting && <Loader2 className="w-3 h-3 animate-spin" />}
                        Disconnect
                    </button>
                </div>
            ) : (
                <Link
                    href="/api/auth/signin/google-gsc?callbackUrl=%2Fdashboard%2Fsettings%3Ftab%3Dintegrations"
                    className="inline-flex items-center gap-2 px-4 py-2 text-[12px] font-semibold rounded-lg bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Connect with Google
                </Link>
            )}

            {error && (
                <div className="mt-3 flex items-center gap-2 text-[11px] text-rose-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {error}
                </div>
            )}
        </div>
    );
}
