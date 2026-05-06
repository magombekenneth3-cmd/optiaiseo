"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Globe, KeyRound, User, Link2, Loader2, CheckCircle2, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
    siteId: string;
    siteDomain: string;
}

interface WpState {
    wpUrl: string;
    wpUser: string;
    wpAppPassword: string;
    isConfigured?: boolean;
}

interface GhostState {
    ghostUrl: string;
    ghostAdminKey: string;
    isConfigured?: boolean;
}

interface HashnodeState {
    hashnodeToken: string;
    hashnodePublicationId: string;
    isConfigured?: boolean;
}

export function CmsConfigForm({ siteId, siteDomain }: Props) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clearingWp, setClearingWp] = useState(false);
    const [clearingGhost, setClearingGhost] = useState(false);
    const [clearingHashnode, setClearingHashnode] = useState(false);
    const [wpOpen, setWpOpen] = useState(false);
    const [ghostOpen, setGhostOpen] = useState(false);
    const [hashnodeOpen, setHashnodeOpen] = useState(false);

    const [wp, setWp] = useState<WpState>({ wpUrl: "", wpUser: "", wpAppPassword: "" });
    const [ghost, setGhost] = useState<GhostState>({ ghostUrl: "", ghostAdminKey: "" });
    const [hashnode, setHashnode] = useState<HashnodeState>({ hashnodeToken: "", hashnodePublicationId: "" });

    // Load current config on mount
    useEffect(() => {
        fetch(`/api/sites/${siteId}/cms-config`)
            .then((r) => r.json())
            .then((data) => {
                if (data.wordpress) {
                    setWp({ ...data.wordpress, wpAppPassword: "" });
                    setWpOpen(true);
                }
                if (data.ghost) {
                    setGhost({ ...data.ghost, ghostAdminKey: "" });
                    setGhostOpen(true);
                }
                if (data.hashnode) {
                    setHashnode({ ...data.hashnode, hashnodeToken: "" });
                    setHashnodeOpen(true);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [siteId]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const body: Record<string, unknown> = {};

            if (wpOpen) {
                if (!wp.wpUrl || !wp.wpUser || !wp.wpAppPassword) {
                    toast.error("WordPress: fill in all fields or disable integration.");
                    return;
                }
                body.wordpress = { wpUrl: wp.wpUrl.replace(/\/$/, ""), wpUser: wp.wpUser, wpAppPassword: wp.wpAppPassword };
            }

            if (ghostOpen) {
                if (!ghost.ghostUrl || !ghost.ghostAdminKey) {
                    toast.error("Ghost: fill in URL and Admin API Key.");
                    return;
                }
                if (!ghost.ghostAdminKey.includes(":")) {
                    toast.error("Ghost Admin API Key must be in {id}:{secret} format.");
                    return;
                }
                body.ghost = { ghostUrl: ghost.ghostUrl.replace(/\/$/, ""), ghostAdminKey: ghost.ghostAdminKey };
            }

            if (hashnodeOpen) {
                if (!hashnode.hashnodePublicationId || (!hashnode.hashnodeToken && !hashnode.isConfigured)) {
                    toast.error("Hashnode: fill in Publication ID and Personal Access Token.");
                    return;
                }
                // Only include token if a new one was typed (avoid overwriting with masked placeholder)
                if (hashnode.hashnodeToken) {
                    body.hashnode = {
                        hashnodeToken: hashnode.hashnodeToken,
                        hashnodePublicationId: hashnode.hashnodePublicationId,
                    };
                }
            }

            const res = await fetch(`/api/sites/${siteId}/cms-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Failed to save CMS config.");
                return;
            }

            toast.success("CMS configuration saved!");
        } catch {
            toast.error("Network error — could not save config.");
        } finally {
            setSaving(false);
        }
    };

    const clearWp = async () => {
        setClearingWp(true);
        try {
            const res = await fetch(`/api/sites/${siteId}/cms-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wordpress: null }),
            });
            if (res.ok) {
                setWp({ wpUrl: "", wpUser: "", wpAppPassword: "" });
                setWpOpen(false);
                toast.success("WordPress config removed.");
            }
        } catch {
            toast.error("Failed to remove WordPress config.");
        } finally {
            setClearingWp(false);
        }
    };

    const clearGhost = async () => {
        setClearingGhost(true);
        try {
            const res = await fetch(`/api/sites/${siteId}/cms-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ghost: null }),
            });
            if (res.ok) {
                setGhost({ ghostUrl: "", ghostAdminKey: "" });
                setGhostOpen(false);
                toast.success("Ghost config removed.");
            }
        } catch {
            toast.error("Failed to remove Ghost config.");
        } finally {
            setClearingGhost(false);
        }
    };

    const clearHashnode = async () => {
        setClearingHashnode(true);
        try {
            const res = await fetch(`/api/sites/${siteId}/cms-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hashnode: null }),
            });
            if (res.ok) {
                setHashnode({ hashnodeToken: "", hashnodePublicationId: "" });
                setHashnodeOpen(false);
                toast.success("Hashnode config removed.");
            }
        } catch {
            toast.error("Failed to remove Hashnode config.");
        } finally {
            setClearingHashnode(false);
        }
    };

    if (loading) {
        return (
            <div className="card-surface p-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-1/2" />
            </div>
        );
    }

    return (
        <div className="card-surface p-6 flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                    <h2 className="text-base font-bold mb-0.5">CMS Auto-Publishing</h2>
                    <p className="text-sm text-muted-foreground">
                        When you publish a blog post, OptiAISEO automatically syndicates it to your connected CMS.
                        Canonical links are preserved for SEO.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono opacity-60">Site: {siteDomain}</p>
                </div>
            </div>

            {/* Hashnode Section — Primary platform */}
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                <button
                    onClick={() => setHashnodeOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-indigo-500/10 transition-colors rounded-xl"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-[22px]">⚡</span>
                        <div>
                            <p className="text-sm font-semibold flex items-center gap-2">
                                Hashnode
                                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                                    Primary
                                </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {hashnode.isConfigured ? "Connected — blogs auto-publish here after generation" : "Not connected"}
                            </p>
                        </div>
                        {hashnode.isConfigured && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                        )}
                    </div>
                    {hashnodeOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {hashnodeOpen && (
                    <div className="px-5 pb-5 flex flex-col gap-4 border-t border-indigo-500/20 pt-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5" /> Personal Access Token
                            </label>
                            <input
                                type="password"
                                placeholder={hashnode.isConfigured ? "Enter new token to update" : "Your Hashnode PAT"}
                                value={hashnode.hashnodeToken}
                                onChange={(e) => setHashnode((s) => ({ ...s, hashnodeToken: e.target.value }))}
                                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Generate at hashnode.com → Account Settings → Developer → Access Tokens.
                            </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <Link2 className="w-3.5 h-3.5" /> Publication ID
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. 64a1b2c3d4e5f6a7b8c9d0e1"
                                value={hashnode.hashnodePublicationId}
                                onChange={(e) => setHashnode((s) => ({ ...s, hashnodePublicationId: e.target.value }))}
                                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Find in hashnode.com/[yourhandle] → Dashboard → General → Publication ID.
                            </p>
                        </div>
                        {hashnode.isConfigured && (
                            <button
                                onClick={clearHashnode}
                                disabled={clearingHashnode}
                                className="self-start inline-flex items-center gap-1.5 text-rose-400 hover:text-rose-300 text-xs font-medium transition-colors"
                            >
                                {clearingHashnode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                Remove Hashnode integration
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* WordPress Section */}
            <div className="rounded-xl border border-border bg-card/30">
                <button
                    onClick={() => setWpOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-card/60 transition-colors rounded-xl"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-[22px]">🔵</span>
                        <div>
                            <p className="text-sm font-semibold">WordPress</p>
                            <p className="text-xs text-muted-foreground">
                                {wp.isConfigured ? "Connected — auto-publishes via REST API" : "Not connected"}
                            </p>
                        </div>
                        {wp.isConfigured && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                        )}
                    </div>
                    {wpOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {wpOpen && (
                    <div className="px-5 pb-5 flex flex-col gap-4 border-t border-border pt-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                    <Link2 className="w-3.5 h-3.5" /> WordPress Site URL
                                </label>
                                <input
                                    type="url"
                                    placeholder="https://yourblog.com"
                                    value={wp.wpUrl}
                                    onChange={(e) => setWp((s) => ({ ...s, wpUrl: e.target.value }))}
                                    className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                    <User className="w-3.5 h-3.5" /> WordPress Username
                                </label>
                                <input
                                    type="text"
                                    placeholder="admin"
                                    value={wp.wpUser}
                                    onChange={(e) => setWp((s) => ({ ...s, wpUser: e.target.value }))}
                                    className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5" /> Application Password
                            </label>
                            <input
                                type="password"
                                placeholder={wp.isConfigured ? "Enter new password to update" : "xxxx xxxx xxxx xxxx xxxx xxxx"}
                                value={wp.wpAppPassword}
                                onChange={(e) => setWp((s) => ({ ...s, wpAppPassword: e.target.value }))}
                                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Generate in WordPress → Users → Profile → Application Passwords.
                            </p>
                        </div>
                        {wp.isConfigured && (
                            <button
                                onClick={clearWp}
                                disabled={clearingWp}
                                className="self-start inline-flex items-center gap-1.5 text-rose-400 hover:text-rose-300 text-xs font-medium transition-colors"
                            >
                                {clearingWp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                Remove WordPress integration
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Ghost Section */}
            <div className="rounded-xl border border-border bg-card/30">
                <button
                    onClick={() => setGhostOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-card/60 transition-colors rounded-xl"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-[22px]">👻</span>
                        <div>
                            <p className="text-sm font-semibold">Ghost</p>
                            <p className="text-xs text-muted-foreground">
                                {ghost.isConfigured ? "Connected — auto-publishes via Admin API" : "Not connected"}
                            </p>
                        </div>
                        {ghost.isConfigured && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                        )}
                    </div>
                    {ghostOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {ghostOpen && (
                    <div className="px-5 pb-5 flex flex-col gap-4 border-t border-border pt-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <Link2 className="w-3.5 h-3.5" /> Ghost Site URL
                            </label>
                            <input
                                type="url"
                                placeholder="https://yourblog.ghost.io"
                                value={ghost.ghostUrl}
                                onChange={(e) => setGhost((s) => ({ ...s, ghostUrl: e.target.value }))}
                                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5" /> Admin API Key
                            </label>
                            <input
                                type="password"
                                placeholder={ghost.isConfigured ? "Enter new key to update" : "id:secret"}
                                value={ghost.ghostAdminKey}
                                onChange={(e) => setGhost((s) => ({ ...s, ghostAdminKey: e.target.value }))}
                                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Find in Ghost Admin → Settings → Integrations → Custom Integration.
                            </p>
                        </div>
                        {ghost.isConfigured && (
                            <button
                                onClick={clearGhost}
                                disabled={clearingGhost}
                                className="self-start inline-flex items-center gap-1.5 text-rose-400 hover:text-rose-300 text-xs font-medium transition-colors"
                            >
                                {clearingGhost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                Remove Ghost integration
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground max-w-sm">
                    Credentials are stored securely. OptiAISEO publishes with a canonical link pointing to your own domain.
                </p>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary hover:bg-emerald-400 text-primary-foreground text-sm font-semibold shadow-md shadow-emerald-500/20 transition-colors disabled:opacity-60"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {saving ? "Saving…" : "Save CMS Config"}
                </button>
            </div>
        </div>
    );
}
