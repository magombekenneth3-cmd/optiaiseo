"use client";

import { useState } from "react";
import {
    CheckCircle2,
    AlertCircle,
    AlertTriangle,
    Loader2,
    ExternalLink,
    Unplug,
    Clock,
    Search,
    BarChart3,
    GitBranch,
    Globe,
    BarChart,
    Key,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface IntegrationCardProps {
    id: string;
    name: string;
    description: string;
    connected: boolean;
    accountLabel?: string;
    lastSyncAt?: string | null;
    configErrors: string[];
    /** URL or onClick to initiate connection. If string → link; if function → button */
    connectAction?: string | (() => void);
    /** If provided, shows a disconnect button */
    onDisconnect?: () => Promise<void>;
    /** Custom slot for additional controls (e.g., GA4 property selector) */
    children?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration icon resolver
// ─────────────────────────────────────────────────────────────────────────────

const ICONS: Record<string, { icon: typeof Search; color: string }> = {
    gsc:       { icon: Search,     color: "text-blue-400" },
    ga4:       { icon: BarChart3,  color: "text-purple-400" },
    github:    { icon: GitBranch,  color: "text-orange-400" },
    wordpress: { icon: Globe,      color: "text-sky-400" },
    moz:       { icon: BarChart,   color: "text-amber-400" },
    api:       { icon: Key,        color: "text-violet-400" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function IntegrationStatusCard({
    id,
    name,
    description,
    connected,
    accountLabel,
    lastSyncAt,
    configErrors,
    connectAction,
    onDisconnect,
    children,
}: IntegrationCardProps) {
    const [disconnecting, setDisconnecting] = useState(false);
    const [localDisconnected, setLocalDisconnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isConnected = connected && !localDisconnected;
    const hasErrors = configErrors.length > 0;

    const { icon: Icon, color } = ICONS[id] ?? { icon: Key, color: "text-muted-foreground" };

    // ── Format last sync ──
    let syncLabel: string | null = null;
    if (lastSyncAt) {
        const d = new Date(lastSyncAt);
        const diff = Date.now() - d.getTime();
        const hours = Math.floor(diff / 3_600_000);
        if (hours < 1) syncLabel = "Just now";
        else if (hours < 24) syncLabel = `${hours}h ago`;
        else syncLabel = `${Math.floor(hours / 24)}d ago`;
    }

    async function handleDisconnect() {
        if (!onDisconnect) return;
        setDisconnecting(true);
        setError(null);
        try {
            await onDisconnect();
            setLocalDisconnected(true);
        } catch {
            setError("Failed to disconnect. Please try again.");
        } finally {
            setDisconnecting(false);
        }
    }

    // ── Status badge ──
    function StatusBadge() {
        if (hasErrors && isConnected) {
            return (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Config Issue
                </span>
            );
        }
        if (isConnected) {
            return (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Connected
                </span>
            );
        }
        return (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                Not connected
            </span>
        );
    }

    return (
        <div
            id={`integration-card-${id}`}
            className={`rounded-xl border p-5 transition-colors ${
                isConnected
                    ? hasErrors
                        ? "border-amber-500/20 bg-[#161b22]"
                        : "border-emerald-500/15 bg-[#161b22]"
                    : "border-[#30363d] bg-[#161b22]"
            }`}
        >
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <h3 className="text-[14px] font-semibold text-[#e6edf3] flex-1">{name}</h3>
                <StatusBadge />
            </div>

            {/* Description */}
            <p className="text-[12px] text-[#6e7681] mb-4 ml-[42px]">{description}</p>

            {/* Metadata row: account label + last sync */}
            {isConnected && (accountLabel || syncLabel) && (
                <div className="flex flex-wrap gap-3 mb-4 ml-[42px]">
                    {accountLabel && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#8b949e] bg-white/5 rounded-md px-2.5 py-1 border border-white/5">
                            <span className="text-[#e6edf3] font-medium truncate max-w-[200px]">{accountLabel}</span>
                        </span>
                    )}
                    {syncLabel && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#8b949e]">
                            <Clock className="w-3 h-3" />
                            Last sync: <span className="text-[#e6edf3]">{syncLabel}</span>
                        </span>
                    )}
                </div>
            )}

            {/* Config errors */}
            {hasErrors && isConnected && (
                <div className="mb-4 ml-[42px]">
                    {configErrors.map((err, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-400 mb-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            {err}
                        </div>
                    ))}
                </div>
            )}

            {/* Custom content slot (e.g., GA4 property selector) */}
            {children && <div className="ml-[42px] mb-4">{children}</div>}

            {/* Action row */}
            <div className="flex items-center gap-3 ml-[42px]">
                {isConnected ? (
                    <>
                        <div className="flex items-center gap-1.5 text-[12px] text-emerald-400/80 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Active
                        </div>
                        {onDisconnect && (
                            <button
                                onClick={handleDisconnect}
                                disabled={disconnecting}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                            >
                                {disconnecting ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                    <Unplug className="w-3 h-3" />
                                )}
                                Disconnect
                            </button>
                        )}
                    </>
                ) : connectAction ? (
                    typeof connectAction === "string" ? (
                        // eslint-disable-next-line @next/next/no-html-link-for-pages
                        <a
                            href={connectAction}
                            className="inline-flex items-center gap-2 px-4 py-2 text-[12px] font-semibold rounded-lg bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Connect
                        </a>
                    ) : (
                        <button
                            onClick={connectAction}
                            className="inline-flex items-center gap-2 px-4 py-2 text-[12px] font-semibold rounded-lg bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Connect
                        </button>
                    )
                ) : null}
            </div>

            {/* Error feedback */}
            {error && (
                <div className="mt-3 ml-[42px] flex items-center gap-2 text-[11px] text-rose-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {error}
                </div>
            )}
        </div>
    );
}
